package expo.modules.motoristanotificationlistener

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Display
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.widget.LinearLayout
import android.widget.TextView
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.abs
import kotlin.math.max

/**
 * 99-specific offer reader.
 *
 * Intentionally separate from RideAccessibilityService so the validated Uber
 * path stays untouched. 99 does not expose the same "Aceitar/Selecionar"
 * anchor used by Uber, so this reader isolates the current 99 card by its
 * large fare line and the two route rows below it.
 */
class Ride99AccessibilityService : AccessibilityService() {
  companion object {
    private const val PACKAGE_99 = "com.app99.driver"
    private const val MIN_CAPTURE_INTERVAL_MS = 450L
    private const val OVERLAY_VISIBLE_MS = 8_000L
    private const val OVERLAY_DEDUPE_MS = 20_000L
    private const val MAX_OCR_LINES = 48
    private const val MAX_LINE_CHARS = 220

    private const val GREEN_PER_KM = 2.10
    private const val YELLOW_PER_KM = 1.70
    private const val GREEN_PER_HOUR = 46.0
    private const val YELLOW_PER_HOUR = 35.0

    private val FARE_REGEX = Regex(
      """(?:R\$|RS|R5)\s*([0-9]{1,5}(?:[.,][0-9]{1,2})?)""",
      RegexOption.IGNORE_CASE
    )
    private val KM_REGEX = Regex(
      """([0-9]{1,3}(?:[.,][0-9]+)?)\s*km\b""",
      RegexOption.IGNORE_CASE
    )
    private val METER_REGEX = Regex(
      """([0-9]{1,4})\s*m\b""",
      RegexOption.IGNORE_CASE
    )
    private val MINUTE_REGEX = Regex(
      """([0-9]{1,3})\s*(?:min|minuto|minutos)\b""",
      RegexOption.IGNORE_CASE
    )
    private val HOUR_MINUTE_REGEX = Regex(
      """([0-9]{1,2})\s*(?:h|hora|horas)\b(?:\s*(?:e)?\s*([0-9]{1,2})\s*(?:min|minuto|minutos)\b)?""",
      RegexOption.IGNORE_CASE
    )
    private val PER_KM_REGEX = Regex(
      """(?:R\$|RS|R5)?\s*([0-9]{1,3}(?:[.,][0-9]{1,2})?)\s*/\s*km""",
      RegexOption.IGNORE_CASE
    )
    private val STOP_REGEX = Regex("""\bparada(?:s)?\b""", RegexOption.IGNORE_CASE)
  }

  private data class OcrLine(val text: String, val bounds: Rect)
  private data class RouteLeg(val minutes: Int, val km: Double, val top: Int)
  private data class Decision(
    val fare: Double,
    val totalKm: Double,
    val totalMinutes: Int,
    val reaisPerKm: Double,
    val reaisPerHour: Double,
    val semaphore: String,
    val hasStops: Boolean,
    val signature: String
  )

  private val lastCaptureAt = AtomicLong(0L)
  private val captureInFlight = AtomicBoolean(false)
  private val overlayHandler = Handler(Looper.getMainLooper())
  private var overlayView: View? = null
  private var overlayHideRunnable: Runnable? = null
  private var lastOverlaySignature: String? = null
  private var lastOverlayAt: Long = 0L

  private val recognizer by lazy {
    TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event == null || !isRelevantEventType(event.eventType)) return
    if (event.packageName?.toString()?.lowercase() != PACKAGE_99) return

    val now = System.currentTimeMillis()
    val previous = lastCaptureAt.get()
    if (now - previous < MIN_CAPTURE_INTERVAL_MS) return
    if (!lastCaptureAt.compareAndSet(previous, now)) return
    if (!captureInFlight.compareAndSet(false, true)) return

    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      persistStatus(event, "OCR_99: UNSUPPORTED_API")
      captureInFlight.set(false)
      return
    }

    takeDisplayScreenshot(event)
  }

  override fun onInterrupt() {}

  override fun onDestroy() {
    hideDecisionOverlay()
    try { recognizer.close() } catch (_: Exception) {}
    super.onDestroy()
  }

  private fun isRelevantEventType(eventType: Int): Boolean {
    return eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
      eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED ||
      eventType == AccessibilityEvent.TYPE_WINDOWS_CHANGED ||
      eventType == AccessibilityEvent.TYPE_VIEW_SCROLLED
  }

  private fun takeDisplayScreenshot(event: AccessibilityEvent) {
    try {
      takeScreenshot(
        Display.DEFAULT_DISPLAY,
        mainExecutor,
        object : TakeScreenshotCallback {
          override fun onSuccess(screenshot: ScreenshotResult) {
            val buffer = screenshot.hardwareBuffer
            var hardwareBitmap: Bitmap? = null
            var softwareBitmap: Bitmap? = null
            try {
              hardwareBitmap = Bitmap.wrapHardwareBuffer(buffer, screenshot.colorSpace)
              if (hardwareBitmap == null) {
                persistStatus(event, "OCR_99: BITMAP_WRAP_FAILED")
                captureInFlight.set(false)
                return
              }
              softwareBitmap = hardwareBitmap.copy(Bitmap.Config.ARGB_8888, false)
              if (softwareBitmap == null) {
                persistStatus(event, "OCR_99: BITMAP_COPY_FAILED")
                captureInFlight.set(false)
                return
              }
              processBitmap(event, softwareBitmap)
            } catch (_: Exception) {
              try { softwareBitmap?.recycle() } catch (_: Exception) {}
              persistStatus(event, "OCR_99: BITMAP_ERROR")
              captureInFlight.set(false)
            } finally {
              try { hardwareBitmap?.recycle() } catch (_: Exception) {}
              try { buffer.close() } catch (_: Exception) {}
            }
          }

          override fun onFailure(errorCode: Int) {
            try { persistStatus(event, "OCR_99: SCREENSHOT_ERROR code=$errorCode") }
            finally { captureInFlight.set(false) }
          }
        }
      )
    } catch (_: SecurityException) {
      persistStatus(event, "OCR_99: SECURITY_EXCEPTION")
      captureInFlight.set(false)
    } catch (_: Exception) {
      persistStatus(event, "OCR_99: INTERNAL_EXCEPTION")
      captureInFlight.set(false)
    }
  }

  private fun processBitmap(event: AccessibilityEvent, bitmap: Bitmap) {
    val image = InputImage.fromBitmap(bitmap, 0)
    recognizer.process(image)
      .addOnSuccessListener { result ->
        try {
          val allLines = collectLines(result)
          val fareLine = findMainFareLine(allLines)
          if (fareLine == null) {
            persistStatus(event, "OCR_99: NO_CURRENT_OFFER_FARE")
          } else {
            val cardLines = isolateCardLines(allLines, fareLine)
            val decision = extractDecision(fareLine, cardLines)
            if (decision != null) {
              showDecisionOverlay(decision)
              persistOcrResult(event, cardLines, decision)
            } else {
              persistStatus(event, "OCR_99: DECISION_REJECTED fare=${fareLine.text.take(40)}")
              persistRawOperational(event, cardLines)
            }
          }
        } catch (_: Exception) {
          persistStatus(event, "OCR_99: RESULT_PROCESSING_ERROR")
        } finally {
          try { bitmap.recycle() } catch (_: Exception) {}
          captureInFlight.set(false)
        }
      }
      .addOnFailureListener { error ->
        try { persistStatus(event, "OCR_99: OCR_ERROR ${error.javaClass.simpleName}") }
        finally {
          try { bitmap.recycle() } catch (_: Exception) {}
          captureInFlight.set(false)
        }
      }
  }

  private fun collectLines(result: Text): List<OcrLine> {
    val lines = mutableListOf<OcrLine>()
    for (block in result.textBlocks) {
      for (line in block.lines) {
        val text = line.text.trim()
        val bounds = line.boundingBox ?: continue
        if (text.isNotBlank()) lines.add(OcrLine(text, Rect(bounds)))
      }
    }
    return lines.sortedWith(compareBy<OcrLine> { it.bounds.top }.thenBy { it.bounds.left })
  }

  private fun findMainFareLine(lines: List<OcrLine>): OcrLine? {
    val candidates = lines.filter { line ->
      val normalized = normalize(line.text)
      FARE_REGEX.containsMatchIn(line.text) &&
        !normalized.contains("/km") &&
        !normalized.contains("tarifa") &&
        !normalized.contains("dinamic") &&
        !normalized.trimStart().startsWith("+")
    }
    return candidates.maxWithOrNull(
      compareBy<OcrLine> { it.bounds.height() }
        .thenBy { it.bounds.width() }
        .thenBy { it.bounds.top }
    )
  }

  private fun isolateCardLines(lines: List<OcrLine>, fareLine: OcrLine): List<OcrLine> {
    val screenW = resources.displayMetrics.widthPixels
    val cardTop = (fareLine.bounds.top - dp(120)).coerceAtLeast(0)
    val cardBottom = resources.displayMetrics.heightPixels
    return lines.filter { line ->
      val cy = centerY(line.bounds)
      val cx = line.bounds.left + line.bounds.width() / 2
      cy in cardTop..cardBottom && cx in 0..screenW
    }
  }

  private fun extractDecision(fareLine: OcrLine, cardLines: List<OcrLine>): Decision? {
    val fare = FARE_REGEX.find(fareLine.text)
      ?.groupValues?.getOrNull(1)
      ?.let(::parseDecimal)
      ?.takeIf { it > 0.0 } ?: return null

    val routeLegs = extractRouteLegs(cardLines, fareLine)
    if (routeLegs.size != 2 && routeLegs.size != 3) return null

    val totalMinutes = routeLegs.sumOf { it.minutes }
    val totalKm = routeLegs.sumOf { it.km }
    if (totalMinutes !in 2..360 || totalKm <= 0.0 || totalKm > 200.0) return null

    val reaisPerKm = fare / totalKm
    val reaisPerHour = fare / (totalMinutes / 60.0)

    val shownPerKm = cardLines.asSequence()
      .filter { normalize(it.text).contains("/km") }
      .mapNotNull { PER_KM_REGEX.find(it.text)?.groupValues?.getOrNull(1)?.let(::parseDecimal) }
      .firstOrNull { it > 0.0 }

    // On 99 the displayed R$/km already includes pickup distance. Use it as a
    // strong guard against pairing route rows from the map/background.
    if (shownPerKm != null) {
      val tolerance = max(0.18, shownPerKm * 0.12)
      if (abs(reaisPerKm - shownPerKm) > tolerance) return null
    }

    val semaphore = when {
      reaisPerKm >= GREEN_PER_KM && reaisPerHour >= GREEN_PER_HOUR -> "green"
      reaisPerKm < YELLOW_PER_KM || reaisPerHour < YELLOW_PER_HOUR -> "red"
      else -> "yellow"
    }

    val hasStops = routeLegs.size == 3 || cardLines.any { STOP_REGEX.containsMatchIn(it.text) }
    val signature = listOf(
      "99",
      (fare * 100).toInt().toString(),
      String.format(Locale.US, "%.2f", totalKm),
      totalMinutes.toString(),
      hasStops.toString()
    ).joinToString("|")

    return Decision(fare, totalKm, totalMinutes, reaisPerKm, reaisPerHour, semaphore, hasStops, signature)
  }

  private fun extractRouteLegs(lines: List<OcrLine>, fareLine: OcrLine): List<RouteLeg> {
    val routeLines = lines.filter { line ->
      line.bounds.top > fareLine.bounds.bottom &&
        !normalize(line.text).contains("/km") &&
        !normalize(line.text).contains("tarifa")
    }

    val direct = LinkedHashMap<String, RouteLeg>()
    for (line in routeLines) {
      val minutes = parseDurationMinutes(line.text) ?: continue
      val km = parseDistanceKm(line.text) ?: continue
      if (km <= 0.0 || km > 150.0) continue
      val key = "$minutes|${String.format(Locale.US, "%.3f", km)}"
      direct.putIfAbsent(key, RouteLeg(minutes, km, line.bounds.top))
    }
    if (direct.size in 2..3) return direct.values.sortedBy { it.top }

    // ML Kit may split "4 min" and "1,2 km" into neighboring OCR rows.
    val timeLines = routeLines.mapNotNull { line -> parseDurationMinutes(line.text)?.let { it to line } }
    val distanceLines = routeLines.mapNotNull { line -> parseDistanceKm(line.text)?.let { it to line } }
    val usedDistance = HashSet<Int>()
    val paired = LinkedHashMap<String, RouteLeg>()

    for ((minutes, timeLine) in timeLines) {
      var bestIndex = -1
      var bestScore = Int.MAX_VALUE
      distanceLines.forEachIndexed { index, (_, distanceLine) ->
        if (usedDistance.contains(index)) return@forEachIndexed
        val dy = abs(centerY(timeLine.bounds) - centerY(distanceLine.bounds))
        if (dy < bestScore) {
          bestScore = dy
          bestIndex = index
        }
      }
      if (bestIndex >= 0 && bestScore <= dp(52)) {
        usedDistance.add(bestIndex)
        val km = distanceLines[bestIndex].first
        if (km > 0.0 && km <= 150.0) {
          val key = "$minutes|${String.format(Locale.US, "%.3f", km)}"
          paired.putIfAbsent(
            key,
            RouteLeg(minutes, km, minOf(timeLine.bounds.top, distanceLines[bestIndex].second.bounds.top))
          )
        }
      }
    }
    return paired.values.sortedBy { it.top }
  }

  private fun parseDurationMinutes(text: String): Int? {
    val hourMatch = HOUR_MINUTE_REGEX.find(text)
    if (hourMatch != null) {
      val hours = hourMatch.groupValues.getOrNull(1)?.toIntOrNull() ?: return null
      val mins = hourMatch.groupValues.getOrNull(2)?.toIntOrNull() ?: 0
      return (hours * 60 + mins).takeIf { it in 1..360 }
    }
    return MINUTE_REGEX.find(text)
      ?.groupValues?.getOrNull(1)
      ?.toIntOrNull()
      ?.takeIf { it in 1..360 }
  }

  private fun parseDistanceKm(text: String): Double? {
    KM_REGEX.find(text)?.groupValues?.getOrNull(1)?.let(::parseDecimal)?.let { return it }
    METER_REGEX.find(text)?.groupValues?.getOrNull(1)?.toDoubleOrNull()?.let { return it / 1000.0 }
    return null
  }

  private fun showDecisionOverlay(data: Decision) {
    val now = System.currentTimeMillis()
    if (data.signature == lastOverlaySignature && now - lastOverlayAt <= OVERLAY_DEDUPE_MS) return
    lastOverlaySignature = data.signature
    lastOverlayAt = now

    overlayHandler.post {
      hideDecisionOverlay()
      val windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
      val borderColor = when (data.semaphore) {
        "green" -> Color.rgb(28, 185, 84)
        "red" -> Color.rgb(234, 67, 53)
        else -> Color.rgb(251, 188, 4)
      }

      val root = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(14), dp(10), dp(14), dp(9))
        background = GradientDrawable().apply {
          shape = GradientDrawable.RECTANGLE
          cornerRadius = dp(14).toFloat()
          setColor(Color.WHITE)
          setStroke(dp(5), borderColor)
        }
        elevation = dp(10).toFloat()
      }

      val metricsRow = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
      }
      metricsRow.addView(metricColumn("R$/Km", format2(data.reaisPerKm), borderColor), weightedParams())
      metricsRow.addView(metricColumn("R$/Hora", format2(data.reaisPerHour), borderColor), weightedParams())
      metricsRow.addView(metricColumn("Sinal", "●", borderColor, true), weightedParams())
      root.addView(metricsRow)

      val routeSummary = buildString {
        append(data.totalMinutes).append("min • ")
        append(format1(data.totalKm)).append("km")
        if (data.hasStops) append(" • PAR")
      }
      root.addView(TextView(this).apply {
        text = routeSummary
        setTextColor(Color.rgb(20, 20, 20))
        textSize = 19f
        setTypeface(typeface, android.graphics.Typeface.BOLD)
        setPadding(dp(4), dp(5), dp(4), 0)
      })

      val width = (resources.displayMetrics.widthPixels * 0.82f).toInt()
      val params = WindowManager.LayoutParams(
        width,
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
          WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
          WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT
      ).apply {
        gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
        y = dp(70)
      }

      try {
        windowManager.addView(root, params)
        overlayView = root
        val hide = Runnable { hideDecisionOverlay() }
        overlayHideRunnable = hide
        overlayHandler.postDelayed(hide, OVERLAY_VISIBLE_MS)
      } catch (_: Exception) {
        overlayView = null
      }
    }
  }

  private fun metricColumn(label: String, value: String, accent: Int, semaphoreDot: Boolean = false): LinearLayout {
    return LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(5), 0, dp(5), 0)
      addView(TextView(this@Ride99AccessibilityService).apply {
        text = label
        setTextColor(Color.rgb(110, 110, 110))
        textSize = 13f
      })
      addView(TextView(this@Ride99AccessibilityService).apply {
        text = value
        setTextColor(if (semaphoreDot) accent else Color.BLACK)
        textSize = if (semaphoreDot) 34f else 27f
        setTypeface(typeface, android.graphics.Typeface.BOLD)
      })
    }
  }

  private fun weightedParams(): LinearLayout.LayoutParams {
    return LinearLayout.LayoutParams(0, WindowManager.LayoutParams.WRAP_CONTENT, 1f)
  }

  private fun hideDecisionOverlay() {
    overlayHideRunnable?.let { overlayHandler.removeCallbacks(it) }
    overlayHideRunnable = null
    val current = overlayView ?: return
    overlayView = null
    try {
      val windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
      windowManager.removeView(current)
    } catch (_: Exception) {}
  }

  private fun persistOcrResult(event: AccessibilityEvent, lines: List<OcrLine>, decision: Decision) {
    val nodes = JSONArray()
    val summary = "99 • R$ ${format2(decision.fare)} • TOTAL ${format1(decision.totalKm)} km • ${decision.totalMinutes} min • R$ ${format2(decision.reaisPerKm)}/km • R$ ${format2(decision.reaisPerHour)}/h"
    nodes.put(nodeJson(summary, Rect(0, 0, 0, 0), event.windowId))

    val seen = HashSet<String>()
    for (line in lines) {
      if (nodes.length() >= MAX_OCR_LINES) break
      if (!isOperational(line.text)) continue
      val key = normalize(line.text)
      if (!seen.add(key)) continue
      nodes.put(nodeJson(line.text.take(MAX_LINE_CHARS), line.bounds, event.windowId))
    }

    val now = System.currentTimeMillis()
    val snapshot = JSONObject().apply {
      put("packageName", PACKAGE_99)
      put("eventType", event.eventType)
      put("capturedAt", now)
      put("nodeCount", nodes.length())
      put("nodes", nodes)
      put("fingerprint", "screenshotOcr99:${decision.signature}")
      put("truncated", false)
      put("origins", JSONArray().put("screenshotOcr99"))
    }
    try { RideAccessibilityStore.append(applicationContext, snapshot) } catch (_: Exception) {}
  }

  private fun persistRawOperational(event: AccessibilityEvent, lines: List<OcrLine>) {
    val nodes = JSONArray()
    val seen = HashSet<String>()
    for (line in lines) {
      if (nodes.length() >= MAX_OCR_LINES) break
      if (!isOperational(line.text)) continue
      val key = normalize(line.text)
      if (!seen.add(key)) continue
      nodes.put(nodeJson(line.text.take(MAX_LINE_CHARS), line.bounds, event.windowId))
    }
    if (nodes.length() == 0) return
    val now = System.currentTimeMillis()
    val snapshot = JSONObject().apply {
      put("packageName", PACKAGE_99)
      put("eventType", event.eventType)
      put("capturedAt", now)
      put("nodeCount", nodes.length())
      put("nodes", nodes)
      put("fingerprint", "screenshotOcr99Rejected:${now}")
      put("truncated", false)
      put("origins", JSONArray().put("screenshotOcr99"))
    }
    try { RideAccessibilityStore.append(applicationContext, snapshot) } catch (_: Exception) {}
  }

  private fun persistStatus(event: AccessibilityEvent, detail: String) {
    val now = System.currentTimeMillis()
    val node = nodeJson(detail.take(MAX_LINE_CHARS * 2), Rect(0, 0, 0, 0), event.windowId)
    val snapshot = JSONObject().apply {
      put("packageName", PACKAGE_99)
      put("eventType", event.eventType)
      put("capturedAt", now)
      put("nodeCount", 1)
      put("nodes", JSONArray().put(node))
      put("fingerprint", "screenshotOcr99Status:${detail.hashCode()}:$now")
      put("truncated", false)
      put("origins", JSONArray().put("screenshotOcr99"))
    }
    try { RideAccessibilityStore.append(applicationContext, snapshot) } catch (_: Exception) {}
  }

  private fun nodeJson(text: String, bounds: Rect, windowId: Int): JSONObject {
    return JSONObject().apply {
      put("text", text)
      put("viewId", JSONObject.NULL)
      put("className", "Ocr99Line")
      put("left", bounds.left)
      put("top", bounds.top)
      put("right", bounds.right)
      put("bottom", bounds.bottom)
      put("clickable", false)
      put("origin", "screenshotOcr99")
      put("windowId", windowId)
    }
  }

  private fun isOperational(value: String): Boolean {
    val n = normalize(value)
    return FARE_REGEX.containsMatchIn(value) ||
      KM_REGEX.containsMatchIn(value) ||
      METER_REGEX.containsMatchIn(value) ||
      MINUTE_REGEX.containsMatchIn(value) ||
      HOUR_MINUTE_REGEX.containsMatchIn(value) ||
      n.contains("prioritario") || n.contains("prioritário") ||
      n.contains("perfil essencial") || n.contains("tarifa") ||
      n.contains("corridas") || n.contains("parada")
  }

  private fun parseDecimal(value: String): Double? {
    val cleaned = value.trim().replace(" ", "")
    if (cleaned.isBlank()) return null
    return if (cleaned.contains(',')) cleaned.replace(".", "").replace(',', '.').toDoubleOrNull()
    else cleaned.toDoubleOrNull()
  }

  private fun centerY(rect: Rect): Int = rect.top + rect.height() / 2
  private fun normalize(value: String): String = value.lowercase().replace(Regex("""\s+"""), " ").trim()
  private fun format1(value: Double): String = String.format(Locale.US, "%.1f", value).replace('.', ',')
  private fun format2(value: Double): String = String.format(Locale.US, "%.2f", value).replace('.', ',')
  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}

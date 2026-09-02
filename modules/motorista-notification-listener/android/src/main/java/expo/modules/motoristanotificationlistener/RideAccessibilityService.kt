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
import android.view.accessibility.AccessibilityWindowInfo
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
 * Experimental Uber offer reader.
 *
 * Rules:
 * - every decision comes from ONE currently visible Uber card;
 * - Aceitar/Selecionar anchors the bottom of the card;
 * - the largest eligible R$ line is the fare;
 * - route legs are read only between fare and action button;
 * - hour durations such as "1 h e 4 min" are converted to 64 minutes;
 * - mixed/contaminated frames are rejected instead of guessed.
 */
class RideAccessibilityService : AccessibilityService() {
  companion object {
    private const val UBER_PACKAGE = "com.ubercab.driver"
    private const val MIN_CAPTURE_INTERVAL_MS = 500L
    private const val MAX_OCR_LINES = 64
    private const val MAX_LINE_CHARS = 220
    private const val OVERLAY_VISIBLE_MS = 8_000L
    private const val OVERLAY_DEDUPE_MS = 20_000L

    private const val GREEN_PER_KM = 2.10
    private const val YELLOW_PER_KM = 1.70
    private const val GREEN_PER_HOUR = 46.0
    private const val YELLOW_PER_HOUR = 35.0

    private const val MIN_UBER_WINDOW_AREA_RATIO = 0.08
    private const val MIN_UBER_WINDOW_WIDTH_RATIO = 0.40
    private const val MIN_UBER_WINDOW_HEIGHT_RATIO = 0.12

    private val FARE_REGEX = Regex(
      """(?:R\$|RS|R5)\s*([0-9]{1,5}(?:[.,][0-9]{1,2})?)""",
      RegexOption.IGNORE_CASE
    )

    private val DISTANCE_REGEX = Regex(
      """([0-9]{1,3}(?:[.,][0-9]+)?)\s*km\b""",
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

    private val APPROX_PER_KM_REGEX = Regex(
      """(?:R\$|RS|R5)?\s*([0-9]{1,3}(?:[.,][0-9]{1,2})?)\s*/\s*km""",
      RegexOption.IGNORE_CASE
    )

    private val ACTION_REGEX = Regex(
      """\b(?:Aceitar|Selecionar)\b""",
      RegexOption.IGNORE_CASE
    )

    private val STOP_REGEX = Regex(
      """\bparada(?:s)?\b""",
      RegexOption.IGNORE_CASE
    )

    private val OPERATIONAL_PATTERNS = listOf(
      Regex("""(?:R\$|RS|R5)\s*[+]?\s*[0-9]{1,5}(?:[.,][0-9]{1,3})?""", RegexOption.IGNORE_CASE),
      Regex("""[0-9]+(?:[.,][0-9]+)?\s*km\b""", RegexOption.IGNORE_CASE),
      Regex("""[0-9]+\s*(?:min|minuto|minutos)\b""", RegexOption.IGNORE_CASE),
      Regex("""[0-9]+\s*(?:h|hora|horas)\b(?:\s*(?:e)?\s*[0-9]+\s*(?:min|minuto|minutos)\b)?""", RegexOption.IGNORE_CASE),
      Regex("""\bUberX\b|\bComfort\b|\bBlack\b|\bPop\b|\bPriority\b|\bExclusivo\b""", RegexOption.IGNORE_CASE),
      Regex("""\bAceitar\b|\bSelecionar\b|\bRecusar\b""", RegexOption.IGNORE_CASE),
      Regex("""\bparada(?:s)?\b|\bviagem longa\b""", RegexOption.IGNORE_CASE),
      Regex("""\b[1-5][.,][0-9]{1,2}\s*(?:\([0-9]+\))?""", RegexOption.IGNORE_CASE)
    )
  }

  private data class UberWindowSignal(
    val id: Int,
    val type: Int,
    val bounds: Rect,
    val focused: Boolean,
    val active: Boolean
  )

  private data class OcrLineRecord(val text: String, val bounds: Rect)

  private data class OfferCard(
    val lines: List<OcrLineRecord>,
    val mainFareLine: OcrLineRecord,
    val actionLine: OcrLineRecord
  )

  private data class RouteLeg(val minutes: Int, val km: Double, val top: Int)

  private data class DecisionOverlayData(
    val fare: Double,
    val totalKm: Double,
    val totalMinutes: Int,
    val reaisPerKm: Double,
    val reaisPerHour: Double,
    val semaphore: String,
    val hasStops: Boolean,
    val signature: String
  )

  private data class DecisionExtraction(
    val data: DecisionOverlayData?,
    val reason: String
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

    val uberWindow = findBestUberWindow()
    if (!isOfferSizedUberWindow(uberWindow)) return

    val now = System.currentTimeMillis()
    val previous = lastCaptureAt.get()
    if (now - previous < MIN_CAPTURE_INTERVAL_MS) return
    if (!lastCaptureAt.compareAndSet(previous, now)) return
    if (!captureInFlight.compareAndSet(false, true)) return

    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      persistStatus(event, uberWindow, "OCR_PROBE: UNSUPPORTED_API")
      captureInFlight.set(false)
      return
    }

    takeDisplayScreenshot(event, uberWindow)
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

  private fun findBestUberWindow(): UberWindowSignal? {
    var best: UberWindowSignal? = null
    try {
      for (window in windows.orEmpty()) {
        var root = try { window.root } catch (_: Exception) { null }
        try {
          val pkg = try { root?.packageName?.toString()?.lowercase() } catch (_: Exception) { null }
          if (pkg != UBER_PACKAGE) continue

          val bounds = Rect()
          try { window.getBoundsInScreen(bounds) } catch (_: Exception) { bounds.set(0, 0, 0, 0) }
          val candidate = UberWindowSignal(
            id = window.id,
            type = window.type,
            bounds = bounds,
            focused = window.isFocused,
            active = window.isActive
          )
          if (best == null || safeArea(candidate.bounds) > safeArea(best!!.bounds)) best = candidate
        } finally {
          try { root?.recycle() } catch (_: Exception) {}
          root = null
        }
      }
    } catch (_: Exception) {}
    return best
  }

  private fun safeArea(bounds: Rect): Long {
    return bounds.width().coerceAtLeast(0).toLong() * bounds.height().coerceAtLeast(0).toLong()
  }

  private fun isOfferSizedUberWindow(window: UberWindowSignal?): Boolean {
    if (window == null) return false
    val screenW = resources.displayMetrics.widthPixels.coerceAtLeast(1)
    val screenH = resources.displayMetrics.heightPixels.coerceAtLeast(1)
    val screenArea = screenW.toLong() * screenH.toLong()
    val areaRatio = safeArea(window.bounds).toDouble() / screenArea.toDouble()
    val widthRatio = window.bounds.width().toDouble() / screenW.toDouble()
    val heightRatio = window.bounds.height().toDouble() / screenH.toDouble()
    return areaRatio >= MIN_UBER_WINDOW_AREA_RATIO &&
      widthRatio >= MIN_UBER_WINDOW_WIDTH_RATIO &&
      heightRatio >= MIN_UBER_WINDOW_HEIGHT_RATIO
  }

  private fun takeDisplayScreenshot(event: AccessibilityEvent, uberWindow: UberWindowSignal?) {
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
                persistStatus(event, uberWindow, "OCR_PROBE: BITMAP_WRAP_FAILED")
                captureInFlight.set(false)
                return
              }
              softwareBitmap = hardwareBitmap.copy(Bitmap.Config.ARGB_8888, false)
              if (softwareBitmap == null) {
                persistStatus(event, uberWindow, "OCR_PROBE: BITMAP_COPY_FAILED")
                captureInFlight.set(false)
                return
              }
              processBitmap(event, uberWindow, softwareBitmap)
            } catch (_: Exception) {
              try { softwareBitmap?.recycle() } catch (_: Exception) {}
              persistStatus(event, uberWindow, "OCR_PROBE: BITMAP_ERROR")
              captureInFlight.set(false)
            } finally {
              try { hardwareBitmap?.recycle() } catch (_: Exception) {}
              try { buffer.close() } catch (_: Exception) {}
            }
          }

          override fun onFailure(errorCode: Int) {
            try { persistStatus(event, uberWindow, "OCR_PROBE: ${mapError(errorCode)} code=$errorCode") }
            finally { captureInFlight.set(false) }
          }
        }
      )
    } catch (_: SecurityException) {
      persistStatus(event, uberWindow, "OCR_PROBE: SECURITY_EXCEPTION")
      captureInFlight.set(false)
    } catch (_: Exception) {
      persistStatus(event, uberWindow, "OCR_PROBE: INTERNAL_EXCEPTION")
      captureInFlight.set(false)
    }
  }

  private fun processBitmap(event: AccessibilityEvent, uberWindow: UberWindowSignal?, bitmap: Bitmap) {
    val width = bitmap.width
    val height = bitmap.height
    val image = InputImage.fromBitmap(bitmap, 0)

    recognizer.process(image)
      .addOnSuccessListener { result ->
        try {
          val card = extractCurrentOfferCard(result)
          if (card == null) {
            persistStatus(event, uberWindow, "OCR_PROBE: NO_CURRENT_OFFER_CARD")
          } else {
            val extraction = extractDecisionOverlayData(card)
            if (extraction.data != null) showDecisionOverlay(extraction.data)
            else persistStatus(event, uberWindow, "OCR_PROBE: DECISION_REJECTED ${extraction.reason}")
            persistOcrResult(event, uberWindow, card, width, height)
          }
        } catch (_: Exception) {
          persistStatus(event, uberWindow, "OCR_PROBE: RESULT_PROCESSING_ERROR")
        } finally {
          try { bitmap.recycle() } catch (_: Exception) {}
          captureInFlight.set(false)
        }
      }
      .addOnFailureListener { error ->
        try { persistStatus(event, uberWindow, "OCR_PROBE: OCR_ERROR ${error.javaClass.simpleName}") }
        finally {
          try { bitmap.recycle() } catch (_: Exception) {}
          captureInFlight.set(false)
        }
      }
  }

  private fun extractCurrentOfferCard(result: Text): OfferCard? {
    val allLines = mutableListOf<OcrLineRecord>()
    for (block in result.textBlocks) {
      for (line in block.lines) {
        val text = line.text.trim()
        val bounds = line.boundingBox ?: continue
        if (text.isNotBlank()) allLines.add(OcrLineRecord(text, Rect(bounds)))
      }
    }
    if (allLines.isEmpty()) return null

    val actionLine = allLines
      .filter { ACTION_REGEX.containsMatchIn(it.text) }
      .maxByOrNull { centerY(it.bounds) }
      ?: return null

    val eligibleFares = allLines.filter { line ->
      if (line.bounds.bottom >= actionLine.bounds.top) return@filter false
      val normalized = normalize(line.text)
      if (
        normalized.contains("/km") ||
        normalized.contains("aprox") ||
        normalized.contains("incluido") ||
        normalized.contains("incluído") ||
        normalized.trimStart().startsWith("+")
      ) return@filter false
      FARE_REGEX.containsMatchIn(line.text)
    }
    if (eligibleFares.isEmpty()) return null

    val mainFare = eligibleFares.maxWithOrNull(
      compareBy<OcrLineRecord> { it.bounds.height() }
        .thenBy { it.bounds.width() }
        .thenBy { centerY(it.bounds) }
    ) ?: return null

    if (actionLine.bounds.top <= mainFare.bounds.bottom) return null

    val horizontalPad = dp(50)
    val actionCenterX = actionLine.bounds.left + actionLine.bounds.width() / 2
    val cardLeft = (actionCenterX - resources.displayMetrics.widthPixels * 0.50).toInt().coerceAtLeast(0)
    val cardRight = (actionCenterX + resources.displayMetrics.widthPixels * 0.50).toInt()
      .coerceAtMost(resources.displayMetrics.widthPixels)
    val cardTop = (mainFare.bounds.top - dp(130)).coerceAtLeast(0)
    val cardBottom = actionLine.bounds.bottom + dp(20)

    val cardLines = allLines
      .filter {
        val cy = centerY(it.bounds)
        val cx = it.bounds.left + it.bounds.width() / 2
        cy in cardTop..cardBottom && cx in (cardLeft - horizontalPad)..(cardRight + horizontalPad)
      }
      .sortedWith(compareBy<OcrLineRecord> { it.bounds.top }.thenBy { it.bounds.left })

    return OfferCard(cardLines, mainFare, actionLine)
  }

  private fun parseDurationMinutes(text: String): Int? {
    val hourMatch = HOUR_MINUTE_REGEX.find(text)
    if (hourMatch != null) {
      val hours = hourMatch.groupValues.getOrNull(1)?.toIntOrNull() ?: return null
      val mins = hourMatch.groupValues.getOrNull(2)?.toIntOrNull() ?: 0
      val total = hours * 60 + mins
      return total.takeIf { it in 1..360 }
    }

    return MINUTE_REGEX.find(text)
      ?.groupValues?.getOrNull(1)
      ?.toIntOrNull()
      ?.takeIf { it in 1..360 }
  }

  private fun extractRouteLegs(card: OfferCard): List<RouteLeg> {
    val routeLines = card.lines.filter { line ->
      line.bounds.top > card.mainFareLine.bounds.bottom &&
        line.bounds.bottom < card.actionLine.bounds.top &&
        !normalize(line.text).contains("/km") &&
        !normalize(line.text).contains("aprox")
    }

    val direct = LinkedHashMap<String, RouteLeg>()
    routeLines.forEach { line ->
      val minutes = parseDurationMinutes(line.text)
      val distance = DISTANCE_REGEX.find(line.text)?.groupValues?.getOrNull(1)?.let(::parseDecimal)
      if (minutes != null && distance != null && distance > 0.0 && distance <= 150.0) {
        val key = "$minutes|${String.format(Locale.US, "%.2f", distance)}"
        direct.putIfAbsent(key, RouteLeg(minutes, distance, line.bounds.top))
      }
    }

    if (direct.size in 2..3) return direct.values.sortedBy { it.top }

    // ML Kit sometimes splits duration and distance into adjacent OCR lines.
    // Pair only nearby rows inside the isolated Uber card.
    val timeLines = routeLines.mapNotNull { line ->
      parseDurationMinutes(line.text)?.let { it to line }
    }
    val distanceLines = routeLines.mapNotNull { line ->
      DISTANCE_REGEX.find(line.text)?.groupValues?.getOrNull(1)?.let(::parseDecimal)?.let { km -> km to line }
    }

    val usedDistance = HashSet<Int>()
    val paired = LinkedHashMap<String, RouteLeg>()
    for ((minutes, timeLine) in timeLines) {
      var bestIndex = -1
      var bestScore = Int.MAX_VALUE
      distanceLines.forEachIndexed { index, (_, distLine) ->
        if (usedDistance.contains(index)) return@forEachIndexed
        val dy = abs(centerY(timeLine.bounds) - centerY(distLine.bounds))
        val score = dy
        if (score < bestScore) {
          bestScore = score
          bestIndex = index
        }
      }
      if (bestIndex >= 0 && bestScore <= dp(48)) {
        usedDistance.add(bestIndex)
        val km = distanceLines[bestIndex].first
        if (km > 0.0 && km <= 150.0) {
          val key = "$minutes|${String.format(Locale.US, "%.2f", km)}"
          paired.putIfAbsent(key, RouteLeg(minutes, km, minOf(timeLine.bounds.top, distanceLines[bestIndex].second.bounds.top)))
        }
      }
    }

    return paired.values.sortedBy { it.top }
  }

  private fun extractDecisionOverlayData(card: OfferCard): DecisionExtraction {
    val fare = FARE_REGEX.find(card.mainFareLine.text)
      ?.groupValues?.getOrNull(1)
      ?.let(::parseDecimal)
      ?.takeIf { it > 0.0 }
      ?: return DecisionExtraction(null, "fare")

    val routeLegs = extractRouteLegs(card)
    if (routeLegs.size !in 2..3) {
      return DecisionExtraction(null, "legs=${routeLegs.size}")
    }

    val totalMinutes = routeLegs.sumOf { it.minutes }
    val totalKm = routeLegs.sumOf { it.km }
    if (totalMinutes !in 2..360 || totalKm <= 0.0 || totalKm > 200.0) {
      return DecisionExtraction(null, "totals=${totalMinutes}min/${format1(totalKm)}km")
    }

    val reaisPerKm = fare / totalKm
    val reaisPerHour = fare / (totalMinutes / 60.0)

    val uberApproxPerKm = card.lines.asSequence()
      .filter { normalize(it.text).contains("/km") }
      .mapNotNull { APPROX_PER_KM_REGEX.find(it.text)?.groupValues?.getOrNull(1)?.let(::parseDecimal) }
      .firstOrNull { it > 0.0 }

    if (uberApproxPerKm != null) {
      val tolerance = max(0.18, uberApproxPerKm * 0.14)
      if (abs(reaisPerKm - uberApproxPerKm) > tolerance) {
        return DecisionExtraction(
          null,
          "rate expected=${format2(uberApproxPerKm)} actual=${format2(reaisPerKm)}"
        )
      }
    }

    val semaphore = when {
      reaisPerKm >= GREEN_PER_KM && reaisPerHour >= GREEN_PER_HOUR -> "green"
      reaisPerKm < YELLOW_PER_KM || reaisPerHour < YELLOW_PER_HOUR -> "red"
      else -> "yellow"
    }

    val explicitStop = card.lines.any { STOP_REGEX.containsMatchIn(it.text) }
    val hasStops = routeLegs.size == 3 || explicitStop

    val signature = listOf(
      (fare * 100).toInt().toString(),
      String.format(Locale.US, "%.2f", totalKm),
      totalMinutes.toString(),
      hasStops.toString()
    ).joinToString("|")

    return DecisionExtraction(
      DecisionOverlayData(
        fare = fare,
        totalKm = totalKm,
        totalMinutes = totalMinutes,
        reaisPerKm = reaisPerKm,
        reaisPerHour = reaisPerHour,
        semaphore = semaphore,
        hasStops = hasStops,
        signature = signature
      ),
      "ok"
    )
  }

  private fun showDecisionOverlay(data: DecisionOverlayData) {
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
      addView(TextView(this@RideAccessibilityService).apply {
        text = label
        setTextColor(Color.rgb(110, 110, 110))
        textSize = 13f
      })
      addView(TextView(this@RideAccessibilityService).apply {
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

  private fun persistOcrResult(
    event: AccessibilityEvent,
    uberWindow: UberWindowSignal?,
    card: OfferCard,
    width: Int,
    height: Int
  ) {
    val nodes = JSONArray()
    val seen = HashSet<String>()

    for (line in card.lines) {
      if (nodes.length() >= MAX_OCR_LINES) break
      val raw = line.text.trim()
      if (raw.isBlank() || !isOperational(raw)) continue
      val normalized = normalize(raw)
      if (!seen.add(normalized)) continue

      nodes.put(JSONObject().apply {
        put("text", raw.take(MAX_LINE_CHARS))
        put("viewId", JSONObject.NULL)
        put("className", "OcrLine")
        put("left", line.bounds.left)
        put("top", line.bounds.top)
        put("right", line.bounds.right)
        put("bottom", line.bounds.bottom)
        put("clickable", ACTION_REGEX.containsMatchIn(raw))
        put("origin", "screenshotOcr")
        put("windowId", uberWindow?.id ?: event.windowId)
      })
    }

    if (nodes.length() == 0) {
      persistStatus(event, uberWindow, "OCR_PROBE: CURRENT_CARD_NO_OPERATIONAL_TEXT")
      return
    }

    val now = System.currentTimeMillis()
    val signature = buildString {
      for (i in 0 until nodes.length()) append(nodes.optJSONObject(i)?.optString("text", "")).append('|')
    }.hashCode()

    val snapshot = JSONObject().apply {
      put("packageName", UBER_PACKAGE)
      put("eventType", event.eventType)
      put("capturedAt", now)
      put("nodeCount", nodes.length())
      put("nodes", nodes)
      put("fingerprint", "screenshotOcrCard:$signature")
      put("truncated", false)
      put("ocrFrameWidth", width)
      put("ocrFrameHeight", height)
      put("targetWindowId", uberWindow?.id ?: JSONObject.NULL)
      put("targetWindowType", uberWindow?.type ?: JSONObject.NULL)
      put("targetWindowBounds", uberWindow?.bounds?.let { rectToJson(it) } ?: JSONObject.NULL)
      put("origins", JSONArray().put("screenshotOcr"))
    }

    try { RideAccessibilityStore.append(applicationContext, snapshot) } catch (_: Exception) {}
  }

  private fun persistStatus(event: AccessibilityEvent, uberWindow: UberWindowSignal?, detail: String) {
    val now = System.currentTimeMillis()
    val safeMeta = buildString {
      append(detail)
      if (uberWindow != null) {
        append(" • uberWindow=").append(uberWindow.id)
        append(" type=").append(windowTypeName(uberWindow.type))
        append(" bounds=")
          .append(uberWindow.bounds.left).append(',')
          .append(uberWindow.bounds.top).append('-')
          .append(uberWindow.bounds.right).append(',')
          .append(uberWindow.bounds.bottom)
      } else append(" • uberWindow=none")
    }

    val node = JSONObject().apply {
      put("text", safeMeta.take(MAX_LINE_CHARS * 2))
      put("viewId", JSONObject.NULL)
      put("className", "ScreenshotOcrProbe")
      put("left", 0)
      put("top", 0)
      put("right", 0)
      put("bottom", 0)
      put("clickable", false)
      put("origin", "screenshotOcr")
      put("windowId", uberWindow?.id ?: event.windowId)
    }

    val snapshot = JSONObject().apply {
      put("packageName", UBER_PACKAGE)
      put("eventType", event.eventType)
      put("capturedAt", now)
      put("nodeCount", 1)
      put("nodes", JSONArray().put(node))
      put("fingerprint", "screenshotOcrStatus:${safeMeta.hashCode()}:$now")
      put("truncated", false)
      put("origins", JSONArray().put("screenshotOcr"))
    }

    try { RideAccessibilityStore.append(applicationContext, snapshot) } catch (_: Exception) {}
  }

  private fun centerY(rect: Rect): Int = rect.top + (rect.height() / 2)

  private fun parseDecimal(value: String): Double? {
    val cleaned = value.trim().replace(" ", "")
    if (cleaned.isBlank()) return null
    return when {
      cleaned.contains(',') -> cleaned.replace(".", "").replace(',', '.').toDoubleOrNull()
      else -> cleaned.toDoubleOrNull()
    }
  }

  private fun rectToJson(rect: Rect): JSONObject {
    return JSONObject().apply {
      put("left", rect.left)
      put("top", rect.top)
      put("right", rect.right)
      put("bottom", rect.bottom)
    }
  }

  private fun windowTypeName(type: Int): String {
    return when (type) {
      AccessibilityWindowInfo.TYPE_APPLICATION -> "APPLICATION"
      AccessibilityWindowInfo.TYPE_SYSTEM -> "SYSTEM"
      AccessibilityWindowInfo.TYPE_INPUT_METHOD -> "INPUT_METHOD"
      AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY -> "ACCESSIBILITY_OVERLAY"
      else -> type.toString()
    }
  }

  private fun isOperational(value: String): Boolean {
    return OPERATIONAL_PATTERNS.any { it.containsMatchIn(value) }
  }

  private fun normalize(value: String): String {
    return value.lowercase().replace(Regex("""\s+"""), " ").trim()
  }

  private fun format1(value: Double): String {
    return String.format(Locale.US, "%.1f", value).replace('.', ',')
  }

  private fun format2(value: Double): String {
    return String.format(Locale.US, "%.2f", value).replace('.', ',')
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  private fun mapError(code: Int): String {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return "UNSUPPORTED_API"
    return when (code) {
      ERROR_TAKE_SCREENSHOT_INTERNAL_ERROR -> "INTERNAL_ERROR"
      ERROR_TAKE_SCREENSHOT_NO_ACCESSIBILITY_ACCESS -> "NO_ACCESSIBILITY_ACCESS"
      ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT -> "INTERVAL_TIME_SHORT"
      ERROR_TAKE_SCREENSHOT_INVALID_DISPLAY -> "INVALID_DISPLAY"
      ERROR_TAKE_SCREENSHOT_SECURE_WINDOW -> "SECURE_WINDOW"
      else -> "ERROR_$code"
    }
  }
}

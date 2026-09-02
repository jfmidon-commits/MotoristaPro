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

/**
 * EXPERIMENTAL BRANCH ONLY.
 *
 * Pipeline:
 * Uber overlay/window signal -> AccessibilityService.takeScreenshot() ->
 * on-device ML Kit OCR -> persist only operational OCR lines ->
 * existing TypeScript AccessibilityOfferParser.
 *
 * When the OCR has enough information to calculate the COMPLETE offer
 * (pickup + trip), this service also renders a non-touchable accessibility
 * overlay with the decision metrics. No raw screenshots are persisted.
 */
class RideAccessibilityService : AccessibilityService() {
  companion object {
    private const val UBER_PACKAGE = "com.ubercab.driver"
    private val LAUNCHER_PACKAGES = setOf("com.miui.home", "com.android.launcher3")

    private const val MIN_CAPTURE_INTERVAL_MS = 550L
    private const val RECENT_UBER_SIGNAL_TTL_MS = 3_000L
    private const val MAX_OCR_LINES = 48
    private const val MAX_LINE_CHARS = 180
    private const val OVERLAY_VISIBLE_MS = 8_000L
    private const val OVERLAY_DEDUPE_MS = 30_000L

    // Initial thresholds copied from the driver's current configuration.
    private const val GREEN_PER_KM = 2.10
    private const val YELLOW_PER_KM = 1.70
    private const val GREEN_PER_HOUR = 46.0
    private const val YELLOW_PER_HOUR = 35.0

    private val OPERATIONAL_PATTERNS = listOf(
      Regex("""(?:R\$|RS|R5)\s*[+]?\s*[0-9]{1,5}(?:[.,][0-9]{1,3})?""", RegexOption.IGNORE_CASE),
      Regex("""[0-9]+(?:[.,][0-9]+)?\s*km\b""", RegexOption.IGNORE_CASE),
      Regex("""[0-9]+(?:[.,][0-9]+)?\s*m\b""", RegexOption.IGNORE_CASE),
      Regex("""[0-9]+(?:[.,][0-9]+)?\s*(?:min|minuto|minutos)\b""", RegexOption.IGNORE_CASE),
      Regex("""\bUberX\b|\bComfort\b|\bBlack\b|\bPop\b|\bPriority\b|\bExclusivo\b""", RegexOption.IGNORE_CASE),
      Regex("""\bAceitar\b|\bRecusar\b|\boferta\b|\bnova corrida\b|\bsolicita[cç][aã]o\b""", RegexOption.IGNORE_CASE),
      Regex("""\bparada(?:s)?\b""", RegexOption.IGNORE_CASE),
      Regex("""\b[1-5][.,][0-9]{1,2}\s*(?:\([0-9]+\))?""", RegexOption.IGNORE_CASE)
    )

    private val FARE_REGEX = Regex(
      """(?:R\$|RS|R5)\s*([0-9]{1,5}(?:[.,][0-9]{1,2})?)""",
      RegexOption.IGNORE_CASE
    )
    private val TIME_REGEX = Regex(
      """([0-9]{1,3})\s*(?:min|minuto|minutos)\b""",
      RegexOption.IGNORE_CASE
    )
    private val DISTANCE_REGEX = Regex(
      """([0-9]{1,3}(?:[.,][0-9]+)?)\s*km\b""",
      RegexOption.IGNORE_CASE
    )
  }

  private data class UberWindowSignal(
    val id: Int,
    val type: Int,
    val bounds: Rect,
    val focused: Boolean,
    val active: Boolean
  )

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

  private val lastCaptureAt = AtomicLong(0L)
  private val lastUberSignalAt = AtomicLong(0L)
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
    if (event == null) return
    if (!isRelevantEventType(event.eventType)) return

    val eventPackage = event.packageName?.toString()?.lowercase().orEmpty()
    val now = System.currentTimeMillis()

    if (eventPackage == UBER_PACKAGE) {
      lastUberSignalAt.set(now)
    }

    val uberWindow = findBestUberWindow()
    val recentUberSignal = now - lastUberSignalAt.get() <= RECENT_UBER_SIGNAL_TTL_MS

    val shouldInspect =
      eventPackage == UBER_PACKAGE ||
        uberWindow != null ||
        (eventPackage in LAUNCHER_PACKAGES && recentUberSignal)

    if (!shouldInspect) return

    val previous = lastCaptureAt.get()
    if (now - previous < MIN_CAPTURE_INTERVAL_MS) return
    if (!lastCaptureAt.compareAndSet(previous, now)) return
    if (!captureInFlight.compareAndSet(false, true)) return

    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      persistStatus(event, uberWindow, eventPackage, "OCR_PROBE: UNSUPPORTED_API")
      captureInFlight.set(false)
      return
    }

    takeDisplayScreenshot(event, uberWindow, eventPackage)
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

  /**
   * The focused window can be Xiaomi Home while the Uber offer is still visible.
   * Enumerating AccessibilityService.windows is therefore part of detection, not parsing.
   */
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

          val candidateArea = safeArea(candidate.bounds)
          val bestArea = best?.let { safeArea(it.bounds) } ?: -1L
          if (best == null || candidateArea > bestArea) {
            best = candidate
          }
        } finally {
          try { root?.recycle() } catch (_: Exception) {}
          root = null
        }
      }
    } catch (_: Exception) {
    }
    return best
  }

  private fun safeArea(bounds: Rect): Long {
    val w = bounds.width().coerceAtLeast(0)
    val h = bounds.height().coerceAtLeast(0)
    return w.toLong() * h.toLong()
  }

  private fun takeDisplayScreenshot(
    event: AccessibilityEvent,
    uberWindow: UberWindowSignal?,
    triggerPackage: String
  ) {
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
                persistStatus(event, uberWindow, triggerPackage, "OCR_PROBE: BITMAP_WRAP_FAILED")
                captureInFlight.set(false)
                return
              }

              softwareBitmap = hardwareBitmap.copy(Bitmap.Config.ARGB_8888, false)
              if (softwareBitmap == null) {
                persistStatus(event, uberWindow, triggerPackage, "OCR_PROBE: BITMAP_COPY_FAILED")
                captureInFlight.set(false)
                return
              }

              processBitmap(event, uberWindow, triggerPackage, softwareBitmap)
            } catch (_: Exception) {
              try { softwareBitmap?.recycle() } catch (_: Exception) {}
              persistStatus(event, uberWindow, triggerPackage, "OCR_PROBE: BITMAP_ERROR")
              captureInFlight.set(false)
            } finally {
              try { hardwareBitmap?.recycle() } catch (_: Exception) {}
              try { buffer.close() } catch (_: Exception) {}
            }
          }

          override fun onFailure(errorCode: Int) {
            try {
              persistStatus(
                event,
                uberWindow,
                triggerPackage,
                "OCR_PROBE: ${mapError(errorCode)} code=$errorCode"
              )
            } finally {
              captureInFlight.set(false)
            }
          }
        }
      )
    } catch (_: SecurityException) {
      persistStatus(event, uberWindow, triggerPackage, "OCR_PROBE: SECURITY_EXCEPTION")
      captureInFlight.set(false)
    } catch (_: Exception) {
      persistStatus(event, uberWindow, triggerPackage, "OCR_PROBE: INTERNAL_EXCEPTION")
      captureInFlight.set(false)
    }
  }

  private fun processBitmap(
    event: AccessibilityEvent,
    uberWindow: UberWindowSignal?,
    triggerPackage: String,
    bitmap: Bitmap
  ) {
    val width = bitmap.width
    val height = bitmap.height
    val image = InputImage.fromBitmap(bitmap, 0)

    recognizer.process(image)
      .addOnSuccessListener { result ->
        try {
          extractDecisionOverlayData(result)?.let { showDecisionOverlay(it) }
          persistOcrResult(event, uberWindow, triggerPackage, result, width, height)
        } catch (_: Exception) {
          persistStatus(event, uberWindow, triggerPackage, "OCR_PROBE: RESULT_PROCESSING_ERROR")
        } finally {
          try { bitmap.recycle() } catch (_: Exception) {}
          captureInFlight.set(false)
        }
      }
      .addOnFailureListener { error ->
        try {
          persistStatus(
            event,
            uberWindow,
            triggerPackage,
            "OCR_PROBE: OCR_ERROR ${error.javaClass.simpleName}"
          )
        } finally {
          try { bitmap.recycle() } catch (_: Exception) {}
          captureInFlight.set(false)
        }
      }
  }

  /**
   * Build decision data only from a COMPLETE Uber card.
   * We require at least two time-distance route legs so a partial OCR frame cannot
   * be mistaken for the total. The normal card has pickup + passenger trip; cards
   * with an intermediate stop may expose more legs and all legs are summed.
   */
  private fun extractDecisionOverlayData(result: Text): DecisionOverlayData? {
    val lines = mutableListOf<String>()
    for (block in result.textBlocks) {
      for (line in block.lines) {
        val value = line.text.trim()
        if (value.isNotBlank()) lines.add(value)
      }
    }

    val fare = lines.asSequence()
      .filterNot { line ->
        val normalized = normalize(line)
        normalized.contains("/km") ||
          normalized.contains("aprox") ||
          normalized.contains("incluido") ||
          normalized.contains("incluído") ||
          normalized.trimStart().startsWith("+")
      }
      .mapNotNull { line -> FARE_REGEX.find(line)?.groupValues?.getOrNull(1)?.let(::parseDecimal) }
      .firstOrNull { it > 0.0 }
      ?: return null

    val routeTimes = mutableListOf<Int>()
    val routeDistances = mutableListOf<Double>()

    for (line in lines) {
      val normalized = normalize(line)
      if (normalized.contains("/km") || normalized.contains("aprox")) continue

      val time = TIME_REGEX.find(line)?.groupValues?.getOrNull(1)?.toIntOrNull()
      val distance = DISTANCE_REGEX.find(line)?.groupValues?.getOrNull(1)?.let(::parseDecimal)
      if (time != null && time > 0 && distance != null && distance > 0.0) {
        routeTimes.add(time)
        routeDistances.add(distance)
      }
    }

    // Safety first: do not show a decision from an incomplete frame.
    if (routeTimes.size < 2 || routeDistances.size < 2) return null

    val totalMinutes = routeTimes.sum()
    val totalKm = routeDistances.sum()
    if (totalMinutes <= 0 || totalKm <= 0.0) return null

    val reaisPerKm = fare / totalKm
    val reaisPerHour = fare / (totalMinutes / 60.0)
    val semaphore = when {
      reaisPerKm >= GREEN_PER_KM && reaisPerHour >= GREEN_PER_HOUR -> "green"
      reaisPerKm < YELLOW_PER_KM || reaisPerHour < YELLOW_PER_HOUR -> "red"
      else -> "yellow"
    }

    val hasStops = routeDistances.size > 2 || lines.any {
      Regex("""\bparada(?:s)?\b""", RegexOption.IGNORE_CASE).containsMatchIn(it)
    }

    val signature = listOf(
      (fare * 100).toInt().toString(),
      String.format(Locale.US, "%.2f", totalKm),
      totalMinutes.toString(),
      hasStops.toString()
    ).joinToString("|")

    return DecisionOverlayData(
      fare = fare,
      totalKm = totalKm,
      totalMinutes = totalMinutes,
      reaisPerKm = reaisPerKm,
      reaisPerHour = reaisPerHour,
      semaphore = semaphore,
      hasStops = hasStops,
      signature = signature
    )
  }

  private fun parseDecimal(value: String): Double? {
    return value.replace(".", "").replace(',', '.').toDoubleOrNull()
  }

  private fun showDecisionOverlay(data: DecisionOverlayData) {
    val now = System.currentTimeMillis()
    if (data.signature == lastOverlaySignature && now - lastOverlayAt <= OVERLAY_DEDUPE_MS) {
      return
    }
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
    } catch (_: Exception) {
    }
  }

  private fun dp(value: Int): Int {
    return (value * resources.displayMetrics.density).toInt()
  }

  private fun format1(value: Double): String {
    return String.format(Locale.US, "%.1f", value).replace('.', ',')
  }

  private fun format2(value: Double): String {
    return String.format(Locale.US, "%.2f", value).replace('.', ',')
  }

  private fun persistOcrResult(
    event: AccessibilityEvent,
    uberWindow: UberWindowSignal?,
    triggerPackage: String,
    result: Text,
    width: Int,
    height: Int
  ) {
    val nodes = JSONArray()
    val seen = HashSet<String>()
    var detectedLineCount = 0

    for (block in result.textBlocks) {
      for (line in block.lines) {
        detectedLineCount++
        if (nodes.length() >= MAX_OCR_LINES) break

        val raw = line.text.trim()
        if (raw.isBlank() || !isOperational(raw)) continue

        val normalized = normalize(raw)
        if (!seen.add(normalized)) continue

        val bounds = line.boundingBox
        nodes.put(JSONObject().apply {
          put("text", raw.take(MAX_LINE_CHARS))
          put("viewId", JSONObject.NULL)
          put("className", "OcrLine")
          put("left", bounds?.left ?: 0)
          put("top", bounds?.top ?: 0)
          put("right", bounds?.right ?: 0)
          put("bottom", bounds?.bottom ?: 0)
          put("clickable", acceptMarker(raw))
          put("origin", "screenshotOcr")
          put("windowId", uberWindow?.id ?: event.windowId)
        })
      }
    }

    if (nodes.length() == 0) {
      persistStatus(
        event,
        uberWindow,
        triggerPackage,
        "OCR_PROBE: SUCCESS ${width}x${height} • NO_OPERATIONAL_TEXT • lines=$detectedLineCount"
      )
      return
    }

    val now = System.currentTimeMillis()
    val signature = buildString {
      for (i in 0 until nodes.length()) {
        append(nodes.optJSONObject(i)?.optString("text", "")).append('|')
      }
    }.hashCode()

    val snapshot = JSONObject().apply {
      put("packageName", UBER_PACKAGE)
      put("eventType", event.eventType)
      put("capturedAt", now)
      put("nodeCount", nodes.length())
      put("nodes", nodes)
      put("fingerprint", "screenshotOcr:$signature")
      put("truncated", false)
      put("triggerPackage", triggerPackage)
      put("ocrDetectedLineCount", detectedLineCount)
      put("targetWindowId", uberWindow?.id ?: JSONObject.NULL)
      put("targetWindowType", uberWindow?.type ?: JSONObject.NULL)
      put("targetWindowBounds", uberWindow?.bounds?.let { rectToJson(it) } ?: JSONObject.NULL)
      put("origins", JSONArray().put("screenshotOcr"))
    }

    try {
      RideAccessibilityStore.append(applicationContext, snapshot)
    } catch (_: Exception) {
    }
  }

  private fun persistStatus(
    event: AccessibilityEvent,
    uberWindow: UberWindowSignal?,
    triggerPackage: String,
    detail: String
  ) {
    val now = System.currentTimeMillis()
    val safeMeta = buildString {
      append(detail)
      append(" • trigger=").append(triggerPackage.ifBlank { "unknown" })
      if (uberWindow != null) {
        append(" • uberWindow=").append(uberWindow.id)
        append(" type=").append(windowTypeName(uberWindow.type))
        append(" bounds=")
          .append(uberWindow.bounds.left).append(',')
          .append(uberWindow.bounds.top).append('-')
          .append(uberWindow.bounds.right).append(',')
          .append(uberWindow.bounds.bottom)
      } else {
        append(" • uberWindow=none")
      }
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
      put("triggerPackage", triggerPackage)
      put("origins", JSONArray().put("screenshotOcr"))
    }

    try {
      RideAccessibilityStore.append(applicationContext, snapshot)
    } catch (_: Exception) {
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

  private fun acceptMarker(value: String): Boolean {
    return Regex("""\bAceitar\b""", RegexOption.IGNORE_CASE).containsMatchIn(value)
  }

  private fun normalize(value: String): String {
    return value.lowercase().replace(Regex("""\s+"""), " ").trim()
  }

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

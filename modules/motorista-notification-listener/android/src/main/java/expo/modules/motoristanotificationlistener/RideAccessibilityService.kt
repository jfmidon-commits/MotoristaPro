package expo.modules.motoristanotificationlistener

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Build
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityWindowInfo
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * EXPERIMENTAL BRANCH ONLY.
 *
 * Pipeline under test:
 * Uber overlay/window signal -> AccessibilityService.takeScreenshot() ->
 * on-device ML Kit OCR -> persist only operational OCR lines ->
 * existing TypeScript AccessibilityOfferParser.
 *
 * Important: on Xiaomi the Uber offer can be visually over com.miui.home.
 * Therefore we cannot require event.packageName == com.ubercab.driver.
 * We observe launcher events too and verify whether an Uber accessibility window exists.
 *
 * Raw screenshots are never persisted. Address/name-only OCR lines are discarded.
 */
class RideAccessibilityService : AccessibilityService() {
  companion object {
    private const val UBER_PACKAGE = "com.ubercab.driver"
    private val LAUNCHER_PACKAGES = setOf("com.miui.home", "com.android.launcher3")

    private const val MIN_CAPTURE_INTERVAL_MS = 900L
    private const val RECENT_UBER_SIGNAL_TTL_MS = 3_000L
    private const val MAX_OCR_LINES = 48
    private const val MAX_LINE_CHARS = 180

    private val OPERATIONAL_PATTERNS = listOf(
      Regex("""(?:R\$|RS|R5)\s*[+]?\s*[0-9]{1,5}(?:[.,][0-9]{1,3})?""", RegexOption.IGNORE_CASE),
      Regex("""[0-9]+(?:[.,][0-9]+)?\s*km\b""", RegexOption.IGNORE_CASE),
      Regex("""[0-9]+(?:[.,][0-9]+)?\s*m\b""", RegexOption.IGNORE_CASE),
      Regex("""[0-9]+(?:[.,][0-9]+)?\s*(?:min|minuto|minutos)\b""", RegexOption.IGNORE_CASE),
      Regex("""\bUberX\b|\bComfort\b|\bBlack\b|\bPop\b|\bExclusivo\b""", RegexOption.IGNORE_CASE),
      Regex("""\bAceitar\b|\bRecusar\b|\boferta\b|\bnova corrida\b|\bsolicita[cç][aã]o\b""", RegexOption.IGNORE_CASE),
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

  private val lastCaptureAt = AtomicLong(0L)
  private val lastUberSignalAt = AtomicLong(0L)
  private val captureInFlight = AtomicBoolean(false)
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

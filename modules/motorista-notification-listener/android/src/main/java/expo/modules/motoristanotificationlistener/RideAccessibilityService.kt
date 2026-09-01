package expo.modules.motoristanotificationlistener

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.os.Build
import android.view.Display
import android.view.accessibility.AccessibilityEvent
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
 * Uber accessibility event -> AccessibilityService.takeScreenshot() ->
 * on-device ML Kit OCR -> persist ONLY operational OCR lines into the existing
 * diagnostic queue -> existing TypeScript AccessibilityOfferParser consumes them.
 *
 * Raw screenshots are never persisted. Address/name-only OCR lines are discarded.
 */
class RideAccessibilityService : AccessibilityService() {
  companion object {
    private const val UBER_PACKAGE = "com.ubercab.driver"
    private const val MIN_PROBE_INTERVAL_MS = 1_200L
    private const val MAX_OCR_LINES = 40
    private const val MAX_LINE_CHARS = 160

    private val OPERATIONAL_PATTERNS = listOf(
      Regex("""R\$\s*[0-9]{1,5}(?:\.[0-9]{3})*(?:[,.][0-9]{1,2})?""", RegexOption.IGNORE_CASE),
      Regex("""[0-9]+(?:[.,][0-9]+)?\s*km\b""", RegexOption.IGNORE_CASE),
      Regex("""[0-9]+(?:[.,][0-9]+)?\s*m\b""", RegexOption.IGNORE_CASE),
      Regex("""[0-9]+(?:[.,][0-9]+)?\s*(?:min|minuto|minutos)\b""", RegexOption.IGNORE_CASE),
      Regex("""\bUberX\b|\bComfort\b|\bBlack\b|\bPop\b|\bExclusivo\b""", RegexOption.IGNORE_CASE),
      Regex("""\bAceitar\b|\bRecusar\b|\boferta\b|\bnova corrida\b|\bsolicita[cç][aã]o\b""", RegexOption.IGNORE_CASE),
      Regex("""\b[1-5][.,][0-9]{1,2}\s*(?:\([0-9]+\))?""", RegexOption.IGNORE_CASE)
    )
  }

  private val lastProbeAt = AtomicLong(0L)
  private val probeInFlight = AtomicBoolean(false)
  private val recognizer by lazy {
    TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event == null) return
    if (event.packageName?.toString()?.lowercase() != UBER_PACKAGE) return
    if (
      event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
      event.eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
    ) return

    val now = System.currentTimeMillis()
    val previous = lastProbeAt.get()
    if (now - previous < MIN_PROBE_INTERVAL_MS) return
    if (!lastProbeAt.compareAndSet(previous, now)) return
    if (!probeInFlight.compareAndSet(false, true)) return

    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      persistStatus(event, "OCR_PROBE: UNSUPPORTED_API")
      probeInFlight.set(false)
      return
    }

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
                persistStatus(event, "OCR_PROBE: BITMAP_WRAP_FAILED")
                probeInFlight.set(false)
                return
              }

              softwareBitmap = hardwareBitmap.copy(Bitmap.Config.ARGB_8888, false)
              if (softwareBitmap == null) {
                persistStatus(event, "OCR_PROBE: BITMAP_COPY_FAILED")
                probeInFlight.set(false)
                return
              }

              val image = InputImage.fromBitmap(softwareBitmap, 0)
              recognizer.process(image)
                .addOnSuccessListener { result ->
                  try {
                    persistOcrResult(event, result, softwareBitmap.width, softwareBitmap.height)
                  } catch (_: Exception) {
                    persistStatus(event, "OCR_PROBE: RESULT_PROCESSING_ERROR")
                  } finally {
                    try { softwareBitmap.recycle() } catch (_: Exception) {}
                    probeInFlight.set(false)
                  }
                }
                .addOnFailureListener { error ->
                  try {
                    persistStatus(event, "OCR_PROBE: OCR_ERROR ${error.javaClass.simpleName}")
                  } finally {
                    try { softwareBitmap.recycle() } catch (_: Exception) {}
                    probeInFlight.set(false)
                  }
                }
            } catch (_: Exception) {
              try { softwareBitmap?.recycle() } catch (_: Exception) {}
              persistStatus(event, "OCR_PROBE: BITMAP_ERROR")
              probeInFlight.set(false)
            } finally {
              try { hardwareBitmap?.recycle() } catch (_: Exception) {}
              try { buffer.close() } catch (_: Exception) {}
            }
          }

          override fun onFailure(errorCode: Int) {
            try {
              persistStatus(event, "OCR_PROBE: ${mapError(errorCode)} code=$errorCode")
            } finally {
              probeInFlight.set(false)
            }
          }
        }
      )
    } catch (_: SecurityException) {
      persistStatus(event, "OCR_PROBE: SECURITY_EXCEPTION")
      probeInFlight.set(false)
    } catch (_: Exception) {
      persistStatus(event, "OCR_PROBE: INTERNAL_EXCEPTION")
      probeInFlight.set(false)
    }
  }

  override fun onInterrupt() {}

  override fun onDestroy() {
    try { recognizer.close() } catch (_: Exception) {}
    super.onDestroy()
  }

  private fun persistOcrResult(
    event: AccessibilityEvent,
    result: Text,
    width: Int,
    height: Int
  ) {
    val nodes = JSONArray()
    val seen = HashSet<String>()

    for (block in result.textBlocks) {
      for (line in block.lines) {
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
          put("windowId", event.windowId)
        })
      }
    }

    if (nodes.length() == 0) {
      persistStatus(event, "OCR_PROBE: SUCCESS ${width}x${height} • NO_OPERATIONAL_TEXT")
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
      put("origins", JSONArray().put("screenshotOcr"))
    }

    try {
      RideAccessibilityStore.append(applicationContext, snapshot)
    } catch (_: Exception) {
    }
  }

  private fun persistStatus(event: AccessibilityEvent, detail: String) {
    val now = System.currentTimeMillis()
    val node = JSONObject().apply {
      put("text", detail)
      put("viewId", JSONObject.NULL)
      put("className", "ScreenshotOcrProbe")
      put("left", 0)
      put("top", 0)
      put("right", 0)
      put("bottom", 0)
      put("clickable", false)
      put("origin", "screenshotOcr")
      put("windowId", event.windowId)
    }

    val snapshot = JSONObject().apply {
      put("packageName", UBER_PACKAGE)
      put("eventType", event.eventType)
      put("capturedAt", now)
      put("nodeCount", 1)
      put("nodes", JSONArray().put(node))
      put("fingerprint", "screenshotOcrStatus:$detail:$now")
      put("truncated", false)
      put("origins", JSONArray().put("screenshotOcr"))
    }

    try {
      RideAccessibilityStore.append(applicationContext, snapshot)
    } catch (_: Exception) {
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

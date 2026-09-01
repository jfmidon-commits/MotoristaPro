package expo.modules.motoristanotificationlistener

import android.accessibilityservice.AccessibilityService
import android.os.Build
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * EXPERIMENTAL BRANCH ONLY.
 *
 * This service answers one question before OCR is added: can Android's
 * AccessibilityService.takeScreenshot() obtain pixels while Uber Driver is on
 * screen? No screenshot bytes are persisted. Only SUCCESS/ERROR and dimensions
 * are written into the existing local diagnostic queue.
 */
class RideAccessibilityService : AccessibilityService() {
  companion object {
    private const val UBER_PACKAGE = "com.ubercab.driver"
    private const val MIN_PROBE_INTERVAL_MS = 1_500L
  }

  private val lastProbeAt = AtomicLong(0L)
  private val probeInFlight = AtomicBoolean(false)

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
      persistResult(event, "UNSUPPORTED_API", null, null, null)
      probeInFlight.set(false)
      return
    }

    try {
      takeScreenshot(
        Display.DEFAULT_DISPLAY,
        mainExecutor,
        object : TakeScreenshotCallback {
          override fun onSuccess(screenshot: ScreenshotResult) {
            try {
              val buffer = screenshot.hardwareBuffer
              persistResult(event, "SUCCESS", buffer.width, buffer.height, null)
              try {
                buffer.close()
              } catch (_: Exception) {
              }
            } catch (_: Exception) {
              persistResult(event, "SUCCESS_METADATA_ERROR", null, null, null)
            } finally {
              probeInFlight.set(false)
            }
          }

          override fun onFailure(errorCode: Int) {
            try {
              persistResult(event, mapError(errorCode), null, null, errorCode)
            } finally {
              probeInFlight.set(false)
            }
          }
        }
      )
    } catch (_: SecurityException) {
      persistResult(event, "SECURITY_EXCEPTION", null, null, null)
      probeInFlight.set(false)
    } catch (_: Exception) {
      persistResult(event, "INTERNAL_EXCEPTION", null, null, null)
      probeInFlight.set(false)
    }
  }

  override fun onInterrupt() {}

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

  private fun persistResult(
    event: AccessibilityEvent,
    status: String,
    width: Int?,
    height: Int?,
    errorCode: Int?
  ) {
    val now = System.currentTimeMillis()
    val detail = buildString {
      append("SCREENSHOT_PROBE: ").append(status)
      if (width != null && height != null) append(" ").append(width).append("x").append(height)
      if (errorCode != null) append(" code=").append(errorCode)
    }

    val node = JSONObject().apply {
      put("text", detail)
      put("viewId", JSONObject.NULL)
      put("className", "ScreenshotProbe")
      put("left", 0)
      put("top", 0)
      put("right", 0)
      put("bottom", 0)
      put("clickable", false)
      put("origin", "screenshotProbe")
      put("windowId", event.windowId)
    }

    val snapshot = JSONObject().apply {
      put("packageName", UBER_PACKAGE)
      put("eventType", event.eventType)
      put("capturedAt", now)
      put("nodeCount", 1)
      put("nodes", JSONArray().put(node))
      put("fingerprint", "screenshotProbe:$status:$now")
      put("truncated", false)
      put("origins", JSONArray().put("screenshotProbe"))
    }

    try {
      RideAccessibilityStore.append(applicationContext, snapshot)
    } catch (_: Exception) {
    }
  }
}

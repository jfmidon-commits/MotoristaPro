package expo.modules.motoristanotificationlistener

import android.os.SystemClock
import org.json.JSONObject

/** The only runtime entry point for display screenshots in active services. */
internal object ScreenshotCaptureCoordinator {
  private const val MIN_START_INTERVAL_MS = 700L
  private const val LEASE_TIMEOUT_MS = 12_000L
  private const val MIN_RETRY_DELAY_MS = 180L
  private const val MAX_RETRY_DELAY_MS = 750L

  private val governor = CaptureLeaseGovernor(
    minStartIntervalMs = MIN_START_INTERVAL_MS,
    leaseTimeoutMs = LEASE_TIMEOUT_MS
  )

  fun tryAcquire(owner: String): CaptureLease? {
    return governor.tryAcquire(owner, SystemClock.elapsedRealtime())
  }

  fun release(lease: CaptureLease): Boolean {
    return governor.release(lease)
  }

  fun isActive(lease: CaptureLease): Boolean {
    return governor.isActive(lease, SystemClock.elapsedRealtime())
  }

  fun suggestedRetryDelayMs(): Long {
    val exact = governor.retryAfterMs(SystemClock.elapsedRealtime())
    if (exact <= 0L) return MIN_RETRY_DELAY_MS
    return exact.coerceIn(MIN_RETRY_DELAY_MS, MAX_RETRY_DELAY_MS)
  }

  fun statusJson(): String {
    val snapshot = governor.snapshot(SystemClock.elapsedRealtime())
    return JSONObject().apply {
      put("busy", snapshot.activeOwner != null)
      put("activeOwner", snapshot.activeOwner ?: JSONObject.NULL)
      put("activeAgeMs", snapshot.activeAgeMs)
      put("grants", snapshot.grants)
      put("rejections", snapshot.rejections)
      put("staleRecoveries", snapshot.staleRecoveries)
      put("leaseTimeoutMs", LEASE_TIMEOUT_MS)
      put("minStartIntervalMs", MIN_START_INTERVAL_MS)
    }.toString()
  }
}


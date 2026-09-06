package expo.modules.motoristanotificationlistener

import kotlin.math.min

internal data class CaptureLease(
  val token: Long,
  val owner: String,
  val acquiredAtMs: Long
)

internal data class CaptureLeaseSnapshot(
  val activeOwner: String?,
  val activeAgeMs: Long,
  val grants: Long,
  val rejections: Long,
  val staleRecoveries: Long
)

/**
 * Process-wide admission control for screenshot + OCR work.
 *
 * Android applies a display-wide screenshot rate limit, while MotoristaPro has
 * separate accessibility services for offer capture and lifecycle detection.
 * A tokenized lease prevents those services from racing. The lease expires so
 * a missing framework/ML Kit callback cannot permanently stop capture.
 */
internal class CaptureLeaseGovernor(
  private val minStartIntervalMs: Long,
  private val leaseTimeoutMs: Long
) {
  init {
    require(minStartIntervalMs >= 0L)
    require(leaseTimeoutMs > 0L)
  }

  private var sequence = 0L
  private var active: CaptureLease? = null
  private var lastStartedAtMs: Long? = null
  private var grants = 0L
  private var rejections = 0L
  private var staleRecoveries = 0L

  @Synchronized
  fun tryAcquire(owner: String, nowMs: Long): CaptureLease? {
    expireStaleLease(nowMs)

    if (active != null) {
      rejections += 1L
      return null
    }

    val lastStarted = lastStartedAtMs
    if (lastStarted != null && safeElapsed(nowMs, lastStarted) < minStartIntervalMs) {
      rejections += 1L
      return null
    }

    sequence += 1L
    val lease = CaptureLease(sequence, owner, nowMs)
    active = lease
    lastStartedAtMs = nowMs
    grants += 1L
    return lease
  }

  @Synchronized
  fun release(lease: CaptureLease): Boolean {
    if (active?.token != lease.token) return false
    active = null
    return true
  }

  @Synchronized
  fun isActive(lease: CaptureLease, nowMs: Long): Boolean {
    expireStaleLease(nowMs)
    return active?.token == lease.token
  }

  @Synchronized
  fun retryAfterMs(nowMs: Long): Long {
    expireStaleLease(nowMs)
    val current = active
    if (current != null) {
      return (leaseTimeoutMs - safeElapsed(nowMs, current.acquiredAtMs)).coerceAtLeast(0L)
    }

    val lastStarted = lastStartedAtMs ?: return 0L
    return (minStartIntervalMs - safeElapsed(nowMs, lastStarted)).coerceAtLeast(0L)
  }

  @Synchronized
  fun snapshot(nowMs: Long): CaptureLeaseSnapshot {
    expireStaleLease(nowMs)
    val current = active
    return CaptureLeaseSnapshot(
      activeOwner = current?.owner,
      activeAgeMs = current?.let { safeElapsed(nowMs, it.acquiredAtMs) } ?: 0L,
      grants = grants,
      rejections = rejections,
      staleRecoveries = staleRecoveries
    )
  }

  private fun expireStaleLease(nowMs: Long) {
    val current = active ?: return
    if (safeElapsed(nowMs, current.acquiredAtMs) < leaseTimeoutMs) return
    active = null
    staleRecoveries += 1L
  }

  private fun safeElapsed(nowMs: Long, thenMs: Long): Long {
    return if (nowMs >= thenMs) nowMs - thenMs else Long.MAX_VALUE
  }
}

/** Bounded backoff used while a ride app is foregrounded without an offer. */
internal class AdaptivePollingPolicy(intervalsMs: LongArray) {
  private val intervals = intervalsMs.copyOf()
  private var missLevel = 0

  init {
    require(intervals.isNotEmpty())
    require(intervals.all { it > 0L })
    for (index in 1 until intervals.size) {
      require(intervals[index] >= intervals[index - 1])
    }
  }

  fun onMiss(): Long {
    val delay = intervals[min(missLevel, intervals.lastIndex)]
    if (missLevel < intervals.lastIndex) missLevel += 1
    return delay
  }

  fun currentDelayMs(): Long = intervals[min(missLevel, intervals.lastIndex)]

  fun onStrongSignal() {
    missLevel = 0
  }

  fun onOfferDetected() {
    missLevel = 0
  }
}

/** Keeps repeated diagnostics useful without rewriting SharedPreferences per frame. */
internal class DiagnosticRateLimiter(private val repeatIntervalMs: Long) {
  init {
    require(repeatIntervalMs >= 0L)
  }

  private val lastEmittedByKey = LinkedHashMap<String, Long>()

  fun shouldEmit(key: String, nowMs: Long): Boolean {
    val previousAt = lastEmittedByKey[key]
    val elapsed = if (previousAt != null && nowMs >= previousAt) nowMs - previousAt else Long.MAX_VALUE
    if (elapsed < repeatIntervalMs) return false

    lastEmittedByKey[key] = nowMs
    if (lastEmittedByKey.size > 32) {
      val oldest = lastEmittedByKey.minByOrNull { it.value }?.key
      if (oldest != null && oldest != key) lastEmittedByKey.remove(oldest)
    }
    return true
  }
}

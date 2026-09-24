package expo.modules.motoristanotificationlistener

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptureStabilityPolicyTest {
  @Test
  fun `only one service owns screenshot work and stale releases are harmless`() {
    val governor = CaptureLeaseGovernor(minStartIntervalMs = 700L, leaseTimeoutMs = 12_000L)

    val uber = governor.tryAcquire("offer:uber", 0L)
    assertNotNull(uber)
    assertNull(governor.tryAcquire("lifecycle:uber", 100L))
    assertTrue(governor.release(uber!!))
    assertNull(governor.tryAcquire("offer:99", 699L))

    val ride99 = governor.tryAcquire("offer:99", 700L)
    assertNotNull(ride99)
    assertFalse(governor.release(uber))
    assertTrue(governor.isActive(ride99!!, 701L))
  }

  @Test
  fun `watchdog recovers a callback that never returns`() {
    val governor = CaptureLeaseGovernor(minStartIntervalMs = 700L, leaseTimeoutMs = 12_000L)
    val orphan = governor.tryAcquire("offer:uber", 10_000L)
    assertNotNull(orphan)

    assertNull(governor.tryAcquire("offer:99", 21_999L))
    val recovered = governor.tryAcquire("offer:99", 22_000L)

    assertNotNull(recovered)
    assertFalse(governor.release(orphan!!))
    val snapshot = governor.snapshot(22_001L)
    assertEquals("offer:99", snapshot.activeOwner)
    assertEquals(1L, snapshot.staleRecoveries)
  }

  @Test
  fun `event storm stays bounded for six simulated hours`() {
    val governor = CaptureLeaseGovernor(minStartIntervalMs = 700L, leaseTimeoutMs = 12_000L)
    val sixHoursMs = 6L * 60L * 60L * 1_000L
    var grants = 0L
    var now = 0L

    while (now <= sixHoursMs) {
      val owner = if ((now / 25L) % 3L == 0L) "offer:uber" else "offer:99"
      val lease = governor.tryAcquire(owner, now)
      if (lease != null) {
        grants += 1L
        governor.release(lease)
      }
      now += 25L
    }

    val theoreticalMaximum = sixHoursMs / 700L + 1L
    assertTrue(grants > 20_000L)
    assertTrue(grants <= theoreticalMaximum)
    assertNull(governor.snapshot(sixHoursMs + 1L).activeOwner)
  }

  @Test
  fun `adaptive polling backs off but remains inside one offer window`() {
    val policy = AdaptivePollingPolicy(longArrayOf(1_200L, 2_500L, 4_500L, 8_000L))

    assertEquals(1_200L, policy.onMiss())
    assertEquals(2_500L, policy.onMiss())
    assertEquals(4_500L, policy.onMiss())
    assertEquals(8_000L, policy.onMiss())
    assertEquals(8_000L, policy.onMiss())

    policy.onStrongSignal()
    assertEquals(1_200L, policy.currentDelayMs())
    policy.onMiss()
    policy.onOfferDetected()
    assertEquals(1_200L, policy.currentDelayMs())
  }

  @Test
  fun `repeated diagnostics are capped independently by reason`() {
    val limiter = DiagnosticRateLimiter(repeatIntervalMs = 30_000L)
    var emitted = 0

    for (second in 0 until 3_600) {
      val now = second * 1_000L
      if (limiter.shouldEmit("no-offer", now)) emitted += 1
      if (limiter.shouldEmit("screenshot-busy", now)) emitted += 1
    }

    assertEquals(240, emitted)
  }

  @Test
  fun `monotonic clock reset cannot leave an old lease locked`() {
    val governor = CaptureLeaseGovernor(minStartIntervalMs = 700L, leaseTimeoutMs = 12_000L)
    val beforeReset = governor.tryAcquire("lifecycle:uber", 50_000L)
    assertNotNull(beforeReset)

    val afterReset = governor.tryAcquire("offer:uber", 10L)
    assertNotNull(afterReset)
    assertEquals(1L, governor.snapshot(11L).staleRecoveries)
  }
}


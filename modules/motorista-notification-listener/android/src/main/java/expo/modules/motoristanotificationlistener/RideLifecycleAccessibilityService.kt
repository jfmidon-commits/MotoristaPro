package expo.modules.motoristanotificationlistener

import android.accessibilityservice.AccessibilityService
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.util.Locale
import org.json.JSONObject

/**
 * Conservative ride lifecycle tracker for Uber/99.
 *
 * Payment-method UI and automatic income booking are intentionally disabled
 * while offer capture is being stabilized. This service only maintains the
 * short-lived lifecycle gate used to avoid competing with offer capture during
 * pickup/in-trip transitions.
 */
class RideLifecycleAccessibilityService : AccessibilityService() {
  companion object {
    private const val UBER_PACKAGE = "com.ubercab.driver"
    private const val APP99_PACKAGE = "com.app99.driver"
    private const val OFFER_TO_RIDE_TIMEOUT_MS = 150_000L
    private const val ACTIVE_RIDE_STALE_MS = 6 * 60 * 60 * 1000L
    private const val POLL_INTERVAL_MS = 4_000L

    private val OFFER_MARKERS = listOf(
      "aceitar", "selecionar", "exclusivo", "priority", "prioritário", "prioritario", "negocia"
    )
    private val PICKUP_MARKERS = listOf(
      "corrida aceita", "viagem aceita", "solicitação aceita", "solicitacao aceita",
      "aceita com sucesso", "ir para embarque", "buscar passageiro", "buscar o passageiro",
      "navegar até o passageiro", "navegar ate o passageiro", "a caminho do passageiro",
      "encontro com", "cheguei", "confirmar chegada", "deslize para iniciar",
      "iniciar viagem", "iniciar corrida", "iniciar uberx", "iniciar comfort"
    )
    private val TRIP_STARTED_MARKERS = listOf(
      "passageiro a bordo", "em viagem", "em corrida", "deslize para finalizar",
      "finalizar viagem", "finalizar corrida", "encerrar viagem", "encerrar corrida"
    )
    private val ENDED_MARKERS = listOf(
      "corrida concluída", "corrida concluida", "viagem concluída", "viagem concluida",
      "avaliar passageiro", "avalie o passageiro", "como foi a viagem",
      "como foi sua viagem", "você ganhou", "voce ganhou", "ganho desta viagem",
      "corrida finalizada", "viagem finalizada", "resumo da viagem", "resumo da corrida"
    )
  }

  private data class PlatformState(
    var lastOfferAt: Long = 0L,
    var pickupAt: Long = 0L,
    var tripStartedAt: Long = 0L,
    var state: String = "idle"
  )

  private val states = mutableMapOf(
    UBER_PACKAGE to PlatformState(),
    APP99_PACKAGE to PlatformState()
  )
  private val handler = Handler(Looper.getMainLooper())
  private var pollScheduled = false
  private var serviceDestroyed = false

  override fun onServiceConnected() {
    super.onServiceConnected()
    serviceDestroyed = false
    restoreState(UBER_PACKAGE)
    restoreState(APP99_PACKAGE)
    schedulePollIfNeeded()
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (serviceDestroyed || event == null) return
    if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
      event.eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED &&
      event.eventType != AccessibilityEvent.TYPE_WINDOWS_CHANGED &&
      event.eventType != AccessibilityEvent.TYPE_VIEW_SCROLLED) return

    val pkg = event.packageName?.toString()?.lowercase(Locale.ROOT) ?: return
    if (pkg != UBER_PACKAGE && pkg != APP99_PACKAGE) return

    val state = states[pkg] ?: return
    val now = System.currentTimeMillis()
    val text = collectActiveWindowTextFor(pkg)
    if (text.isNotBlank()) evaluateText(pkg, state, text, now)
    if (isActiveState(state.state)) schedulePollIfNeeded()
  }

  override fun onInterrupt() {}

  override fun onDestroy() {
    serviceDestroyed = true
    handler.removeCallbacksAndMessages(null)
    super.onDestroy()
  }

  private fun isActiveState(state: String): Boolean =
    state == "offer" || state == "pickup" || state == "in_trip"

  private fun evaluateText(pkg: String, state: PlatformState, rawText: String, now: Long) {
    val text = rawText.lowercase(Locale.ROOT)
    if (text.isBlank()) return

    if (state.state == "idle" && containsAny(text, OFFER_MARKERS)) {
      state.lastOfferAt = now
      state.state = "offer"
      saveState(pkg, state)
      schedulePollIfNeeded()
      return
    }

    if (state.state == "offer" &&
      state.lastOfferAt > 0L &&
      now - state.lastOfferAt <= OFFER_TO_RIDE_TIMEOUT_MS &&
      containsAny(text, PICKUP_MARKERS)
    ) {
      state.pickupAt = now
      state.state = "pickup"
      saveState(pkg, state)
      schedulePollIfNeeded()
      return
    }

    if ((state.state == "offer" || state.state == "pickup") && containsAny(text, TRIP_STARTED_MARKERS)) {
      state.tripStartedAt = now
      state.state = "in_trip"
      saveState(pkg, state)
      schedulePollIfNeeded()
      return
    }

    if (state.state == "offer" && now - state.lastOfferAt > OFFER_TO_RIDE_TIMEOUT_MS) {
      reset(pkg, state)
      return
    }

    val activeSince = when (state.state) {
      "pickup" -> state.pickupAt
      "in_trip" -> state.tripStartedAt
      else -> 0L
    }
    if (activeSince > 0L && now - activeSince > ACTIVE_RIDE_STALE_MS) {
      reset(pkg, state)
      return
    }

    // End-of-ride is only a reset. There is deliberately no payment card,
    // payment-method choice, transaction creation or financial import here.
    if (state.state == "in_trip" && containsAny(text, ENDED_MARKERS)) {
      reset(pkg, state)
    }
  }

  private fun collectActiveWindowTextFor(pkg: String): String {
    val root = try { rootInActiveWindow } catch (_: Exception) { null } ?: return ""
    return try {
      val rootPkg = try { root.packageName?.toString()?.lowercase(Locale.ROOT) } catch (_: Exception) { null }
      if (rootPkg != pkg) "" else collectText(root)
    } finally {
      try { root.recycle() } catch (_: Exception) {}
    }
  }

  private fun collectText(root: AccessibilityNodeInfo): String {
    val out = StringBuilder()
    val queue = ArrayDeque<AccessibilityNodeInfo>()
    queue.add(root)
    var visited = 0
    while (queue.isNotEmpty() && visited < 220) {
      val node = queue.removeFirst()
      visited += 1
      try {
        node.text?.toString()?.trim()?.takeIf { it.isNotBlank() }?.let { out.append(' ').append(it) }
        node.contentDescription?.toString()?.trim()?.takeIf { it.isNotBlank() }?.let { out.append(' ').append(it) }
        for (i in 0 until node.childCount) {
          val child = try { node.getChild(i) } catch (_: Exception) { null }
          if (child != null) queue.add(child)
        }
      } finally {
        if (node !== root) try { node.recycle() } catch (_: Exception) {}
      }
    }
    return out.toString()
  }

  private fun schedulePollIfNeeded() {
    if (pollScheduled || serviceDestroyed) return
    if (states.values.none { isActiveState(it.state) }) return
    pollScheduled = true
    handler.postDelayed({
      pollScheduled = false
      if (serviceDestroyed) return@postDelayed
      val now = System.currentTimeMillis()
      for ((pkg, state) in states) {
        if (!isActiveState(state.state)) continue
        if (state.state == "offer" && now - state.lastOfferAt > OFFER_TO_RIDE_TIMEOUT_MS) {
          reset(pkg, state)
          continue
        }
        val activeSince = if (state.state == "in_trip") state.tripStartedAt else state.pickupAt
        if (activeSince > 0L && now - activeSince > ACTIVE_RIDE_STALE_MS) {
          reset(pkg, state)
          continue
        }
        val text = collectActiveWindowTextFor(pkg)
        if (text.isNotBlank()) evaluateText(pkg, state, text, now)
      }
      schedulePollIfNeeded()
    }, POLL_INTERVAL_MS)
  }

  private fun containsAny(text: String, markers: List<String>): Boolean = markers.any { text.contains(it) }
  private fun platformKey(pkg: String): String = if (pkg == APP99_PACKAGE) "99" else "uber"

  private fun saveState(pkg: String, state: PlatformState) {
    RideLifecycleStore.writePlatformState(applicationContext, platformKey(pkg), JSONObject().apply {
      put("state", state.state)
      put("lastOfferAt", state.lastOfferAt)
      put("pickupAt", state.pickupAt)
      put("tripStartedAt", state.tripStartedAt)
      put("savedAt", System.currentTimeMillis())
    })
  }

  private fun restoreState(pkg: String) {
    val saved = RideLifecycleStore.readPlatformState(applicationContext, platformKey(pkg)) ?: return
    val state = states[pkg] ?: return
    val now = System.currentTimeMillis()
    val savedState = saved.optString("state", "idle")
    val lastOfferAt = saved.optLong("lastOfferAt", 0L)
    val pickupAt = saved.optLong("pickupAt", 0L)
    val tripStartedAt = saved.optLong("tripStartedAt", saved.optLong("inProgressAt", 0L))
    val valid = when (savedState) {
      "offer" -> lastOfferAt > 0L && now - lastOfferAt <= OFFER_TO_RIDE_TIMEOUT_MS
      "pickup" -> pickupAt > 0L && now - pickupAt <= ACTIVE_RIDE_STALE_MS
      "in_trip", "in_progress" -> tripStartedAt > 0L && now - tripStartedAt <= ACTIVE_RIDE_STALE_MS
      else -> false
    }
    if (!valid) {
      RideLifecycleStore.clearPlatformState(applicationContext, platformKey(pkg))
      return
    }
    state.lastOfferAt = lastOfferAt
    state.pickupAt = pickupAt
    state.tripStartedAt = tripStartedAt
    state.state = if (savedState == "in_progress") "in_trip" else savedState
  }

  private fun reset(pkg: String, state: PlatformState) {
    state.lastOfferAt = 0L
    state.pickupAt = 0L
    state.tripStartedAt = 0L
    state.state = "idle"
    RideLifecycleStore.clearPlatformState(applicationContext, platformKey(pkg))
  }
}

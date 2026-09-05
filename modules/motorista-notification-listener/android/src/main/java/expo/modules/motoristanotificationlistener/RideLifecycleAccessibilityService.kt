package expo.modules.motoristanotificationlistener

import android.accessibilityservice.AccessibilityService
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * Conservative ride lifecycle detector for Uber/99.
 *
 * It deliberately requires a strong sequence before prompting for payment:
 * 1) an offer-like screen was seen, either directly or by the working OCR offer capture;
 * 2) an accepted/in-ride marker was seen soon afterwards;
 * 3) an end-of-ride marker was seen after the accepted/in-ride state.
 *
 * This avoids interpreting a rejected/expired offer as a completed ride.
 * No passenger name/address is persisted.
 */
class RideLifecycleAccessibilityService : AccessibilityService() {
  companion object {
    private const val UBER_PACKAGE = "com.ubercab.driver"
    private const val APP99_PACKAGE = "com.app99.driver"
    private const val OFFER_TO_RIDE_TIMEOUT_MS = 120_000L
    private const val IN_PROGRESS_STALE_MS = 6 * 60 * 60 * 1000L
    private const val PROMPT_COOLDOWN_MS = 15_000L
    private const val RECENT_CAPTURED_OFFER_MS = 90_000L

    private val OFFER_MARKERS = listOf(
      "aceitar", "selecionar", "exclusivo", "priority", "prioritário", "negocia"
    )
    private val ACCEPTED_MARKERS = listOf(
      "corrida aceita", "viagem aceita", "solicitação aceita", "solicitacao aceita",
      "aceita com sucesso", "ir para embarque", "buscar passageiro", "navegar até o passageiro",
      "navegar ate o passageiro"
    )
    private val IN_PROGRESS_MARKERS = listOf(
      "a caminho", "cheguei", "iniciar viagem", "iniciar corrida", "finalizar viagem",
      "encerrar viagem", "destino", "passageiro a bordo", "em viagem", "em corrida",
      "deslize para iniciar", "deslize para finalizar"
    )
    private val ENDED_MARKERS = listOf(
      "corrida concluída", "corrida concluida", "viagem concluída", "viagem concluida",
      "final da viagem", "fim da viagem", "avaliar passageiro", "como foi a viagem",
      "você ganhou", "voce ganhou", "ganho desta viagem", "recebimento", "valor da viagem",
      "corrida finalizada", "viagem finalizada"
    )
  }

  private data class PlatformState(
    var lastOfferAt: Long = 0L,
    var inProgressAt: Long = 0L,
    var lastPromptAt: Long = 0L,
    var state: String = "idle"
  )

  private val states = mutableMapOf(
    UBER_PACKAGE to PlatformState(),
    APP99_PACKAGE to PlatformState()
  )
  private val handler = Handler(Looper.getMainLooper())
  private var paymentOverlay: View? = null

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event == null) return
    if (!isRelevant(event.eventType)) return
    val pkg = event.packageName?.toString()?.lowercase(Locale.ROOT) ?: return
    if (pkg != UBER_PACKAGE && pkg != APP99_PACKAGE) return

    val root = try { rootInActiveWindow } catch (_: Exception) { null } ?: return
    val text = try { collectText(root) } finally { try { root.recycle() } catch (_: Exception) {} }
    if (text.isBlank()) return

    val now = System.currentTimeMillis()
    val state = states[pkg] ?: return

    if (containsAny(text, OFFER_MARKERS)) {
      state.lastOfferAt = now
      state.state = "offer"
      persist(pkg, "offer", now)
      return
    }

    if (state.lastOfferAt == 0L) {
      val capturedAt = latestRecentCapturedOfferAt(pkg, now)
      if (capturedAt > 0L) {
        state.lastOfferAt = capturedAt
        state.state = "offer"
        persist(pkg, "offer_recovered_from_ocr", capturedAt)
      }
    }

    if (
      state.lastOfferAt > 0L &&
      now - state.lastOfferAt <= OFFER_TO_RIDE_TIMEOUT_MS &&
      (containsAny(text, ACCEPTED_MARKERS) || containsAny(text, IN_PROGRESS_MARKERS))
    ) {
      if (state.state != "in_progress") {
        state.inProgressAt = now
        state.state = "in_progress"
        persist(pkg, if (containsAny(text, ACCEPTED_MARKERS)) "accepted" else "in_progress", now)
      }
      return
    }

    if (state.state == "in_progress" && now - state.inProgressAt > IN_PROGRESS_STALE_MS) {
      reset(state)
      persist(pkg, "stale_reset", now)
      return
    }

    if (
      state.state == "in_progress" &&
      containsAny(text, ENDED_MARKERS) &&
      now - state.lastPromptAt >= PROMPT_COOLDOWN_MS
    ) {
      state.state = "ended"
      state.lastPromptAt = now
      persist(pkg, "ended", now)
      showPaymentPrompt(pkg, now)
    }
  }

  override fun onInterrupt() {}

  override fun onDestroy() {
    hidePaymentPrompt()
    super.onDestroy()
  }

  private fun isRelevant(type: Int): Boolean {
    return type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
      type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED ||
      type == AccessibilityEvent.TYPE_WINDOWS_CHANGED ||
      type == AccessibilityEvent.TYPE_VIEW_SCROLLED
  }

  private fun collectText(root: AccessibilityNodeInfo): String {
    val out = StringBuilder()
    val queue = ArrayDeque<AccessibilityNodeInfo>()
    queue.add(root)
    var visited = 0

    while (queue.isNotEmpty() && visited < 160) {
      val node = queue.removeFirst()
      visited += 1
      try {
        val text = node.text?.toString()?.trim()
        val desc = node.contentDescription?.toString()?.trim()
        if (!text.isNullOrBlank()) out.append(' ').append(text.lowercase(Locale.ROOT))
        if (!desc.isNullOrBlank()) out.append(' ').append(desc.lowercase(Locale.ROOT))
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

  private fun latestRecentCapturedOfferAt(pkg: String, now: Long): Long {
    return try {
      val items = JSONArray(RideAccessibilityStore.read(applicationContext))
      var best = 0L
      for (i in items.length() - 1 downTo 0) {
        val snapshot = items.optJSONObject(i) ?: continue
        if (!snapshot.optString("packageName", "").equals(pkg, ignoreCase = true)) continue
        val fingerprint = snapshot.optString("fingerprint", "")
        val isValidOfferCapture = when (pkg) {
          UBER_PACKAGE -> fingerprint.startsWith("screenshotOcrCard:")
          APP99_PACKAGE -> fingerprint.startsWith("screenshotOcr99:")
          else -> false
        }
        if (!isValidOfferCapture) continue
        val capturedAt = snapshot.optLong("capturedAt", 0L)
        if (capturedAt <= 0L || capturedAt > now) continue
        if (now - capturedAt > RECENT_CAPTURED_OFFER_MS) break
        best = maxOf(best, capturedAt)
        if (best > 0L) break
      }
      best
    } catch (_: Exception) {
      0L
    }
  }

  private fun containsAny(text: String, markers: List<String>): Boolean {
    return markers.any { text.contains(it) }
  }

  private fun platformLabel(pkg: String): String = if (pkg == APP99_PACKAGE) "99" else "Uber"

  private fun persist(pkg: String, state: String, at: Long, paymentMethod: String? = null) {
    try {
      RideLifecycleStore.append(applicationContext, JSONObject().apply {
        put("platform", if (pkg == APP99_PACKAGE) "99" else "uber")
        put("state", state)
        put("detectedAt", at)
        if (paymentMethod != null) put("paymentMethod", paymentMethod)
      })
    } catch (_: Exception) {}
  }

  private fun showPaymentPrompt(pkg: String, detectedAt: Long) {
    handler.post {
      hidePaymentPrompt()
      val wm = getSystemService(WINDOW_SERVICE) as WindowManager
      val root = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(14), dp(12), dp(14), dp(12))
        background = GradientDrawable().apply {
          shape = GradientDrawable.RECTANGLE
          cornerRadius = dp(16).toFloat()
          setColor(Color.rgb(15, 23, 42))
          setStroke(dp(2), Color.rgb(56, 189, 248))
        }
        elevation = dp(12).toFloat()
      }

      root.addView(TextView(this).apply {
        text = "MotoristaPro • ${platformLabel(pkg)}"
        setTextColor(Color.WHITE)
        textSize = 17f
        setTypeface(typeface, android.graphics.Typeface.BOLD)
      })
      root.addView(TextView(this).apply {
        text = "Como você recebeu esta corrida?"
        setTextColor(Color.rgb(203, 213, 225))
        textSize = 14f
        setPadding(0, dp(4), 0, dp(10))
      })

      val row = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER
      }
      row.addView(paymentButton("Dinheiro") { choosePayment(pkg, detectedAt, "cash") }, weighted())
      row.addView(paymentButton("Pix") { choosePayment(pkg, detectedAt, "pix") }, weighted())
      row.addView(paymentButton("Aplicativo") { choosePayment(pkg, detectedAt, "app") }, weighted())
      root.addView(row)

      val params = WindowManager.LayoutParams(
        (resources.displayMetrics.widthPixels * 0.92f).toInt(),
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT
      ).apply {
        gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
        y = dp(84)
      }

      try {
        wm.addView(root, params)
        paymentOverlay = root
      } catch (_: Exception) {
        paymentOverlay = null
      }
    }
  }

  private fun paymentButton(label: String, onClick: () -> Unit): TextView {
    return TextView(this).apply {
      text = label
      gravity = Gravity.CENTER
      setTextColor(Color.WHITE)
      textSize = 13f
      setTypeface(typeface, android.graphics.Typeface.BOLD)
      setPadding(dp(6), dp(11), dp(6), dp(11))
      background = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = dp(10).toFloat()
        setColor(Color.rgb(30, 41, 59))
      }
      isClickable = true
      isFocusable = true
      setOnClickListener { onClick() }
    }
  }

  private fun weighted(): LinearLayout.LayoutParams {
    return LinearLayout.LayoutParams(0, WindowManager.LayoutParams.WRAP_CONTENT, 1f).apply {
      marginStart = dp(3)
      marginEnd = dp(3)
    }
  }

  private fun choosePayment(pkg: String, detectedAt: Long, method: String) {
    persist(pkg, "payment_confirmed", detectedAt, method)
    states[pkg]?.let(::reset)
    hidePaymentPrompt()
  }

  private fun hidePaymentPrompt() {
    val current = paymentOverlay ?: return
    paymentOverlay = null
    try {
      val wm = getSystemService(WINDOW_SERVICE) as WindowManager
      wm.removeView(current)
    } catch (_: Exception) {}
  }

  private fun reset(state: PlatformState) {
    state.lastOfferAt = 0L
    state.inProgressAt = 0L
    state.state = "idle"
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}

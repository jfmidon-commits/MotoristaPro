package expo.modules.motoristanotificationlistener

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Display
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.LinearLayout
import android.widget.TextView
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Conservative ride lifecycle detector for Uber/99.
 *
 * Lifecycle is deliberately split into four phases:
 * offer -> pickup -> in_trip -> ended.
 * A payment prompt is only allowed after a strong in-trip marker has been seen
 * and then a strong completion marker (or a confirmed return to the home
 * screen). This prevents the payment prompt from appearing while the driver is
 * still heading to the passenger or while the trip is still active.
 */
class RideLifecycleAccessibilityService : AccessibilityService() {
  companion object {
    private const val UBER_PACKAGE = "com.ubercab.driver"
    private const val APP99_PACKAGE = "com.app99.driver"
    private const val OFFER_TO_RIDE_TIMEOUT_MS = 150_000L
    private const val ACTIVE_RIDE_STALE_MS = 6 * 60 * 60 * 1000L
    private const val PROMPT_COOLDOWN_MS = 15_000L
    private const val RECENT_CAPTURED_OFFER_MS = 120_000L
    private const val POLL_INTERVAL_MS = 4_000L
    private const val MIN_HOME_END_MS = 60_000L

    private val OFFER_MARKERS = listOf(
      "aceitar", "selecionar", "exclusivo", "priority", "prioritário", "negocia"
    )

    // Accepted / heading to pickup. These markers must NOT mean that the paid
    // trip has started yet.
    private val PICKUP_MARKERS = listOf(
      "corrida aceita", "viagem aceita", "solicitação aceita", "solicitacao aceita",
      "aceita com sucesso", "ir para embarque", "buscar passageiro", "buscar o passageiro",
      "navegar até o passageiro", "navegar ate o passageiro", "a caminho do passageiro",
      "encontro com", "cheguei", "confirmar chegada", "deslize para iniciar",
      "iniciar viagem", "iniciar corrida", "iniciar uberx", "iniciar comfort"
    )

    // Strong evidence that the passenger is aboard and the actual trip is in
    // progress. Generic words such as "destino" or "a caminho" are avoided.
    private val TRIP_STARTED_MARKERS = listOf(
      "passageiro a bordo", "em viagem", "em corrida", "destino de",
      "deslize para finalizar", "finalizar viagem", "finalizar corrida",
      "encerrar viagem", "encerrar corrida"
    )

    // Only strong post-trip screens belong here. Generic fare/payment words
    // were intentionally removed because they can exist before completion.
    private val ENDED_MARKERS = listOf(
      "corrida concluída", "corrida concluida", "viagem concluída", "viagem concluida",
      "avaliar passageiro", "avalie o passageiro", "como foi a viagem",
      "como foi sua viagem", "você ganhou", "voce ganhou", "ganho desta viagem",
      "corrida finalizada", "viagem finalizada", "resumo da viagem", "resumo da corrida"
    )

    private val HOME_MARKERS = listOf(
      "você está online", "voce esta online", "ficar offline", "buscar viagens",
      "procurando viagens", "procurando corridas", "ganhos de hoje", "meta de ganhos"
    )
  }

  private data class PlatformState(
    var lastOfferAt: Long = 0L,
    var pickupAt: Long = 0L,
    var tripStartedAt: Long = 0L,
    var lastPromptAt: Long = 0L,
    var state: String = "idle"
  )

  private val states = mutableMapOf(
    UBER_PACKAGE to PlatformState(),
    APP99_PACKAGE to PlatformState()
  )
  private val handler = Handler(Looper.getMainLooper())
  private val screenshotInFlight = AtomicBoolean(false)
  private var paymentOverlay: View? = null
  private var pollScheduled = false

  private val recognizer by lazy {
    TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
  }

  override fun onServiceConnected() {
    super.onServiceConnected()
    restoreState(UBER_PACKAGE)
    restoreState(APP99_PACKAGE)
    schedulePollIfNeeded()
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event == null || !isRelevant(event.eventType)) return
    val pkg = event.packageName?.toString()?.lowercase(Locale.ROOT) ?: return
    if (pkg != UBER_PACKAGE && pkg != APP99_PACKAGE) return

    val now = System.currentTimeMillis()
    val state = states[pkg] ?: return
    if (state.lastOfferAt == 0L) recoverRecentOffer(pkg, state, now)

    val text = collectActiveWindowTextFor(pkg)
    if (text.isNotBlank()) evaluateText(pkg, state, text, now, "tree")
    if (isActiveState(state.state)) schedulePollIfNeeded()
  }

  override fun onInterrupt() {}

  override fun onDestroy() {
    hidePaymentPrompt()
    handler.removeCallbacksAndMessages(null)
    try { recognizer.close() } catch (_: Exception) {}
    super.onDestroy()
  }

  private fun isRelevant(type: Int): Boolean {
    return type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
      type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED ||
      type == AccessibilityEvent.TYPE_WINDOWS_CHANGED ||
      type == AccessibilityEvent.TYPE_VIEW_SCROLLED
  }

  private fun isActiveState(state: String): Boolean {
    return state == "offer" || state == "pickup" || state == "in_trip"
  }

  private fun evaluateText(pkg: String, state: PlatformState, rawText: String, now: Long, source: String) {
    val text = normalize(rawText)
    if (text.isBlank()) return

    if (state.state == "idle" && containsAny(text, OFFER_MARKERS)) {
      state.lastOfferAt = now
      state.state = "offer"
      saveState(pkg, state)
      persist(pkg, "offer", now, source = source)
      schedulePollIfNeeded()
      return
    }

    if (state.lastOfferAt == 0L) recoverRecentOffer(pkg, state, now)

    if (
      state.state == "offer" &&
      state.lastOfferAt > 0L &&
      now - state.lastOfferAt <= OFFER_TO_RIDE_TIMEOUT_MS &&
      containsAny(text, PICKUP_MARKERS)
    ) {
      state.pickupAt = now
      state.state = "pickup"
      saveState(pkg, state)
      persist(pkg, "pickup", now, source = source)
      schedulePollIfNeeded()
      return
    }

    if ((state.state == "offer" || state.state == "pickup") && containsAny(text, TRIP_STARTED_MARKERS)) {
      state.tripStartedAt = now
      state.state = "in_trip"
      saveState(pkg, state)
      persist(pkg, "in_trip", now, source = source)
      schedulePollIfNeeded()
      return
    }

    if (state.state == "offer" && now - state.lastOfferAt > OFFER_TO_RIDE_TIMEOUT_MS) {
      reset(pkg, state)
      persist(pkg, "offer_timeout", now, source = source)
      return
    }

    val activeSince = when (state.state) {
      "pickup" -> state.pickupAt
      "in_trip" -> state.tripStartedAt
      else -> 0L
    }
    if (activeSince > 0L && now - activeSince > ACTIVE_RIDE_STALE_MS) {
      reset(pkg, state)
      persist(pkg, "stale_reset", now, source = source)
      return
    }

    if (state.state == "in_trip") {
      val explicitEnd = containsAny(text, ENDED_MARKERS)
      val returnedHome = state.tripStartedAt > 0L &&
        now - state.tripStartedAt >= MIN_HOME_END_MS &&
        containsAny(text, HOME_MARKERS)
      if ((explicitEnd || returnedHome) && now - state.lastPromptAt >= PROMPT_COOLDOWN_MS) {
        state.state = "ended"
        state.lastPromptAt = now
        saveState(pkg, state)
        persist(pkg, if (explicitEnd) "ended" else "ended_home_screen", now, source = source)
        showPaymentPrompt(pkg, now)
      }
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
        val text = node.text?.toString()?.trim()
        val desc = node.contentDescription?.toString()?.trim()
        if (!text.isNullOrBlank()) out.append(' ').append(text)
        if (!desc.isNullOrBlank()) out.append(' ').append(desc)
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
    if (pollScheduled) return
    if (states.values.none { isActiveState(it.state) }) return
    pollScheduled = true
    handler.postDelayed({
      pollScheduled = false
      pollActiveLifecycle()
      schedulePollIfNeeded()
    }, POLL_INTERVAL_MS)
  }

  private fun pollActiveLifecycle() {
    val now = System.currentTimeMillis()
    for ((pkg, state) in states) {
      if (!isActiveState(state.state)) continue

      if (state.state == "offer" && now - state.lastOfferAt > OFFER_TO_RIDE_TIMEOUT_MS) {
        reset(pkg, state)
        persist(pkg, "offer_timeout", now, source = "poll")
        continue
      }

      val activeSince = if (state.state == "in_trip") state.tripStartedAt else state.pickupAt
      if (activeSince > 0L && now - activeSince > ACTIVE_RIDE_STALE_MS) {
        reset(pkg, state)
        persist(pkg, "stale_reset", now, source = "poll")
        continue
      }

      val treeText = collectActiveWindowTextFor(pkg)
      if (treeText.isNotBlank()) {
        evaluateText(pkg, state, treeText, now, "poll_tree")
        if (state.state == "ended" || state.state == "idle") continue
      }

      if (isPackageVisible(pkg)) {
        requestLifecycleScreenshot(pkg)
        break
      }
    }
  }

  private fun isPackageVisible(pkg: String): Boolean {
    return try {
      windows.orEmpty().any { window ->
        val root = try { window.root } catch (_: Exception) { null }
        try {
          root?.packageName?.toString()?.equals(pkg, ignoreCase = true) == true &&
            window.type == android.view.accessibility.AccessibilityWindowInfo.TYPE_APPLICATION &&
            (window.isActive || window.isFocused)
        } finally {
          try { root?.recycle() } catch (_: Exception) {}
        }
      }
    } catch (_: Exception) {
      false
    }
  }

  private fun requestLifecycleScreenshot(pkg: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
    if (!screenshotInFlight.compareAndSet(false, true)) return

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
              softwareBitmap = hardwareBitmap?.copy(Bitmap.Config.ARGB_8888, false)
              val bitmap = softwareBitmap
              if (bitmap == null) {
                screenshotInFlight.set(false)
                return
              }
              recognizer.process(InputImage.fromBitmap(bitmap, 0))
                .addOnSuccessListener { result ->
                  try {
                    val state = states[pkg] ?: return@addOnSuccessListener
                    evaluateText(pkg, state, result.text, System.currentTimeMillis(), "ocr")
                  } finally {
                    try { bitmap.recycle() } catch (_: Exception) {}
                    screenshotInFlight.set(false)
                  }
                }
                .addOnFailureListener {
                  try { bitmap.recycle() } catch (_: Exception) {}
                  screenshotInFlight.set(false)
                }
            } catch (_: Exception) {
              try { softwareBitmap?.recycle() } catch (_: Exception) {}
              screenshotInFlight.set(false)
            } finally {
              try { hardwareBitmap?.recycle() } catch (_: Exception) {}
              try { buffer.close() } catch (_: Exception) {}
            }
          }

          override fun onFailure(errorCode: Int) {
            screenshotInFlight.set(false)
          }
        }
      )
    } catch (_: Exception) {
      screenshotInFlight.set(false)
    }
  }

  private fun recoverRecentOffer(pkg: String, state: PlatformState, now: Long) {
    val capturedAt = latestRecentCapturedOfferAt(pkg, now)
    if (capturedAt <= 0L) return
    state.lastOfferAt = capturedAt
    state.state = "offer"
    saveState(pkg, state)
    persist(pkg, "offer_recovered_from_ocr", capturedAt, source = "capture_store")
  }

  private fun latestRecentCapturedOfferAt(pkg: String, now: Long): Long {
    return try {
      val items = JSONArray(RideAccessibilityStore.read(applicationContext))
      for (i in items.length() - 1 downTo 0) {
        val snapshot = items.optJSONObject(i) ?: continue
        if (!snapshot.optString("packageName", "").equals(pkg, ignoreCase = true)) continue
        val fingerprint = snapshot.optString("fingerprint", "")
        val valid = when (pkg) {
          UBER_PACKAGE -> fingerprint.startsWith("screenshotOcrCard:")
          APP99_PACKAGE -> fingerprint.startsWith("screenshotOcr99:")
          else -> false
        }
        if (!valid) continue
        val capturedAt = snapshot.optLong("capturedAt", 0L)
        if (capturedAt <= 0L || capturedAt > now) continue
        if (now - capturedAt <= RECENT_CAPTURED_OFFER_MS) return capturedAt
      }
      0L
    } catch (_: Exception) {
      0L
    }
  }

  private fun restoreState(pkg: String) {
    val platform = platformKey(pkg)
    val saved = RideLifecycleStore.readPlatformState(applicationContext, platform) ?: return
    val state = states[pkg] ?: return
    val now = System.currentTimeMillis()
    val savedState = saved.optString("state", "idle")
    val lastOfferAt = saved.optLong("lastOfferAt", 0L)
    val pickupAt = saved.optLong("pickupAt", 0L)
    val tripStartedAt = saved.optLong("tripStartedAt", saved.optLong("inProgressAt", 0L))
    val lastPromptAt = saved.optLong("lastPromptAt", 0L)

    val valid = when (savedState) {
      "offer" -> lastOfferAt > 0L && now - lastOfferAt <= OFFER_TO_RIDE_TIMEOUT_MS
      "pickup" -> pickupAt > 0L && now - pickupAt <= ACTIVE_RIDE_STALE_MS
      "in_trip", "in_progress" -> tripStartedAt > 0L && now - tripStartedAt <= ACTIVE_RIDE_STALE_MS
      "ended" -> lastPromptAt > 0L && now - lastPromptAt <= 10 * 60 * 1000L
      else -> false
    }

    if (!valid) {
      RideLifecycleStore.clearPlatformState(applicationContext, platform)
      return
    }

    state.lastOfferAt = lastOfferAt
    state.pickupAt = pickupAt
    state.tripStartedAt = tripStartedAt
    state.lastPromptAt = lastPromptAt
    state.state = if (savedState == "in_progress") "in_trip" else savedState
    persist(pkg, "state_restored_${state.state}", now, source = "store")
  }

  private fun saveState(pkg: String, state: PlatformState) {
    RideLifecycleStore.writePlatformState(applicationContext, platformKey(pkg), JSONObject().apply {
      put("state", state.state)
      put("lastOfferAt", state.lastOfferAt)
      put("pickupAt", state.pickupAt)
      put("tripStartedAt", state.tripStartedAt)
      put("lastPromptAt", state.lastPromptAt)
      put("savedAt", System.currentTimeMillis())
    })
  }

  private fun containsAny(text: String, markers: List<String>): Boolean = markers.any { text.contains(it) }
  private fun normalize(text: String): String = text.lowercase(Locale.ROOT)
  private fun platformKey(pkg: String): String = if (pkg == APP99_PACKAGE) "99" else "uber"
  private fun platformLabel(pkg: String): String = if (pkg == APP99_PACKAGE) "99" else "Uber"

  private fun persist(pkg: String, state: String, at: Long, paymentMethod: String? = null, source: String? = null) {
    try {
      RideLifecycleStore.append(applicationContext, JSONObject().apply {
        put("platform", platformKey(pkg))
        put("state", state)
        put("detectedAt", at)
        if (paymentMethod != null) put("paymentMethod", paymentMethod)
        if (source != null) put("source", source)
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
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
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
      isFocusable = false
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
    persist(pkg, "payment_confirmed", detectedAt, method, "overlay")
    states[pkg]?.let { reset(pkg, it) }
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

  private fun reset(pkg: String, state: PlatformState) {
    state.lastOfferAt = 0L
    state.pickupAt = 0L
    state.tripStartedAt = 0L
    state.lastPromptAt = 0L
    state.state = "idle"
    RideLifecycleStore.clearPlatformState(applicationContext, platformKey(pkg))
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}

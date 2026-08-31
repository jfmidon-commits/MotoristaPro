package expo.modules.motoristanotificationlistener

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * AccessibilityService that captures sanitized operational snapshots from ride apps.
 * Coexists with RideNotificationListenerService.
 *
 * Privacy: does not persist raw PII (names, full addresses, free-form notes).
 * Performance: package/event allowlist, debounce, depth/node/char caps, background persist.
 */
class RideAccessibilityService : AccessibilityService() {

  companion object {
    private val ALLOWED_PACKAGES = setOf(
      "com.ubercab.driver",
      "com.app99.driver",
      "sinet.startup.indriver"
    )

    private val ALLOWED_EVENT_TYPES = setOf(
      AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,
      AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED,
      AccessibilityEvent.TYPE_VIEW_SCROLLED
    )

    private const val MAX_DEPTH = 18
    private const val MAX_NODES = 120
    private const val MAX_CHARS_PER_TEXT = 80
    private const val MAX_SNAPSHOT_BYTES = 12_000
    private const val DEBOUNCE_MS = 350L
    private const val FINGERPRINT_TTL_MS = 4_000L

    private val OPERATIONAL_FRAGMENT_PATTERNS = listOf(
      Regex("""R\$\s*[0-9]{1,5}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?(?:\s*/\s*km)?""", RegexOption.IGNORE_CASE),
      Regex("""[0-9]+(?:[.,][0-9]+)?\s*km\b""", RegexOption.IGNORE_CASE),
      Regex("""[0-9]+(?:[.,][0-9]+)?\s*m\b""", RegexOption.IGNORE_CASE),
      Regex("""[0-9]+(?:[.,][0-9]+)?\s*(?:min|minuto|minutos)\b""", RegexOption.IGNORE_CASE),
      Regex("""\bUberX\b|\bComfort\b|\bBlack\b|\bPop Expresso\b|\bPop\b|\bExclusivo\b""", RegexOption.IGNORE_CASE),
      Regex("""\bAceitar\b|\bRecusar\b|\bTarifa\b|\bExpresso\b|\bdinâmica\b|\bdinamica\b|\bbase\b""", RegexOption.IGNORE_CASE),
      Regex("""\bb[oô]nus\b|\bsaldo\b|\bganhos\b|\bpromo(?:ção|cao)?\b""", RegexOption.IGNORE_CASE),
      Regex("""\bpor\s+km\b|/\s*km\b""", RegexOption.IGNORE_CASE),
      Regex("""\bcategoria\b|\bcorrida\b|\boferta\b|\bnova solicita[cç][aã]o\b|\bnova corrida\b""", RegexOption.IGNORE_CASE)
    )
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private val persistExecutor: ExecutorService = Executors.newSingleThreadExecutor()
  private val lastFingerprint = AtomicReference<String?>(null)
  private val lastFingerprintAt = AtomicLong(0L)
  private val lastEventAt = AtomicLong(0L)
  private var debounceRunnable: Runnable? = null

  override fun onServiceConnected() {
    super.onServiceConnected()
    serviceInfo = serviceInfo?.apply {
      eventTypes =
        AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
          AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED or
          AccessibilityEvent.TYPE_VIEW_SCROLLED
      feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
      notificationTimeout = 250
      flags =
        AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS or
          AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
          AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
    } ?: AccessibilityServiceInfo().apply {
      eventTypes =
        AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
          AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED or
          AccessibilityEvent.TYPE_VIEW_SCROLLED
      feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
      notificationTimeout = 250
      flags =
        AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS or
          AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
          AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
    }
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event == null) return
    if (event.eventType !in ALLOWED_EVENT_TYPES) return

    val packageName = event.packageName?.toString() ?: return
    if (!isAllowedPackage(packageName)) return

    val now = System.currentTimeMillis()
    lastEventAt.set(now)

    debounceRunnable?.let { mainHandler.removeCallbacks(it) }
    val runnable = Runnable {
      if (System.currentTimeMillis() - lastEventAt.get() >= DEBOUNCE_MS - 20) {
        captureSnapshot(packageName, event.eventType)
      }
    }
    debounceRunnable = runnable
    mainHandler.postDelayed(runnable, DEBOUNCE_MS)
  }

  override fun onInterrupt() {}

  override fun onDestroy() {
    debounceRunnable?.let { mainHandler.removeCallbacks(it) }
    persistExecutor.shutdownNow()
    super.onDestroy()
  }

  private fun isAllowedPackage(packageName: String): Boolean {
    return packageName.lowercase() in ALLOWED_PACKAGES
  }

  private fun captureSnapshot(packageName: String, eventType: Int) {
    var root: AccessibilityNodeInfo? = null
    try {
      root = rootInActiveWindow ?: return
      val nodes = JSONArray()
      val seenTexts = HashSet<String>()
      val counter = intArrayOf(0)
      traverse(root, 0, nodes, seenTexts, counter)

      if (nodes.length() == 0) return

      val fingerprint = buildFingerprint(packageName, nodes)
      val now = System.currentTimeMillis()
      val prev = lastFingerprint.get()
      val prevAt = lastFingerprintAt.get()
      if (fingerprint == prev && now - prevAt < FINGERPRINT_TTL_MS) {
        return
      }
      lastFingerprint.set(fingerprint)
      lastFingerprintAt.set(now)

      val snapshot = JSONObject().apply {
        put("packageName", packageName)
        put("eventType", eventType)
        put("capturedAt", now)
        put("nodeCount", nodes.length())
        put("nodes", nodes)
        put("fingerprint", fingerprint)
      }

      val raw = snapshot.toString()
      if (raw.length > MAX_SNAPSHOT_BYTES) {
        val trimmed = JSONArray()
        var bytes = 0
        for (i in 0 until nodes.length()) {
          val n = nodes.optJSONObject(i) ?: continue
          val s = n.toString()
          if (bytes + s.length > MAX_SNAPSHOT_BYTES - 200) break
          trimmed.put(n)
          bytes += s.length
        }
        snapshot.put("nodes", trimmed)
        snapshot.put("truncated", true)
      }

      val payload = snapshot.toString()
      persistExecutor.execute {
        try {
          RideAccessibilityStore.append(applicationContext, JSONObject(payload))
        } catch (_: Exception) {
        }
      }
    } catch (_: Exception) {
    } finally {
      try {
        root?.recycle()
      } catch (_: Exception) {
      }
    }
  }

  private fun traverse(
    node: AccessibilityNodeInfo,
    depth: Int,
    out: JSONArray,
    seenTexts: MutableSet<String>,
    counter: IntArray
  ) {
    if (depth > MAX_DEPTH || counter[0] >= MAX_NODES) return
    counter[0]++

    try {
      val text = node.text?.toString()?.trim()?.take(MAX_CHARS_PER_TEXT)
      val desc = node.contentDescription?.toString()?.trim()?.take(MAX_CHARS_PER_TEXT)
      val viewId = node.viewIdResourceName?.substringAfterLast("/")?.take(48)
      val className = node.className?.toString()?.substringAfterLast('.')?.take(40)

      val bounds = Rect()
      try {
        node.getBoundsInScreen(bounds)
      } catch (_: Exception) {
        bounds.set(0, 0, 0, 0)
      }
      val relevantText = selectRelevantText(text, desc, bounds, seenTexts)

      val hasGeometry = bounds.width() > 0 || bounds.height() > 0
      val hasUseful =
        !relevantText.isNullOrBlank() ||
          !viewId.isNullOrBlank() ||
          hasGeometry

      if (hasUseful && shouldKeepNode(relevantText, viewId, className)) {
        val obj = JSONObject().apply {
          put("text", relevantText ?: JSONObject.NULL)
          put("viewId", viewId ?: JSONObject.NULL)
          put("className", className ?: JSONObject.NULL)
          put("left", bounds.left)
          put("top", bounds.top)
          put("right", bounds.right)
          put("bottom", bounds.bottom)
          put("clickable", node.isClickable)
        }
        out.put(obj)
      }

      val childCount = try {
        node.childCount
      } catch (_: Exception) {
        0
      }
      for (i in 0 until childCount) {
        if (counter[0] >= MAX_NODES) break
        var child: AccessibilityNodeInfo? = null
        try {
          child = node.getChild(i)
          if (child != null) {
            traverse(child, depth + 1, out, seenTexts, counter)
          }
        } catch (_: Exception) {
        } finally {
          try {
            child?.recycle()
          } catch (_: Exception) {
          }
        }
      }
    } catch (_: Exception) {
    }
  }

  private fun selectRelevantText(
    text: String?,
    desc: String?,
    bounds: Rect,
    seen: MutableSet<String>
  ): String? {
    val candidates = listOfNotNull(text, desc)
      .map { it.trim() }
      .filter { it.isNotEmpty() }
      .distinct()

    for (candidate in candidates) {
      val sanitized = sanitizeOperationalText(candidate) ?: continue
      val key = buildString {
        append(normalizeForDedupe(sanitized))
        append('@').append(bounds.left).append(',').append(bounds.top)
        append(',').append(bounds.right).append(',').append(bounds.bottom)
      }
      if (key in seen) continue
      seen.add(key)
      return sanitized
    }
    return null
  }

  private fun shouldKeepNode(text: String?, viewId: String?, className: String?): Boolean {
    if (!text.isNullOrBlank()) return true
    if (!viewId.isNullOrBlank()) return true
    if (className != null && (className.contains("Button", true) || className.contains("TextView", true))) {
      return true
    }
    return false
  }

  /**
   * Extracts only operational fragments needed for offer parsing. The original node text
   * is never persisted, so a node that also contains an address/name keeps only tokens
   * such as price, distance, time, category and known fare labels.
   */
  private fun sanitizeOperationalText(value: String): String? {
    val fragments = mutableListOf<Pair<Int, String>>()
    for (pattern in OPERATIONAL_FRAGMENT_PATTERNS) {
      pattern.findAll(value).forEach { match ->
        fragments.add(match.range.first to match.value.trim())
      }
    }
    if (fragments.isEmpty()) return null

    val seen = HashSet<String>()
    val ordered = fragments
      .sortedBy { it.first }
      .map { it.second }
      .filter { fragment -> seen.add(normalizeForDedupe(fragment)) }

    if (ordered.isEmpty()) return null
    return ordered.joinToString(" • ").take(MAX_CHARS_PER_TEXT)
  }

  private fun looksOperational(value: String): Boolean {
    return OPERATIONAL_FRAGMENT_PATTERNS.any { it.containsMatchIn(value) }
  }

  private fun normalizeForDedupe(value: String): String {
    return value.lowercase()
      .replace(Regex("""\s+"""), " ")
      .trim()
  }

  private fun buildFingerprint(packageName: String, nodes: JSONArray): String {
    val parts = mutableListOf<String>()
    parts.add(packageName.lowercase())
    for (i in 0 until nodes.length()) {
      val n = nodes.optJSONObject(i) ?: continue
      val t = n.optString("text", "").trim()
      if (t.isEmpty()) continue
      if (looksOperational(t)) {
        parts.add(normalizeForDedupe(t))
      }
    }
    return parts.sorted().joinToString("|").hashCode().toString()
  }
}

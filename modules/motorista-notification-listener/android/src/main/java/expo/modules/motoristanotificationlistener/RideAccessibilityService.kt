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
 * Performance: package/event allowlist, bounded leading+early+trailing sampling,
 * depth/node/char caps, background persistence and fingerprint dedupe.
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
    private const val MAX_NODES = 160
    private const val MAX_CHARS_PER_TEXT = 80
    private const val MAX_SNAPSHOT_BYTES = 14_000
    private const val EARLY_FOLLOW_UP_MS = 120L
    private const val TRAILING_CAPTURE_MS = 280L
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
  private var earlyRunnable: Runnable? = null
  private var trailingRunnable: Runnable? = null
  private var burstPackageName: String? = null
  private var burstEventType: Int = 0
  private var burstEventSignal: JSONObject? = null
  private var earlyScheduledForBurst = false

  override fun onServiceConnected() {
    super.onServiceConnected()
    serviceInfo = serviceInfo?.apply {
      eventTypes =
        AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
          AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED or
          AccessibilityEvent.TYPE_VIEW_SCROLLED
      feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
      notificationTimeout = 120
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
      notificationTimeout = 120
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

    val eventSignal = buildEventSignal(event)
    val eventType = event.eventType

    // A new window state is treated as a new burst so its first frame is never
    // hidden behind callbacks from the previous screen/card.
    if (eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && burstPackageName != null) {
      cancelBurstCallbacks()
      clearBurstState()
    }

    val isNewBurst = burstPackageName == null
    burstPackageName = packageName
    burstEventType = eventType
    burstEventSignal = eventSignal

    // Leading: exactly once per burst, immediately consuming event.source.
    // AccessibilityNodeInfo is never retained for delayed work.
    if (isNewBurst) {
      val source = try { event.source } catch (_: Exception) { null }
      captureSnapshot(packageName, eventType, eventSignal, source)
    }

    // Early follow-up: exactly once per burst for state/content changes. It re-reads
    // active roots/windows at execution time and does not retain event.source.
    if (
      eventType != AccessibilityEvent.TYPE_VIEW_SCROLLED &&
      !earlyScheduledForBurst
    ) {
      earlyScheduledForBurst = true
      val early = Runnable {
        earlyRunnable = null
        captureCurrentBurst()
      }
      earlyRunnable = early
      mainHandler.postDelayed(early, EARLY_FOLLOW_UP_MS)
    }

    // Trailing: every event restarts the settled-state sample. A continuous storm
    // therefore remains bounded to leading + one early + one final capture.
    trailingRunnable?.let { mainHandler.removeCallbacks(it) }
    val trailing = Runnable {
      trailingRunnable = null
      captureCurrentBurst()
      clearBurstIfIdle()
    }
    trailingRunnable = trailing
    mainHandler.postDelayed(trailing, TRAILING_CAPTURE_MS)
  }

  override fun onInterrupt() {}

  override fun onDestroy() {
    cancelBurstCallbacks()
    clearBurstState()
    persistExecutor.shutdownNow()
    super.onDestroy()
  }

  private fun captureCurrentBurst() {
    val packageName = burstPackageName ?: return
    val eventSignal = burstEventSignal ?: return
    captureSnapshot(packageName, burstEventType, eventSignal, null)
  }

  private fun cancelBurstCallbacks() {
    earlyRunnable?.let { mainHandler.removeCallbacks(it) }
    trailingRunnable?.let { mainHandler.removeCallbacks(it) }
    earlyRunnable = null
    trailingRunnable = null
  }

  private fun clearBurstState() {
    burstPackageName = null
    burstEventSignal = null
    burstEventType = 0
    earlyScheduledForBurst = false
  }

  private fun clearBurstIfIdle() {
    if (earlyRunnable == null && trailingRunnable == null) {
      clearBurstState()
    }
  }

  private fun isAllowedPackage(packageName: String): Boolean {
    return packageName.lowercase() in ALLOWED_PACKAGES
  }

  private fun buildEventSignal(event: AccessibilityEvent): JSONObject {
    val sanitizedTexts = JSONArray()
    try {
      event.text
        .mapNotNull { it?.toString()?.trim() }
        .filter { it.isNotEmpty() }
        .forEach { raw -> sanitizeOperationalText(raw)?.let { sanitizedTexts.put(it) } }
    } catch (_: Exception) {
    }

    val sanitizedDescription = try {
      event.contentDescription?.toString()?.trim()?.let { sanitizeOperationalText(it) }
    } catch (_: Exception) {
      null
    }

    return JSONObject().apply {
      put("windowId", event.windowId)
      put("eventType", event.eventType)
      put("className", event.className?.toString()?.substringAfterLast('.')?.take(40) ?: JSONObject.NULL)
      put("texts", sanitizedTexts)
      put("description", sanitizedDescription ?: JSONObject.NULL)
    }
  }

  private fun captureSnapshot(
    packageName: String,
    eventType: Int,
    eventSignal: JSONObject,
    eventSource: AccessibilityNodeInfo?
  ) {
    val nodes = JSONArray()
    val seenTexts = HashSet<String>()
    val seenNodes = HashSet<String>()
    val counter = intArrayOf(0)
    val capturedOrigins = LinkedHashSet<String>()

    appendEventSignal(eventSignal, nodes, seenTexts, seenNodes, counter, capturedOrigins)

    var source = eventSource
    try {
      if (source != null && belongsToPackage(source, packageName)) {
        traverse(
          source,
          0,
          nodes,
          seenTexts,
          seenNodes,
          counter,
          origin = "eventSource",
          windowId = safeWindowId(source)
        )
        capturedOrigins.add("eventSource")
      }
    } catch (_: Exception) {
    } finally {
      try {
        source?.recycle()
      } catch (_: Exception) {
      }
      source = null
    }

    var activeRoot: AccessibilityNodeInfo? = null
    try {
      activeRoot = rootInActiveWindow
      if (activeRoot != null && belongsToPackage(activeRoot, packageName)) {
        traverse(
          activeRoot,
          0,
          nodes,
          seenTexts,
          seenNodes,
          counter,
          origin = "activeRoot",
          windowId = safeWindowId(activeRoot)
        )
        capturedOrigins.add("activeRoot")
      }
    } catch (_: Exception) {
    } finally {
      try {
        activeRoot?.recycle()
      } catch (_: Exception) {
      }
    }

    try {
      for (window in windows.orEmpty()) {
        if (counter[0] >= MAX_NODES) break
        var root: AccessibilityNodeInfo? = null
        try {
          root = window.root ?: continue
          if (!belongsToPackage(root, packageName)) continue
          traverse(
            root,
            0,
            nodes,
            seenTexts,
            seenNodes,
            counter,
            origin = "window",
            windowId = window.id
          )
          capturedOrigins.add("window:${window.id}")
        } catch (_: Exception) {
        } finally {
          try {
            root?.recycle()
          } catch (_: Exception) {
          }
        }
      }
    } catch (_: Exception) {
    }

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
      put("origins", JSONArray(capturedOrigins.toList()))
    }

    val raw = snapshot.toString()
    if (raw.length > MAX_SNAPSHOT_BYTES) {
      val trimmed = JSONArray()
      var bytes = 0
      for (i in 0 until nodes.length()) {
        val n = nodes.optJSONObject(i) ?: continue
        val s = n.toString()
        if (bytes + s.length > MAX_SNAPSHOT_BYTES - 300) break
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
  }

  private fun appendEventSignal(
    eventSignal: JSONObject,
    out: JSONArray,
    seenTexts: MutableSet<String>,
    seenNodes: MutableSet<String>,
    counter: IntArray,
    origins: MutableSet<String>
  ) {
    if (counter[0] >= MAX_NODES) return

    val windowId = eventSignal.optInt("windowId", -1)
    val className = eventSignal.optString("className", "").takeIf { it.isNotBlank() && it != "null" }
    val texts = eventSignal.optJSONArray("texts") ?: JSONArray()
    val description = eventSignal.optString("description", "").takeIf { it.isNotBlank() && it != "null" }

    for (i in 0 until texts.length()) {
      val text = texts.optString(i, "").trim()
      if (text.isEmpty()) continue
      appendSyntheticNode(text, className, windowId, "eventText", out, seenTexts, seenNodes, counter)
      origins.add("eventText")
    }
    if (!description.isNullOrBlank()) {
      appendSyntheticNode(description, className, windowId, "eventDescription", out, seenTexts, seenNodes, counter)
      origins.add("eventDescription")
    }
  }

  private fun appendSyntheticNode(
    text: String,
    className: String?,
    windowId: Int,
    origin: String,
    out: JSONArray,
    seenTexts: MutableSet<String>,
    seenNodes: MutableSet<String>,
    counter: IntArray
  ) {
    if (counter[0] >= MAX_NODES) return
    val normalized = normalizeForDedupe(text)
    val key = "$origin|$windowId|$normalized"
    if (!seenTexts.add(key) || !seenNodes.add(key)) return
    counter[0]++

    out.put(JSONObject().apply {
      put("text", text)
      put("viewId", JSONObject.NULL)
      put("className", className ?: JSONObject.NULL)
      put("left", 0)
      put("top", 0)
      put("right", 0)
      put("bottom", 0)
      put("clickable", false)
      put("origin", origin)
      put("windowId", windowId)
    })
  }

  private fun belongsToPackage(node: AccessibilityNodeInfo, expectedPackage: String): Boolean {
    return try {
      val actual = node.packageName?.toString()?.lowercase()
      actual == null || actual == expectedPackage.lowercase()
    } catch (_: Exception) {
      true
    }
  }

  private fun safeWindowId(node: AccessibilityNodeInfo): Int {
    return try {
      node.windowId
    } catch (_: Exception) {
      -1
    }
  }

  private fun traverse(
    node: AccessibilityNodeInfo,
    depth: Int,
    out: JSONArray,
    seenTexts: MutableSet<String>,
    seenNodes: MutableSet<String>,
    counter: IntArray,
    origin: String,
    windowId: Int
  ) {
    if (depth > MAX_DEPTH || counter[0] >= MAX_NODES) return

    try {
      val text = node.text?.toString()?.trim()?.take(MAX_CHARS_PER_TEXT)
      val desc = node.contentDescription?.toString()?.trim()?.take(MAX_CHARS_PER_TEXT)
      val viewId = node.viewIdResourceName?.substringAfterLast("/")?.take(48)
      val className = node.className?.toString()?.substringAfterLast('.')?.take(40)
      val clickable = try { node.isClickable } catch (_: Exception) { false }

      val bounds = Rect()
      try {
        node.getBoundsInScreen(bounds)
      } catch (_: Exception) {
        bounds.set(0, 0, 0, 0)
      }

      val relevantText = selectRelevantText(text, desc, bounds, seenTexts, origin, windowId)
      val hasGeometry = bounds.width() > 0 || bounds.height() > 0
      val hasUseful =
        !relevantText.isNullOrBlank() ||
          !viewId.isNullOrBlank() ||
          hasGeometry ||
          clickable

      if (hasUseful && shouldKeepNode(relevantText, viewId, className, clickable)) {
        val nodeKey = buildNodeKey(relevantText, viewId, className, bounds, clickable, origin, windowId)
        if (seenNodes.add(nodeKey)) {
          counter[0]++
          val obj = JSONObject().apply {
            put("text", relevantText ?: JSONObject.NULL)
            put("viewId", viewId ?: JSONObject.NULL)
            put("className", className ?: JSONObject.NULL)
            put("left", bounds.left)
            put("top", bounds.top)
            put("right", bounds.right)
            put("bottom", bounds.bottom)
            put("clickable", clickable)
            put("origin", origin)
            put("windowId", windowId)
          }
          out.put(obj)
        }
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
            traverse(child, depth + 1, out, seenTexts, seenNodes, counter, origin, windowId)
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
    seen: MutableSet<String>,
    origin: String,
    windowId: Int
  ): String? {
    val candidates = listOfNotNull(text, desc)
      .map { it.trim() }
      .filter { it.isNotEmpty() }
      .distinct()

    for (candidate in candidates) {
      val sanitized = sanitizeOperationalText(candidate) ?: continue
      val key = buildString {
        append(origin).append('|').append(windowId).append('|')
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

  private fun shouldKeepNode(text: String?, viewId: String?, className: String?, clickable: Boolean): Boolean {
    if (!text.isNullOrBlank()) return true
    if (!viewId.isNullOrBlank()) return true
    if (clickable) return true
    if (className != null && (className.contains("Button", true) || className.contains("TextView", true))) {
      return true
    }
    return false
  }

  private fun buildNodeKey(
    text: String?,
    viewId: String?,
    className: String?,
    bounds: Rect,
    clickable: Boolean,
    origin: String,
    windowId: Int
  ): String {
    return listOf(
      origin,
      windowId.toString(),
      text?.let { normalizeForDedupe(it) }.orEmpty(),
      viewId.orEmpty(),
      className.orEmpty(),
      bounds.left.toString(),
      bounds.top.toString(),
      bounds.right.toString(),
      bounds.bottom.toString(),
      clickable.toString()
    ).joinToString("|")
  }

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
    val operational = mutableListOf<String>()
    val structural = mutableListOf<String>()

    for (i in 0 until nodes.length()) {
      val n = nodes.optJSONObject(i) ?: continue
      val t = n.optString("text", "").trim()
      if (t.isNotEmpty() && looksOperational(t)) {
        operational.add(normalizeForDedupe(t))
      }

      if (structural.size < 48) {
        structural.add(
          listOf(
            n.optString("origin", ""),
            n.optInt("windowId", -1).toString(),
            n.optString("viewId", ""),
            n.optString("className", ""),
            n.optInt("left", 0).toString(),
            n.optInt("top", 0).toString(),
            n.optInt("right", 0).toString(),
            n.optInt("bottom", 0).toString(),
            n.optBoolean("clickable", false).toString()
          ).joinToString(":")
        )
      }
    }

    val parts = mutableListOf(packageName.lowercase())
    if (operational.isNotEmpty()) {
      parts.addAll(operational.sorted())
    } else {
      parts.addAll(structural.sorted())
    }
    return parts.joinToString("|").hashCode().toString()
  }
}

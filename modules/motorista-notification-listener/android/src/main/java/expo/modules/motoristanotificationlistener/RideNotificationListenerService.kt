package expo.modules.motoristanotificationlistener

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject

class RideNotificationListenerService : NotificationListenerService() {
  companion object {
    private const val MAX_CHARS_PER_TEXT = 80

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

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    if (sbn == null || !isRideAppPackage(sbn.packageName)) return

    val notification = sbn.notification ?: return
    val extras = notification.extras ?: return

    val rawTitle = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
    val rawText = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
    val rawBigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
    val rawSubText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString()
    val rawSummaryText = extras.getCharSequence(Notification.EXTRA_SUMMARY_TEXT)?.toString()
    val rawInfoText = extras.getCharSequence(Notification.EXTRA_INFO_TEXT)?.toString()
    val rawBigContentTitle = extras.getCharSequence(Notification.EXTRA_TITLE_BIG)?.toString()
    val rawTickerText = notification.tickerText?.toString()
    val rawTextLines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.map { it.toString() }.orEmpty()

    val title = sanitizeOperationalText(rawTitle)
    val text = sanitizeOperationalText(rawText)
    val bigText = sanitizeOperationalText(rawBigText)
    val subText = sanitizeOperationalText(rawSubText)
    val summaryText = sanitizeOperationalText(rawSummaryText)
    val infoText = sanitizeOperationalText(rawInfoText)
    val bigContentTitle = sanitizeOperationalText(rawBigContentTitle)
    val tickerText = sanitizeOperationalText(rawTickerText)
    val textLines = sanitizeOperationalLines(rawTextLines)

    val hasBasicContent = listOf(rawTitle, rawText, rawBigText, rawSubText).any { !it.isNullOrBlank() }
    val hasExtendedContent = listOf(rawSummaryText, rawInfoText, rawBigContentTitle, rawTickerText).any { !it.isNullOrBlank() } || rawTextLines.any { it.isNotBlank() }
    val hasOperationalContent = listOf(title, text, bigText, subText, summaryText, infoText, bigContentTitle, tickerText).any { !it.isNullOrBlank() } || textLines.length() > 0

    // Keep a safe diagnostic even when Uber exposes content only through custom RemoteViews:
    // booleans show which Android extras existed, while free-form strings are never persisted.
    val item = JSONObject().apply {
      put("packageName", sbn.packageName)
      put("notificationKey", sbn.key)
      put("postedAt", sbn.postTime)
      put("appLabel", resolveAppLabel(sbn.packageName) ?: JSONObject.NULL)
      put("title", title ?: JSONObject.NULL)
      put("text", text ?: JSONObject.NULL)
      put("bigText", bigText ?: JSONObject.NULL)
      put("subText", subText ?: JSONObject.NULL)
      put("summaryText", summaryText ?: JSONObject.NULL)
      put("infoText", infoText ?: JSONObject.NULL)
      put("bigContentTitle", bigContentTitle ?: JSONObject.NULL)
      put("tickerText", tickerText ?: JSONObject.NULL)
      put("textLines", textLines)
      put("hasBasicContent", hasBasicContent)
      put("hasExtendedContent", hasExtendedContent)
      put("hasOperationalContent", hasOperationalContent)
      put("hasTextLines", rawTextLines.any { it.isNotBlank() })
      put("hasMessages", extras.containsKey(Notification.EXTRA_MESSAGES))
    }

    RideNotificationStore.append(applicationContext, item)
  }

  private fun resolveAppLabel(packageName: String): String? {
    return try {
      val appInfo = packageManager.getApplicationInfo(packageName, 0)
      packageManager.getApplicationLabel(appInfo).toString()
    } catch (_: Exception) {
      null
    }
  }

  private fun sanitizeOperationalLines(values: List<String>): JSONArray {
    val result = JSONArray()
    val seen = mutableSetOf<String>()
    for (value in values) {
      val sanitized = sanitizeOperationalText(value) ?: continue
      val key = sanitized.lowercase()
      if (seen.add(key)) result.put(sanitized)
    }
    return result
  }

  private fun sanitizeOperationalText(value: String?): String? {
    if (value.isNullOrBlank()) return null

    val fragments = mutableListOf<Pair<Int, String>>()
    for (pattern in OPERATIONAL_FRAGMENT_PATTERNS) {
      for (match in pattern.findAll(value)) {
        fragments.add(match.range.first to match.value.trim())
      }
    }

    if (fragments.isEmpty()) return null

    val seen = mutableSetOf<String>()
    val ordered = fragments
      .sortedBy { it.first }
      .map { it.second }
      .filter { seen.add(it.lowercase()) }
      .joinToString(" • ")
      .take(MAX_CHARS_PER_TEXT)
      .trim()

    return ordered.ifBlank { null }
  }

  private fun isRideAppPackage(packageName: String?): Boolean {
    val value = packageName?.lowercase() ?: return false
    return value.contains("uber") ||
      value.contains("taxis99") ||
      value.contains("99app") ||
      value.contains("indriver") ||
      value.contains("indrive")
  }
}

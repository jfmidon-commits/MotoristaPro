package expo.modules.motoristanotificationlistener

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

object RideAccessibilityStore {
  private const val PREFS = "motorista_accessibility_capture"
  private const val KEY_QUEUE = "snapshots"
  private const val MAX_ITEMS = 20
  private const val MAX_TOTAL_BYTES = 180_000
  private const val MAX_ITEM_BYTES = 12_000

  @Synchronized
  fun append(context: Context, item: JSONObject) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val current = try {
      JSONArray(prefs.getString(KEY_QUEUE, "[]") ?: "[]")
    } catch (_: Exception) {
      JSONArray()
    }

    var payload = item.toString()
    if (payload.length > MAX_ITEM_BYTES) {
      try {
        item.put("nodes", JSONArray())
        item.put("truncated", true)
        payload = item.toString()
      } catch (_: Exception) {
        return
      }
    }

    val next = JSONArray()
    val start = maxOf(0, current.length() - (MAX_ITEMS - 1))
    var totalBytes = payload.length
    for (i in start until current.length()) {
      val existing = current.opt(i)?.toString() ?: continue
      if (totalBytes + existing.length > MAX_TOTAL_BYTES) continue
      next.put(current.opt(i))
      totalBytes += existing.length
    }
    next.put(item)
    prefs.edit().putString(KEY_QUEUE, next.toString()).apply()
  }

  fun read(context: Context): String {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return prefs.getString(KEY_QUEUE, "[]") ?: "[]"
  }

  fun clear(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .remove(KEY_QUEUE)
      .apply()
  }
}

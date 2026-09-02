package expo.modules.motoristanotificationlistener

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Small native queue for conservative ride lifecycle signals.
 * It never stores passenger names or addresses. The queue is consumed by JS
 * when MotoristaPro is active again.
 */
object RideLifecycleStore {
  private const val PREFS = "motorista_ride_lifecycle"
  private const val KEY_QUEUE = "events"
  private const val MAX_ITEMS = 24

  @Synchronized
  fun append(context: Context, item: JSONObject) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val current = try {
      JSONArray(prefs.getString(KEY_QUEUE, "[]") ?: "[]")
    } catch (_: Exception) {
      JSONArray()
    }

    val next = JSONArray()
    val start = maxOf(0, current.length() - (MAX_ITEMS - 1))
    for (i in start until current.length()) next.put(current.opt(i))
    next.put(item)
    prefs.edit().putString(KEY_QUEUE, next.toString()).apply()
  }

  fun read(context: Context): String {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_QUEUE, "[]") ?: "[]"
  }

  fun clear(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .remove(KEY_QUEUE)
      .apply()
  }
}

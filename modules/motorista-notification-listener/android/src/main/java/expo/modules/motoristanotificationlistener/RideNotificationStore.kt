package expo.modules.motoristanotificationlistener

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

object RideNotificationStore {
  private const val PREFS_NAME = "motorista_notification_listener"
  private const val QUEUE_KEY = "ride_notification_queue"
  private const val MAX_ITEMS = 40

  @Synchronized
  fun append(context: Context, item: JSONObject) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val existing = try {
      JSONArray(prefs.getString(QUEUE_KEY, "[]") ?: "[]")
    } catch (_: Exception) {
      JSONArray()
    }

    val next = JSONArray()
    val start = maxOf(0, existing.length() - (MAX_ITEMS - 1))
    for (index in start until existing.length()) {
      next.put(existing.opt(index))
    }
    next.put(item)
    prefs.edit().putString(QUEUE_KEY, next.toString()).apply()
  }

  @Synchronized
  fun read(context: Context): String {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    return prefs.getString(QUEUE_KEY, "[]") ?: "[]"
  }

  @Synchronized
  fun clear(context: Context) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .remove(QUEUE_KEY)
      .apply()
  }
}

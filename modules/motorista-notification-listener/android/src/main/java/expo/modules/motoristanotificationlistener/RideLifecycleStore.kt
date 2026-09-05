package expo.modules.motoristanotificationlistener

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Native storage for conservative ride lifecycle signals and the current
 * per-platform state. It never stores passenger names or addresses.
 */
object RideLifecycleStore {
  private const val PREFS = "motorista_ride_lifecycle"
  private const val KEY_QUEUE = "events"
  private const val KEY_STATE_PREFIX = "state_"
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

  @Synchronized
  fun writePlatformState(context: Context, platform: String, state: JSONObject) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_STATE_PREFIX + platform.lowercase(), state.toString())
      .apply()
  }

  fun readPlatformState(context: Context, platform: String): JSONObject? {
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_STATE_PREFIX + platform.lowercase(), null)
      ?: return null
    return try { JSONObject(raw) } catch (_: Exception) { null }
  }

  fun clearPlatformState(context: Context, platform: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .remove(KEY_STATE_PREFIX + platform.lowercase())
      .apply()
  }
}

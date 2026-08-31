package expo.modules.motoristanotificationlistener

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject

class RideNotificationListenerService : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    if (sbn == null || !isRideAppPackage(sbn.packageName)) return

    val extras = sbn.notification?.extras ?: return
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
    val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
    val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
    val subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString()

    if (title.isNullOrBlank() && text.isNullOrBlank() && bigText.isNullOrBlank() && subText.isNullOrBlank()) return

    val item = JSONObject().apply {
      put("packageName", sbn.packageName)
      put("notificationKey", sbn.key)
      put("postedAt", sbn.postTime)
      put("title", title ?: JSONObject.NULL)
      put("text", text ?: JSONObject.NULL)
      put("bigText", bigText ?: JSONObject.NULL)
      put("subText", subText ?: JSONObject.NULL)
    }

    RideNotificationStore.append(applicationContext, item)
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

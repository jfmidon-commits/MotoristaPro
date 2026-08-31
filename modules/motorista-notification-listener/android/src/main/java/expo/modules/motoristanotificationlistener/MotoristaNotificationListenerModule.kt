package expo.modules.motoristanotificationlistener

import android.content.Intent
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MotoristaNotificationListenerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MotoristaNotificationListener")

    Function("getPermissionStatus") {
      val context = appContext.reactContext ?: return@Function "unavailable"
      val enabled = NotificationManagerCompat.getEnabledListenerPackages(context)
      if (enabled.contains(context.packageName)) "granted" else "denied"
    }

    Function("openNotificationAccessSettings") {
      val context = appContext.reactContext ?: return@Function false
      val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(intent)
      true
    }

    Function("getPendingNotificationsJson") {
      val context = appContext.reactContext ?: return@Function "[]"
      RideNotificationStore.read(context)
    }

    Function("clearPendingNotifications") {
      val context = appContext.reactContext ?: return@Function false
      RideNotificationStore.clear(context)
      true
    }
  }
}

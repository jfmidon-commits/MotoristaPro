package expo.modules.motoristanotificationlistener

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MotoristaNotificationListenerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MotoristaNotificationListener")

    Function("getPermissionStatus") {
      val context = appContext.reactContext ?: return@Function "unavailable"
      val enabled = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: ""
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

    Function("getAccessibilityPermissionStatus") {
      val context = appContext.reactContext ?: return@Function "unavailable"
      val captureEnabled = isAccessibilityServiceEnabled(context, "RideAccessibilityService")
      val lifecycleEnabled = isAccessibilityServiceEnabled(context, "RideLifecycleAccessibilityService")
      if (captureEnabled && lifecycleEnabled) "granted" else "denied"
    }

    Function("getRideLifecyclePermissionStatus") {
      val context = appContext.reactContext ?: return@Function "unavailable"
      if (isAccessibilityServiceEnabled(context, "RideLifecycleAccessibilityService")) "granted" else "denied"
    }

    Function("openAccessibilitySettings") {
      val context = appContext.reactContext ?: return@Function false
      val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(intent)
      true
    }

    Function("getPendingAccessibilitySnapshotsJson") {
      val context = appContext.reactContext ?: return@Function "[]"
      RideAccessibilityStore.read(context)
    }

    Function("clearPendingAccessibilitySnapshots") {
      val context = appContext.reactContext ?: return@Function false
      RideAccessibilityStore.clear(context)
      true
    }

    Function("getPendingRideLifecycleEventsJson") {
      val context = appContext.reactContext ?: return@Function "[]"
      RideLifecycleStore.read(context)
    }

    Function("clearPendingRideLifecycleEvents") {
      val context = appContext.reactContext ?: return@Function false
      RideLifecycleStore.clear(context)
      true
    }
  }

  private fun isAccessibilityServiceEnabled(context: Context, serviceSuffix: String): Boolean {
    val am = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager
      ?: return false
    val enabled = am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_GENERIC)
      ?: return false
    return enabled.any { info ->
      val id = info.id ?: return@any false
      id.contains(context.packageName) && id.endsWith(serviceSuffix)
    }
  }
}

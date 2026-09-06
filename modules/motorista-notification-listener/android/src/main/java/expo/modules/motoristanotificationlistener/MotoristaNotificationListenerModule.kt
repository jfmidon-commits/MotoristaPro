package expo.modules.motoristanotificationlistener

import android.content.Context
import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

class MotoristaNotificationListenerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MotoristaNotificationListener")

    Function("getPermissionStatus") {
      val context = appContext.reactContext ?: return@Function "unavailable"
      val enabled = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: ""
      if (enabled.contains(context.packageName, ignoreCase = true)) "granted" else "denied"
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
      val uberCaptureEnabled = isAccessibilityServiceEnabled(context, "RideAccessibilityService")
      val capture99Enabled = isAccessibilityServiceEnabled(context, "Ride99AccessibilityService")
      val lifecycleEnabled = isAccessibilityServiceEnabled(context, "RideLifecycleAccessibilityService")
      if ((uberCaptureEnabled || capture99Enabled) && lifecycleEnabled) "granted" else "denied"
    }

    Function("getRideLifecyclePermissionStatus") {
      val context = appContext.reactContext ?: return@Function "unavailable"
      if (isAccessibilityServiceEnabled(context, "RideLifecycleAccessibilityService")) "granted" else "denied"
    }

    Function("getAccessibilityServicesStatusJson") {
      val context = appContext.reactContext ?: return@Function "{}"
      JSONObject().apply {
        put("uberCapture", isAccessibilityServiceEnabled(context, "RideAccessibilityService"))
        put("capture99", isAccessibilityServiceEnabled(context, "Ride99AccessibilityService"))
        put("lifecycle", isAccessibilityServiceEnabled(context, "RideLifecycleAccessibilityService"))
      }.toString()
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
    val enabled = Settings.Secure.getString(
      context.contentResolver,
      Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
    ) ?: return false

    val packageName = context.packageName.lowercase()
    val suffix = serviceSuffix.lowercase()
    return enabled
      .split(':')
      .asSequence()
      .map { it.trim().lowercase() }
      .filter { it.isNotEmpty() }
      .any { component ->
        component.contains(packageName) && component.endsWith(suffix)
      }
  }
}

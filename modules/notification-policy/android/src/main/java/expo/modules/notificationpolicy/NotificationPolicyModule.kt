package expo.modules.notificationpolicy

import android.app.NotificationManager
import android.content.Context
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NotificationPolicyModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  override fun definition() = ModuleDefinition {
    Name("NotificationPolicy")

    Function("isNotificationPolicyAccessGranted") {
      isNotificationPolicyAccessGranted()
    }
  }

  private fun isNotificationPolicyAccessGranted(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false
    val notificationManager =
      context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return false
    return notificationManager.isNotificationPolicyAccessGranted
  }
}

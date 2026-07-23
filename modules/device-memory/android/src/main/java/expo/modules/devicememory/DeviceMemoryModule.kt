package expo.modules.devicememory

import android.app.ActivityManager
import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedReader
import java.io.FileReader

class DeviceMemoryModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  override fun definition() = ModuleDefinition {
    Name("DeviceMemory")

    Function("getMemoryInfo") { ->
      getMemoryInfo()
    }
  }

  private fun getMemoryInfo(): Map<String, Double> {
    val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val memInfo = ActivityManager.MemoryInfo()
    am.getMemoryInfo(memInfo)

    val totalMB = memInfo.totalMem / 1_048_576.0
    val freeMB = memInfo.availMem / 1_048_576.0
    val usedMB = totalMB - freeMB

    val runtime = Runtime.getRuntime()
    val appMB = (runtime.totalMemory() - runtime.freeMemory()) / 1_048_576.0

    val nativeMB = getNativePss()

    return mapOf(
      "totalMB" to totalMB,
      "usedMB" to usedMB,
      "freeMB" to freeMB,
      "appMB" to (appMB + nativeMB)
    )
  }

  private fun getNativePss(): Double {
    return try {
      val pid = android.os.Process.myPid()
      val reader = BufferedReader(FileReader("/proc/$pid/status"))
      var pss = 0.0
      reader.useLines { lines ->
        lines.forEach { line ->
          if (line.startsWith("VmRSS:")) {
            val parts = line.split("\\s+".toRegex())
            if (parts.size >= 2) {
              pss = parts[1].toDouble() / 1024.0
            }
          }
        }
      }
      pss
    } catch (_: Exception) {
      0.0
    }
  }
}

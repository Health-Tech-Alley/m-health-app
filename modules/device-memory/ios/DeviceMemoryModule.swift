import ExpoModulesCore
import MachO

public class DeviceMemoryModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DeviceMemory")

    Function("getMemoryInfo") { () -> [String: Double] in
      return Self.getMemoryInfo()
    }
  }

  static func getMemoryInfo() -> [String: Double] {
    var stats = vm_statistics64()
    var count = UInt32(MemoryLayout<vm_statistics64_data_t>.size / MemoryLayout<integer_t>.size)
    let result: kern_return_t = withUnsafeMutablePointer(to: &stats) { statsPtr in
      statsPtr.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { boundPtr in
        host_statistics64(mach_host_self(), HOST_VM_INFO64, boundPtr, &count)
      }
    }

    let pageSize = Double(vm_kernel_page_size)
    let totalBytes = Double(ProcessInfo.processInfo.physicalMemory)
    let totalMB = totalBytes / 1_048_576.0

    var usedMB = 0.0
    var freeMB = 0.0

    if result == KERN_SUCCESS {
      let freeBytes = Double(stats.free_count) * pageSize
      freeMB = freeBytes / 1_048_576.0
      usedMB = totalMB - freeMB
    }

    var taskInfo = task_vm_info_data_t()
    var taskCount = mach_msg_type_number_t(
      MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size
    )
    let taskResult: kern_return_t = withUnsafeMutablePointer(to: &taskInfo) { taskPtr in
      taskPtr.withMemoryRebound(to: natural_t.self, capacity: Int(taskCount)) { boundPtr in
        task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), boundPtr, &taskCount)
      }
    }

    let appMB = taskResult == KERN_SUCCESS
      ? Double(taskInfo.phys_footprint) / 1_048_576.0
      : 0.0

    return [
      "totalMB": totalMB,
      "usedMB": usedMB,
      "freeMB": freeMB,
      "appMB": appMB
    ]
  }
}

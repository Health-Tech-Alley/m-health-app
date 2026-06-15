import { useEffect, useRef, useState } from 'react';
import { NativeModules } from 'react-native';
import * as Device from 'expo-device';

export interface MemoryInfo {
  totalMB: number;
  usedMB: number;
  freeMB: number;
  appMB: number;
}

export interface DeviceMemoryModule {
  getMemoryInfo(): MemoryInfo;
}

let nativeModule: DeviceMemoryModule | null = null;
let resolved = false;

function resolveModule(): DeviceMemoryModule | null {
  if (resolved) return nativeModule;
  resolved = true;
  try {
    const mod = NativeModules.DeviceMemory as DeviceMemoryModule | undefined;
    if (mod && typeof mod.getMemoryInfo === 'function') {
      nativeModule = mod;
    }
  } catch {
    nativeModule = null;
  }
  return nativeModule;
}

function createMockModule(): DeviceMemoryModule {
  const totalMB = Device.totalMemory ? Device.totalMemory / 1_048_576 : 4096;
  return {
    getMemoryInfo: () => ({
      totalMB,
      usedMB: totalMB * 0.55,
      freeMB: totalMB * 0.45,
      appMB: 0,
    }),
  };
}

export function getDeviceMemoryModule(): DeviceMemoryModule {
  return resolveModule() ?? createMockModule();
}

export function isNativeMemoryAvailable(): boolean {
  return resolveModule() !== null;
}

export function useMemoryInfo(intervalMs: number = 2000): MemoryInfo | null {
  const [info, setInfo] = useState<MemoryInfo | null>(null);
  const moduleRef = useRef<DeviceMemoryModule>(getDeviceMemoryModule());

  useEffect(() => {
    const mod = moduleRef.current;

    const read = () => {
      try {
        setInfo(mod.getMemoryInfo());
      } catch {
        // native module may not be ready
      }
    };

    read();
    const id = setInterval(read, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return info;
}

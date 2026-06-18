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
  // Track a wandering baseline so the mock dashboard visibly updates over time
  // (the real native bridge returns fresh values each call; the mock must too,
  // otherwise the Performance screen looks static on Track A).
  let baseline = 0.55;
  let phase = 0;
  return {
    getMemoryInfo: () => {
      // Smooth sinusoidal wander in the 0.45–0.70 usage band, plus tiny noise.
      phase += 0.18;
      baseline = 0.575 + Math.sin(phase) * 0.08 + (Math.random() - 0.5) * 0.02;
      const usedMB = totalMB * Math.max(0.4, Math.min(0.72, baseline));
      return {
        totalMB,
        usedMB,
        freeMB: totalMB - usedMB,
        appMB: 0,
      };
    },
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

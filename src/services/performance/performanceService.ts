/**
 * Performance / RAM monitoring service.
 *
 * Builds on top of `src/services/device-memory.ts` to expose a 1 Hz RAM snapshot
 * suitable for live dashboards. The snapshot splits the device's used memory into
 * the portion attributed to the on-device SLM model and the rest of the system,
 * so a caregiver (or developer) can see how much of the phone's RAM the loaded
 * SLM is actually consuming.
 *
 * In Expo Go (Track A) the underlying native module isn't available, so the
 * snapshot uses a deterministic mock that varies slightly over time so the UI
 * still has something to render.
 */

import { useEffect, useState } from 'react';

import {
  getDeviceMemoryModule,
  isNativeMemoryAvailable,
  type MemoryInfo,
} from '@/services/device-memory';

export interface RamSnapshot {
  /** ISO-8601 timestamp of the sample. */
  timestamp: string;
  /** Total device RAM in MB. */
  totalMB: number;
  /** RAM currently in use across the whole device, in MB. */
  usedMB: number;
  /** RAM currently free across the whole device, in MB. */
  freeMB: number;
  /** RAM attributed to the foreground app, in MB (0 when the native bridge is absent). */
  appMB: number;
  /** RAM attributed to the loaded SLM model, in MB. */
  slmMB: number;
  /** `usedMB` minus `slmMB` — every other process on the device. */
  otherMB: number;
  /** Fraction of `totalMB` that is used, clamped to [0, 1]. */
  usedRatio: number;
  /** Fraction of `totalMB` consumed by the SLM, clamped to [0, 1]. */
  slmRatio: number;
  /** True when a real native memory bridge backs the snapshot. */
  hasNativeMemory: boolean;
}

const DEFAULT_INTERVAL_MS = 1000;

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function toSnapshot(
  raw: MemoryInfo,
  slmSizeMB: number,
  hasNativeMemory: boolean,
  timestamp: string,
): RamSnapshot {
  const totalMB = Math.max(1, raw.totalMB);
  // Clamp SLM attribution to the actual used bucket so a slightly-stale model
  // size can never push `otherMB` negative.
  const slmMB = clamp(slmSizeMB, 0, raw.usedMB);
  const otherMB = Math.max(0, raw.usedMB - slmMB);
  return {
    timestamp,
    totalMB,
    usedMB: raw.usedMB,
    freeMB: raw.freeMB,
    appMB: raw.appMB,
    slmMB,
    otherMB,
    usedRatio: clamp(raw.usedMB / totalMB, 0, 1),
    slmRatio: clamp(slmMB / totalMB, 0, 1),
    hasNativeMemory,
  };
}

/**
 * Hook that returns a fresh RAM snapshot on a fixed interval (default 1 Hz).
 *
 * Pass `slmSizeGB` from the SLM provider to attribute the right portion of the
 * device's used RAM to the loaded model. When no model is loaded, pass 0.
 */
export function useRamSnapshot(
  intervalMs: number = DEFAULT_INTERVAL_MS,
  slmSizeGB: number | null = 0,
): RamSnapshot | null {
  const [snapshot, setSnapshot] = useState<RamSnapshot | null>(null);

  useEffect(() => {
    const mod = getDeviceMemoryModule();
    const hasNativeMemory = isNativeMemoryAvailable();
    const slmSizeMB = (slmSizeGB ?? 0) * 1024;

    const read = () => {
      try {
        const raw = mod.getMemoryInfo();
        setSnapshot(
          toSnapshot(raw, slmSizeMB, hasNativeMemory, new Date().toISOString()),
        );
      } catch {
        // Native bridge may be transiently unavailable — keep the previous
        // snapshot on screen rather than blanking the dashboard.
      }
    };

    read();
    const id = setInterval(read, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, slmSizeGB]);

  return snapshot;
}

/** Format an MB value as a human-friendly "X.XX GB" or "X MB" string. */
export function formatRam(mb: number): string {
  if (!Number.isFinite(mb) || mb <= 0) return '0 MB';
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  if (mb >= 100) return `${mb.toFixed(0)} MB`;
  return `${mb.toFixed(1)} MB`;
}

/** A severity tier for a usage ratio, used to color RAM bars. */
export type RamSeverity = 'ok' | 'warn' | 'crit';

export function ramSeverity(usedRatio: number): RamSeverity {
  if (usedRatio >= 0.9) return 'crit';
  if (usedRatio >= 0.75) return 'warn';
  return 'ok';
}

/**
 * Pre-load RAM gate for SLM model loading.
 *
 * Checks free device memory against the model's footprint before attempting
 * a load. Prevents the OOM death spiral where blind foreground reload
 * exhausts LlamaRnProvider's 4-attempt ladder and leaves loadStatus === 'error'.
 *
 * If no native bridge is available, the gate permits the attempt but reports
 * free memory as unknown. Dev/native builds with the bridge read real memory.
 */

import { getDeviceMemoryModule, isNativeMemoryAvailable } from '@/services/device-memory';
import { MODEL_CATALOG } from '@/inference/model-catalog';

export const RAM_HEADROOM_RATIO = 1.25;
export const MIN_FREE_HEADROOM_MB = 500;

export type RamGateResult =
  | { ok: true; freeMB: number | null; requiredMB: number; native: boolean }
  | { ok: false; freeMB: number | null; requiredMB: number; native: boolean; reason: string };

export function checkSlmRamGate(modelId: string): RamGateResult {
  const entry = MODEL_CATALOG.find((m) => m.id === modelId);
  const modelMB = entry
    ? (entry.sizeBytes ?? 2.4e9) / (1024 * 1024)
    : 2400;
  const requiredMB = Math.max(modelMB * RAM_HEADROOM_RATIO, modelMB + MIN_FREE_HEADROOM_MB);

  // No native bridge: cannot pre-gate, and free memory is unknown.
  if (!isNativeMemoryAvailable()) {
    return { ok: true, freeMB: null, requiredMB, native: false };
  }

  const { freeMB } = getDeviceMemoryModule().getMemoryInfo();
  if (freeMB < requiredMB) {
    return {
      ok: false,
      freeMB,
      requiredMB,
      native: true,
      reason: `Need ~${requiredMB.toFixed(0)} MB free, have ${freeMB.toFixed(0)} MB`,
    };
  }
  return { ok: true, freeMB, requiredMB, native: true };
}

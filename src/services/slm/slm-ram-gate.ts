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
import { KV_BYTES_PER_TOKEN, MODEL_CATALOG } from '@/inference/model-catalog';

export const RAM_HEADROOM_RATIO = 1.25;
export const MIN_FREE_HEADROOM_MB = 500;

export type RamGateResult =
  | { ok: true; freeMB: number | null; requiredMB: number; native: boolean }
  | { ok: false; freeMB: number | null; requiredMB: number; native: boolean; reason: string };

/**
 * Pre-load RAM gate for SLM model loading.
 *
 * Checks free device memory against the model's footprint — weights plus an
 * estimated KV-cache allocation for the requested context window — before
 * attempting a load. Prevents the OOM death spiral where blind foreground
 * reload exhausts LlamaRnProvider's attempt ladder and leaves
 * loadStatus === 'error'.
 *
 * `nCtx` defaults to the catalog entry's preferred context so e.g. a model
 * with a larger window is gated on its KV-cache cost, not just the weights.
 */
export function checkSlmRamGate(modelId: string, nCtx?: number): RamGateResult {
  const entry = MODEL_CATALOG.find((m) => m.id === modelId);
  const modelMB = entry
    ? (entry.sizeBytes ?? 2.4e9) / (1024 * 1024)
    : 2400;
  const ctxTokens = nCtx ?? entry?.preferredNCtx ?? 4096;
  const kvMB = entry
    ? ((KV_BYTES_PER_TOKEN[entry.family] ?? KV_BYTES_PER_TOKEN.gemma4) * ctxTokens) / (1024 * 1024)
    : 0;
  const requiredMB = Math.max(modelMB * RAM_HEADROOM_RATIO, modelMB + MIN_FREE_HEADROOM_MB) + kvMB;

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
      reason: `Need ~${requiredMB.toFixed(0)} MB free (${modelMB.toFixed(0)} MB weights + ${kvMB.toFixed(0)} MB context), have ${freeMB.toFixed(0)} MB`,
    };
  }
  return { ok: true, freeMB, requiredMB, native: true };
}

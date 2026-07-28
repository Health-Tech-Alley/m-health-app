/**
 * App-wide knowledge pack install progress store (singleton).
 * Onboarding Device setup + Settings Clinical knowledge both subscribe.
 */

import type { PackInstallStatus, PackInstallUiState, PackSectionProgress } from './types';
import { PACK_LAYER_CATALOG, layerLabel } from './catalog';
import { getPackState, isPackReady } from './pack-state';
import { countPackChunks, getPackSizeBytes } from './pack-db';

type Listener = (state: PackInstallUiState) => void;

function emptySections(): PackSectionProgress[] {
  return PACK_LAYER_CATALOG.filter((l) => l.defaultOn || l.id === 'graph' || l.id === 'embeds').map(
    (l) => ({
      id: l.id,
      label: l.label,
      state: 'queued' as const,
      progress01: 0,
    }),
  );
}

function initialState(): PackInstallUiState {
  const ready = (() => {
    try {
      return isPackReady();
    } catch {
      return false;
    }
  })();
  const chunks = (() => {
    try {
      return countPackChunks();
    } catch {
      return 0;
    }
  })();
  const sizeBytes = (() => {
    try {
      return getPackSizeBytes();
    } catch {
      return 0;
    }
  })();
  return {
    status: ready ? 'ready' : 'idle',
    overall: ready ? 1 : 0,
    sections: emptySections().map((s) =>
      ready ? { ...s, state: 'done', progress01: 1 } : s,
    ),
    lastError: getSafeLastError(),
    updatedAt: new Date().toISOString(),
    chunksInstalled: chunks,
    sizeBytes,
  };
}

function getSafeLastError(): string | null {
  try {
    return getPackState().lastError;
  } catch {
    return null;
  }
}

let state: PackInstallUiState = {
  status: 'idle',
  overall: 0,
  sections: [],
  lastError: null,
  updatedAt: new Date().toISOString(),
  chunksInstalled: 0,
  sizeBytes: 0,
};
let hydrated = false;
const listeners = new Set<Listener>();

function ensureHydrated(): void {
  if (hydrated) return;
  hydrated = true;
  state = initialState();
}

export function getKnowledgePackInstallState(): PackInstallUiState {
  ensureHydrated();
  return state;
}

export function subscribeKnowledgePackInstall(listener: Listener): () => void {
  ensureHydrated();
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

export function setKnowledgePackInstallState(next: PackInstallUiState): void {
  ensureHydrated();
  state = { ...next, updatedAt: new Date().toISOString() };
  for (const l of listeners) {
    try {
      l(state);
    } catch {
      /* ignore subscriber errors */
    }
  }
}

export function patchKnowledgePackInstallState(
  partial: Partial<PackInstallUiState>,
): PackInstallUiState {
  ensureHydrated();
  const next = { ...state, ...partial, updatedAt: new Date().toISOString() };
  setKnowledgePackInstallState(next);
  return next;
}

export function markPackSection(
  id: PackSectionProgress['id'],
  patch: Partial<PackSectionProgress>,
): void {
  ensureHydrated();
  const sections = state.sections.map((s) => (s.id === id ? { ...s, ...patch } : s));
  // Ensure section exists
  if (!sections.some((s) => s.id === id)) {
    sections.push({
      id,
      label: layerLabel(id),
      state: 'queued',
      progress01: 0,
      ...patch,
    });
  }
  const weights = new Map(PACK_LAYER_CATALOG.map((l) => [l.id, l.weight]));
  let wSum = 0;
  let wDone = 0;
  for (const s of sections) {
    const w = weights.get(s.id) ?? 1;
    wSum += w;
    if (s.state === 'done' || s.state === 'skipped') wDone += w;
    else if (s.state === 'running' && typeof s.progress01 === 'number') {
      wDone += w * Math.min(1, Math.max(0, s.progress01));
    }
  }
  const overall = wSum > 0 ? wDone / wSum : 0;
  patchKnowledgePackInstallState({ sections, overall });
}

export function resetKnowledgePackInstallUi(status: PackInstallStatus = 'idle'): void {
  setKnowledgePackInstallState({
    status,
    overall: status === 'ready' ? 1 : 0,
    sections: emptySections().map((s) =>
      status === 'ready' ? { ...s, state: 'done', progress01: 1 } : s,
    ),
    lastError: null,
    updatedAt: new Date().toISOString(),
    chunksInstalled: status === 'ready' ? countPackChunksSafe() : 0,
    sizeBytes: status === 'ready' ? packSizeSafe() : 0,
  });
}

function countPackChunksSafe(): number {
  try {
    return countPackChunks();
  } catch {
    return 0;
  }
}

function packSizeSafe(): number {
  try {
    return getPackSizeBytes();
  } catch {
    return 0;
  }
}

/** Refresh chunk + size counters without changing status. */
export function refreshPackInstallMetrics(): void {
  patchKnowledgePackInstallState({
    chunksInstalled: countPackChunksSafe(),
    sizeBytes: packSizeSafe(),
  });
}

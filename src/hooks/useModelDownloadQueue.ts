/**
 * App-wide one-at-a-time SLM download queue (doc 42 D21).
 * Shared by Device setup + Settings Models.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { MODEL_CATALOG, type ModelEntry } from '@/inference/model-catalog';
import { downloadModel } from '@/services/model-download';
import {
  clearAllModels,
  deleteModel,
  isModelInstalled,
} from '@/services/model-storage';
import { getHfToken } from '@/services/hf-token-store';

export type ModelDownloadRowStatus =
  | 'not_installed'
  | 'downloading'
  | 'paused'
  | 'installed'
  | 'error';

export type ModelDownloadRow = {
  id: string;
  displayName: string;
  sizeBytes: number;
  file: string;
  status: ModelDownloadRowStatus;
  bytesWritten: number;
  totalBytes: number;
  error: string | null;
};

type QueueState = {
  rows: ModelDownloadRow[];
  activeModelId: string | null;
  version: number;
};

type Listener = () => void;

const listeners = new Set<Listener>();
const cancelHandles = new Map<string, { cancel: () => void }>();

function buildRows(): ModelDownloadRow[] {
  return MODEL_CATALOG.map((entry) => ({
    id: entry.id,
    displayName: entry.displayName,
    sizeBytes: entry.sizeBytes,
    file: entry.file,
    status: isModelInstalled(entry) ? 'installed' : 'not_installed',
    bytesWritten: 0,
    totalBytes: 0,
    error: null,
  }));
}

let state: QueueState = {
  rows: buildRows(),
  activeModelId: null,
  version: 0,
};

function emit(): void {
  state = { ...state, version: state.version + 1 };
  for (const l of listeners) l();
}

function refreshInstalled(): void {
  state = {
    ...state,
    rows: state.rows.map((row) => {
      const entry = MODEL_CATALOG.find((e) => e.id === row.id);
      if (!entry) return row;
      if (row.status === 'downloading') return row;
      const installed = isModelInstalled(entry);
      return {
        ...row,
        status: installed ? 'installed' : row.status === 'error' ? 'error' : 'not_installed',
        error: installed ? null : row.error,
      };
    }),
  };
  emit();
}

function patchRow(modelId: string, patch: Partial<ModelDownloadRow>): void {
  state = {
    ...state,
    rows: state.rows.map((r) => (r.id === modelId ? { ...r, ...patch } : r)),
  };
  emit();
}

export function getModelDownloadQueueSnapshot(): QueueState {
  return state;
}

export function subscribeModelDownloadQueue(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isAnyModelDownloading(): boolean {
  return state.activeModelId != null;
}

export async function startModelDownload(modelId: string, hfToken?: string | null): Promise<void> {
  const entry = MODEL_CATALOG.find((e) => e.id === modelId);
  if (!entry) return;
  if (state.activeModelId && state.activeModelId !== modelId) {
    patchRow(modelId, {
      status: 'error',
      error: 'Another Concierge model is downloading. Wait or cancel it first.',
    });
    return;
  }

  let token = hfToken ?? null;
  if (token === undefined || token === null) {
    try {
      token = await getHfToken();
    } catch {
      token = null;
    }
  }

  state = { ...state, activeModelId: modelId };
  patchRow(modelId, {
    status: 'downloading',
    bytesWritten: 0,
    totalBytes: entry.sizeBytes,
    error: null,
  });

  const handle = downloadModel(entry, token, {
    onProgress: (bytesWritten, totalBytes) => {
      patchRow(modelId, {
        status: 'downloading',
        bytesWritten,
        totalBytes: totalBytes > 0 ? totalBytes : entry.sizeBytes,
      });
    },
    onComplete: () => {
      cancelHandles.delete(modelId);
      state = { ...state, activeModelId: null };
      patchRow(modelId, {
        status: 'installed',
        bytesWritten: entry.sizeBytes,
        totalBytes: entry.sizeBytes,
        error: null,
      });
      refreshInstalled();
    },
    onError: (error) => {
      cancelHandles.delete(modelId);
      state = { ...state, activeModelId: null };
      patchRow(modelId, {
        status: 'error',
        error,
      });
    },
  });
  cancelHandles.set(modelId, handle);
}

export function cancelModelDownload(modelId: string): void {
  const handle = cancelHandles.get(modelId);
  if (handle) {
    handle.cancel();
    cancelHandles.delete(modelId);
  }
  if (state.activeModelId === modelId) {
    state = { ...state, activeModelId: null };
  }
  patchRow(modelId, {
    status: 'not_installed',
    bytesWritten: 0,
    totalBytes: 0,
    error: null,
  });
  refreshInstalled();
}

export function removeDownloadedModel(modelId: string): void {
  const entry = MODEL_CATALOG.find((e) => e.id === modelId);
  if (entry) deleteModel(entry);
  cancelModelDownload(modelId);
  refreshInstalled();
}

export type ModelDeleteResult = { ok: true } | { ok: false; reason: string };

/**
 * Guarded delete — the last installed Concierge model cannot be removed
 * (Concierge surfaces hard-require at least one model on-device).
 */
export function canDeleteModel(modelId: string): ModelDeleteResult {
  const installedIds = state.rows.filter((r) => r.status === 'installed').map((r) => r.id);
  if (installedIds.length <= 1 && installedIds.includes(modelId)) {
    return {
      ok: false,
      reason: 'Keep at least one Concierge model on this device. Download a different model first if you want to replace it.',
    };
  }
  return { ok: true };
}

/** Remove a model with the keep-≥1 guard applied. */
export function removeModelGuarded(modelId: string): ModelDeleteResult {
  const guard = canDeleteModel(modelId);
  if (!guard.ok) return guard;
  removeDownloadedModel(modelId);
  return { ok: true };
}

/** Ids of installed models (for default reassignment after a delete). */
export function getInstalledModelIds(): string[] {
  return state.rows.filter((r) => r.status === 'installed').map((r) => r.id);
}

export function removeAllDownloadedModels(): number {
  for (const id of [...cancelHandles.keys()]) {
    cancelModelDownload(id);
  }
  const n = clearAllModels();
  refreshInstalled();
  return n;
}

export function useModelDownloadQueue() {
  const snap = useSyncExternalStore(
    subscribeModelDownloadQueue,
    getModelDownloadQueueSnapshot,
    getModelDownloadQueueSnapshot,
  );

  useEffect(() => {
    refreshInstalled();
  }, []);

  const startDownload = useCallback((modelId: string, hfToken?: string | null) => {
    return startModelDownload(modelId, hfToken);
  }, []);

  const cancelDownload = useCallback((modelId: string) => {
    cancelModelDownload(modelId);
  }, []);

  const removeModel = useCallback((modelId: string) => {
    return removeModelGuarded(modelId);
  }, []);

  const clearAll = useCallback(() => removeAllDownloadedModels(), []);

  const anyDownloading = snap.activeModelId != null;
  const anyInstalled = snap.rows.some((r) => r.status === 'installed');

  return {
    rows: snap.rows,
    activeModelId: snap.activeModelId,
    anyDownloading,
    anyInstalled,
    startDownload,
    cancelDownload,
    removeModel,
    clearAll,
    refresh: refreshInstalled,
  };
}

export function catalogEntry(modelId: string): ModelEntry | undefined {
  return MODEL_CATALOG.find((e) => e.id === modelId);
}

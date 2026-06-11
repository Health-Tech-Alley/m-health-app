import { MODEL_CATALOG } from '@/inference/model-catalog';
import {
  deleteHfToken,
  getHfToken,
  setHfToken as persistHfToken,
} from '@/services/hf-token-store';
import { downloadModel } from '@/services/model-download';
import { deleteModel, isModelInstalled } from '@/services/model-storage';
import type { ModelItem, ModelsAction } from './types';

function buildItems(): ModelItem[] {
  return MODEL_CATALOG.map((entry) => ({
    id: entry.id,
    displayName: entry.displayName,
    file: entry.file,
    status: isModelInstalled(entry) ? 'installed' : 'not-installed',
    downloadProgress: 0,
    downloadTotal: 0,
    error: null,
  }));
}

export function createModelsController() {
  const activeDownloads = new Map<string, { cancel: () => void }>();

  return {
    async init(): Promise<ModelsAction> {
      const token = await getHfToken();
      return {
        type: 'set-items',
        payload: {
          items: buildItems(),
          ...(token ? { hfToken: token } : {}),
        } as any,
      };
    },

    startDownload(modelId: string, hfToken: string | null): ModelsAction {
      const entry = MODEL_CATALOG.find((e) => e.id === modelId);
      if (!entry) return { type: 'noop' };

      const handle = downloadModel(entry, hfToken, {
        onProgress: (bytesWritten, totalBytes) => {
          this._dispatchRef?.({
            type: 'download-progress',
            payload: { modelId, bytesWritten, totalBytes },
          });
        },
        onComplete: () => {
          activeDownloads.delete(modelId);
          this._dispatchRef?.({
            type: 'download-complete',
            payload: { modelId },
          });
        },
        onError: (error) => {
          activeDownloads.delete(modelId);
          this._dispatchRef?.({
            type: 'download-error',
            payload: { modelId, error },
          });
        },
      });

      activeDownloads.set(modelId, handle);

      return { type: 'download-start', payload: { modelId } };
    },

    cancelDownload(modelId: string): ModelsAction {
      const handle = activeDownloads.get(modelId);
      if (handle) {
        handle.cancel();
        activeDownloads.delete(modelId);
      }
      return { type: 'delete-complete', payload: { modelId } };
    },

    removeModel(modelId: string): ModelsAction {
      const entry = MODEL_CATALOG.find((e) => e.id === modelId);
      if (entry) {
        deleteModel(entry);
      }
      return { type: 'delete-complete', payload: { modelId } };
    },

    async saveHfToken(token: string): Promise<ModelsAction> {
      try {
        if (token.trim()) {
          await persistHfToken(token.trim());
        } else {
          await deleteHfToken();
        }
        return { type: 'save-hf-token-success' };
      } catch (err: any) {
        return {
          type: 'save-hf-token-error',
          payload: { error: err.message ?? 'Failed to save token' },
        };
      }
    },

    setDispatchRef(dispatch: (action: ModelsAction) => void) {
      this._dispatchRef = dispatch;
    },

    _dispatchRef: null as ((action: ModelsAction) => void) | null,
  };
}

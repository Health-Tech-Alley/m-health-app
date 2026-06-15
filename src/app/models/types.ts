export type ModelStatus = 'not-installed' | 'downloading' | 'installed' | 'error';

export interface ModelItem {
  id: string;
  displayName: string;
  file: string;
  status: ModelStatus;
  downloadProgress: number;
  downloadTotal: number;
  error: string | null;
}

export interface ModelsState {
  items: ModelItem[];
  hfToken: string;
  hfTokenSaved: boolean;
  hfTokenMasked: boolean;
}

export type ModelsAction =
  | { type: 'noop' }
  | { type: 'set-items'; payload: { items: ModelItem[] } }
  | {
      type: 'download-start';
      payload: { modelId: string };
    }
  | {
      type: 'download-progress';
      payload: { modelId: string; bytesWritten: number; totalBytes: number };
    }
  | {
      type: 'download-complete';
      payload: { modelId: string };
    }
  | {
      type: 'download-error';
      payload: { modelId: string; error: string };
    }
  | {
      type: 'delete-complete';
      payload: { modelId: string };
    }
  | { type: 'clear-all-complete' }
  | { type: 'set-hf-token'; payload: { token: string } }
  | { type: 'save-hf-token-success' }
  | { type: 'save-hf-token-error'; payload: { error: string } }
  | { type: 'toggle-hf-token-mask' };

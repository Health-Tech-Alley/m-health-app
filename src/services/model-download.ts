import { DownloadTask, File } from 'expo-file-system';
import type { DownloadProgress } from 'expo-file-system';

import type { ModelEntry } from '@/inference/model-catalog';
import { getHfDownloadUrl } from '@/inference/model-catalog';
import { getModelsDirectory } from './model-storage';

export type DownloadCallbacks = {
  onProgress: (bytesWritten: number, totalBytes: number) => void;
  onComplete: () => void;
  onError: (error: string) => void;
};

export function downloadModel(
  entry: ModelEntry,
  hfToken: string | null,
  callbacks: DownloadCallbacks,
): { cancel: () => void } {
  const url = getHfDownloadUrl(entry);
  const dir = getModelsDirectory();
  const destination = new File(dir, entry.file);

  const headers: Record<string, string> = {};
  if (hfToken) {
    headers['Authorization'] = `Bearer ${hfToken}`;
  }

  const task = new DownloadTask(url, destination, {
    headers,
    onProgress: (data: DownloadProgress) => {
      callbacks.onProgress(data.bytesWritten, data.totalBytes);
    },
  });

  task.addListener('progress', () => {});

  task
    .downloadAsync()
    .then(() => {
      callbacks.onComplete();
    })
    .catch((err: any) => {
      if (err.name === 'AbortError') return;
      callbacks.onError(err.message ?? 'Download failed');
    });

  return {
    cancel: () => {
      task.cancel();
    },
  };
}

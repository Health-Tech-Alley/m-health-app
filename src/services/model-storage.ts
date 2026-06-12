import { Directory, File, Paths } from 'expo-file-system';

import type { ModelEntry } from '@/inference/model-catalog';

export function getModelsDirectory(): Directory {
  const dir = new Directory(Paths.document, 'models');
  if (!dir.exists) {
    dir.create();
  }
  return dir;
}

export function isModelInstalled(entry: ModelEntry): boolean {
  const dir = getModelsDirectory();
  const file = new File(dir, entry.file);
  return file.exists;
}

export function deleteModel(entry: ModelEntry): void {
  const dir = getModelsDirectory();
  const file = new File(dir, entry.file);
  if (file.exists) {
    file.delete();
  }
}

export function getModelFileSize(entry: ModelEntry): number | null {
  const dir = getModelsDirectory();
  const file = new File(dir, entry.file);
  if (!file.exists) return null;
  return file.size;
}

export function clearAllModels(): number {
  const dir = getModelsDirectory();
  let count = 0;
  for (const item of dir.list()) {
    item.delete();
    count++;
  }
  return count;
}

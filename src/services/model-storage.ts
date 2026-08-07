import { Directory, File, Paths } from 'expo-file-system';

import { MODEL_CATALOG, type ModelEntry } from '@/inference/model-catalog';

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

/**
 * Decide which files in the models folder are complete files of supported
 * models. A file is kept only when its name matches a catalog entry AND its
 * size matches the expected byte size — partial/interrupted downloads carry
 * the right name but the wrong size, so they are treated as removable.
 * Pure function so the classification is unit-testable without native FS.
 */
export function classifyModelsFolderFiles(
  items: { name: string; size: number }[],
  catalog: { file: string; sizeBytes: number }[] = MODEL_CATALOG,
): { keep: string[]; remove: string[] } {
  const expected = new Map(catalog.map((e) => [e.file, e.sizeBytes]));
  const keep: string[] = [];
  const remove: string[] = [];
  for (const item of items) {
    if (expected.get(item.name) === item.size) {
      keep.push(item.name);
    } else {
      remove.push(item.name);
    }
  }
  return { keep, remove };
}

/**
 * Delete every file in the models folder that is not a complete file of a
 * supported model (orphaned files from removed catalog entries, partial
 * downloads, stray temp files). Returns the number of deleted items.
 */
export function cleanModelsFolder(): number {
  const dir = getModelsDirectory();
  const { remove } = classifyModelsFolderFiles(
    dir.list().map((item) => ({ name: item.name, size: item.size ?? 0 })),
  );
  const removeSet = new Set(remove);
  let count = 0;
  for (const item of dir.list()) {
    if (removeSet.has(item.name)) {
      item.delete();
      count++;
    }
  }
  return count;
}

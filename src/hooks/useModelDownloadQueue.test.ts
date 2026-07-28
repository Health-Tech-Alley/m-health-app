import { MODEL_CATALOG } from '@/inference/model-catalog';
import {
  cancelModelDownload,
  getModelDownloadQueueSnapshot,
  isAnyModelDownloading,
  startModelDownload,
} from './useModelDownloadQueue';

jest.mock('@/services/model-download', () => ({
  downloadModel: jest.fn(() => ({ cancel: jest.fn() })),
}));

jest.mock('@/services/model-storage', () => ({
  isModelInstalled: jest.fn(() => false),
  deleteModel: jest.fn(),
  clearAllModels: jest.fn(() => 0),
}));

jest.mock('@/services/hf-token-store', () => ({
  getHfToken: jest.fn(async () => null),
}));

describe('model download queue', () => {
  it('exposes catalog rows', () => {
    const snap = getModelDownloadQueueSnapshot();
    expect(snap.rows.length).toBe(MODEL_CATALOG.length);
    expect(snap.rows[0].id).toBe(MODEL_CATALOG[0].id);
  });

  it('tracks active download concurrency flag', async () => {
    cancelModelDownload(MODEL_CATALOG[0].id);
    expect(isAnyModelDownloading()).toBe(false);
    await startModelDownload(MODEL_CATALOG[0].id, null);
    expect(isAnyModelDownloading()).toBe(true);
    cancelModelDownload(MODEL_CATALOG[0].id);
    expect(isAnyModelDownloading()).toBe(false);
  });
});

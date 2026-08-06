import { classifyModelsFolderFiles } from './model-storage';

const catalog = [
  { file: 'gemma-4-E2B-it-Q4_K_M.gguf', sizeBytes: 2_403_612_800 },
  { file: 'Bonsai-8B-Q1_0.gguf', sizeBytes: 1_158_654_496 },
  { file: 'LFM2.5-2.6B-Q4_K_M.gguf', sizeBytes: 1_674_454_848 },
];

describe('classifyModelsFolderFiles', () => {
  it('keeps files whose name AND size match a catalog entry', () => {
    const items = [
      { name: 'gemma-4-E2B-it-Q4_K_M.gguf', size: 2_403_612_800 },
      { name: 'LFM2.5-2.6B-Q4_K_M.gguf', size: 1_674_454_848 },
    ];
    const { keep, remove } = classifyModelsFolderFiles(items, catalog);
    expect(keep).toEqual([
      'gemma-4-E2B-it-Q4_K_M.gguf',
      'LFM2.5-2.6B-Q4_K_M.gguf',
    ]);
    expect(remove).toEqual([]);
  });

  it('marks partial downloads for removal (right name, wrong size)', () => {
    const items = [
      { name: 'gemma-4-E2B-it-Q4_K_M.gguf', size: 1_200_000_000 },
      { name: 'Bonsai-8B-Q1_0.gguf', size: 100 },
    ];
    const { keep, remove } = classifyModelsFolderFiles(items, catalog);
    expect(keep).toEqual([]);
    expect(remove).toEqual([
      'gemma-4-E2B-it-Q4_K_M.gguf',
      'Bonsai-8B-Q1_0.gguf',
    ]);
  });

  it('marks orphaned files for removal (not in the catalog)', () => {
    const items = [
      { name: 'old-model-removed-from-catalog.gguf', size: 2_000_000_000 },
      { name: 'healthgpt-pro-8b-q4_k_m.gguf', size: 5_000_000_000 },
      { name: 'notes.txt', size: 42 },
    ];
    const { keep, remove } = classifyModelsFolderFiles(items, catalog);
    expect(keep).toEqual([]);
    expect(remove).toHaveLength(3);
  });

  it('mixes kept and removed correctly', () => {
    const items = [
      { name: 'gemma-4-E2B-it-Q4_K_M.gguf', size: 2_403_612_800 },
      { name: 'gemma-4-E2B-it-Q4_K_M.gguf.part', size: 500_000_000 },
      { name: 'Bonsai-8B-Q1_0.gguf', size: 42 },
    ];
    const { keep, remove } = classifyModelsFolderFiles(items, catalog);
    expect(keep).toEqual(['gemma-4-E2B-it-Q4_K_M.gguf']);
    expect(remove).toEqual([
      'gemma-4-E2B-it-Q4_K_M.gguf.part',
      'Bonsai-8B-Q1_0.gguf',
    ]);
  });
});

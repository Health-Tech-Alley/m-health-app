import {
  DEFAULT_SLM_MODEL_ID,
  KV_BYTES_PER_TOKEN,
  MODEL_CATALOG,
  getHfDownloadUrl,
  getModelEntry,
  resolveActiveModelId,
} from './model-catalog';

describe('model catalog (multi-model)', () => {
  it('exposes Gemma as the default and Bonsai 8B (1-bit) as an alternate', () => {
    expect(DEFAULT_SLM_MODEL_ID).toBe('gemma-4-e2b');
    expect(MODEL_CATALOG.length).toBeGreaterThanOrEqual(2);
    const gemma = getModelEntry('gemma-4-e2b');
    const bonsai = getModelEntry('bonsai-8b-1bit');
    expect(gemma).toBeDefined();
    expect(bonsai).toBeDefined();
    expect(gemma?.family).toBe('gemma4');
    expect(bonsai?.family).toBe('qwen3');
    expect(bonsai?.experimental).toBe(true);
  });

  it('carries per-family think and sampling profiles', () => {
    const gemma = getModelEntry('gemma-4-e2b')!;
    const bonsai = getModelEntry('bonsai-8b-1bit')!;
    expect(gemma.think.mode).toBe('gemma4-prefix');
    expect(bonsai.think.mode).toBe('template-native');
    expect(bonsai.sampling.temperature).toBeLessThan(1.0);
    expect(bonsai.preferredNCtx).toBe(8192);
    // Q1_0 has Metal kernels — Bonsai runs on GPU.
    expect(bonsai.nGpuLayers).toBe(-1);
    expect(gemma.preferredNCtx).toBe(8192);
    expect(gemma.nGpuLayers).toBe(-1);
  });

  it('builds HF download URLs per repo', () => {
    const bonsai = getModelEntry('bonsai-8b-1bit')!;
    expect(getHfDownloadUrl(bonsai)).toBe(
      'https://huggingface.co/prism-ml/Bonsai-8B-gguf/resolve/main/Bonsai-8B-Q1_0.gguf',
    );
  });

  it('resolves the active model id (preferred, then installed, then default)', () => {
    const installed = new Set(['bonsai-8b-1bit']);
    const isInstalled = (id: string) => installed.has(id);

    expect(resolveActiveModelId('bonsai-8b-1bit', isInstalled)).toBe('bonsai-8b-1bit');
    // Preferred not installed → falls back to the first installed catalog model.
    expect(resolveActiveModelId('gemma-4-e2b', isInstalled)).toBe('bonsai-8b-1bit');
    // Nothing installed → default id (surfaces show an install CTA).
    expect(resolveActiveModelId(null, () => false)).toBe(DEFAULT_SLM_MODEL_ID);
  });

  it('provides KV-cache estimates for the RAM gate', () => {
    expect(KV_BYTES_PER_TOKEN.gemma4).toBeGreaterThan(0);
    expect(KV_BYTES_PER_TOKEN.qwen3).toBeGreaterThan(KV_BYTES_PER_TOKEN.gemma4);
  });
});

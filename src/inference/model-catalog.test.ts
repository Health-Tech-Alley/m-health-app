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

  it('exposes LFM2.5-2.6B as an experimental lfm2-family model', () => {
    const lfm2 = getModelEntry('lfm2-5-2-6b');
    expect(lfm2).toBeDefined();
    expect(lfm2?.family).toBe('lfm2');
    expect(lfm2?.experimental).toBe(true);
    expect(lfm2?.hfRepo).toBe('LiquidAI/LFM2.5-2.6B-GGUF');
    expect(lfm2?.hfFile).toBe('LFM2.5-2.6B-Q4_K_M.gguf');
    expect(lfm2?.sizeBytes).toBe(1_674_454_848);
    // LFM2 Q4_K_M uses standard Metal kernels — GPU offload with CPU fallback.
    expect(lfm2?.nGpuLayers).toBe(-1);
    expect(lfm2?.think.mode).toBe('template-native');
    expect(lfm2?.sampling.temperature).toBeLessThan(0.5);
    expect(lfm2?.sampling.topK).toBe(50);
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

  it('always returns the single installed model as default, ignoring the persisted preference', () => {
    const installed = new Set(['lfm2-5-2-6b']);
    const isInstalled = (id: string) => installed.has(id);

    // Persisted default is a different model that is NOT installed.
    expect(resolveActiveModelId('gemma-4-e2b', isInstalled)).toBe('lfm2-5-2-6b');
    // Persisted default is the installed model — still resolves to it.
    expect(resolveActiveModelId('lfm2-5-2-6b', isInstalled)).toBe('lfm2-5-2-6b');
  });

  it('respects the persisted preference when multiple models are installed', () => {
    const installed = new Set(['gemma-4-e2b', 'bonsai-8b-1bit']);
    const isInstalled = (id: string) => installed.has(id);

    expect(resolveActiveModelId('bonsai-8b-1bit', isInstalled)).toBe('bonsai-8b-1bit');
    expect(resolveActiveModelId(null, isInstalled)).toBe('gemma-4-e2b');
  });

  it('provides KV-cache estimates for the RAM gate', () => {
    expect(KV_BYTES_PER_TOKEN.gemma4).toBeGreaterThan(0);
    expect(KV_BYTES_PER_TOKEN.qwen3).toBeGreaterThan(KV_BYTES_PER_TOKEN.gemma4);
    // Hybrid LFM2 — only 8 of 30 blocks are GQA attention → small KV.
    expect(KV_BYTES_PER_TOKEN.lfm2).toBeLessThan(KV_BYTES_PER_TOKEN.qwen3);
    expect(KV_BYTES_PER_TOKEN.lfm2).toBeGreaterThan(0);
  });
});

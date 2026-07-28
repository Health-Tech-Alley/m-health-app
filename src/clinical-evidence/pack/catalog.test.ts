import {
  getDefaultContentLayerIds,
  PACK_LAYER_CATALOG,
  LIT_LITE_RETMAX,
  PACK_EMBED_LAYER_IDS,
  shouldEmbedPackLayer,
} from './catalog';

describe('pack catalog', () => {
  it('includes lit_lite and openfda ON by default', () => {
    const lit = PACK_LAYER_CATALOG.find((l) => l.id === 'lit_lite');
    const fda = PACK_LAYER_CATALOG.find((l) => l.id === 'openfda');
    expect(lit?.defaultOn).toBe(true);
    expect(fda?.defaultOn).toBe(true);
    expect(LIT_LITE_RETMAX).toBeGreaterThanOrEqual(50);
  });

  it('keeps sdoh off by default', () => {
    const sdoh = PACK_LAYER_CATALOG.find((l) => l.id === 'sdoh');
    expect(sdoh?.defaultOn).toBe(false);
  });

  it('default content layers exclude graph/embeds', () => {
    const ids = getDefaultContentLayerIds();
    expect(ids).toContain('spine');
    expect(ids).toContain('lit_lite');
    expect(ids).not.toContain('graph');
    expect(ids).not.toContain('embeds');
    expect(ids).not.toContain('sdoh');
  });

  it('embeds curated layers but not lit_lite', () => {
    expect(PACK_EMBED_LAYER_IDS).toContain('meds_base');
    expect(PACK_EMBED_LAYER_IDS).toContain('medlineplus');
    expect(PACK_EMBED_LAYER_IDS).toContain('spine');
    expect(PACK_EMBED_LAYER_IDS).toContain('cpg');
    expect(PACK_EMBED_LAYER_IDS).not.toContain('lit_lite');
    expect(shouldEmbedPackLayer('lit_lite')).toBe(false);
    expect(shouldEmbedPackLayer('meds_base')).toBe(true);
  });
});

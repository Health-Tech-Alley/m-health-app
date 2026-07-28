/**
 * Pack layer fetchers — fixtures path (no live network / no native sqlite).
 */

import { setLiveClinicalFetch } from '@/clinical-evidence/fixture-mode';
import { fetchSpineLayer } from './fetch/spine-layer';
import { fetchCpgLayer } from './fetch/cpg-layer';
import { fetchOrphanetLayer } from './fetch/orphanet-layer';
import { fetchPublicHealthLayer } from './fetch/public-health-layer';
import { fetchMedsBaseLayer } from './fetch/dailymed-layer';
import { fetchDdiLayer } from './fetch/ddi-layer';
import { fetchDmeLayer } from './fetch/dme-layer';
import { fetchLitLiteLayer } from './fetch/pubmed-lite-layer';
import { fetchMedlinePlusLayer } from './fetch/medlineplus-layer';
import { getDefaultContentLayerIds } from './catalog';
import { getPackLayerStats } from './pack-db';

describe('pack layer fetchers (fixtures)', () => {
  beforeAll(() => {
    setLiveClinicalFetch(false);
  });

  it('spine returns care-gap chunks', async () => {
    const { rows, version } = await fetchSpineLayer(['Cerebral Palsy']);
    expect(version).toBeTruthy();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].text.length).toBeGreaterThan(40);
  });

  it('cpg returns guideline digests', async () => {
    const { rows } = await fetchCpgLayer(['Cerebral Palsy', 'COPD']);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('orphanet returns rare-disease rows', async () => {
    const { rows } = await fetchOrphanetLayer(['Cerebral Palsy']);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('public_health returns allowlisted digests', async () => {
    const { rows } = await fetchPublicHealthLayer(['COPD']);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('meds_base falls back offline for chart meds only', async () => {
    const { rows } = await fetchMedsBaseLayer(['baclofen', 'albuterol']);
    // Patient-scoped: one fallback label per chart drug (no global formulary).
    expect(rows.length).toBe(2);
  });

  it('meds_base is empty when chart has no meds', async () => {
    const { rows } = await fetchMedsBaseLayer([]);
    expect(rows.length).toBe(0);
  });

  it('ddi returns practical pairs offline', async () => {
    const { rows } = await fetchDdiLayer(['baclofen', 'diazepam']);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('dme returns device digests', async () => {
    const { rows } = await fetchDmeLayer(['Cerebral Palsy']);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('lit_lite returns abstract digests offline', async () => {
    const { rows } = await fetchLitLiteLayer(['Cerebral Palsy']);
    expect(rows.length).toBeGreaterThanOrEqual(8);
  });

  it('pack-db exposes layer stats', () => {
    const stats = getPackLayerStats();
    expect(Array.isArray(stats)).toBe(true);
  });

  it('medlineplus uses wide ICD seed list offline', async () => {
    const { rows } = await fetchMedlinePlusLayer(['Cerebral Palsy'], ['baclofen']);
    expect(rows.length).toBeGreaterThanOrEqual(20);
  });

  it('recommended content layers include lit_lite', () => {
    expect(getDefaultContentLayerIds()).toContain('lit_lite');
  });
});

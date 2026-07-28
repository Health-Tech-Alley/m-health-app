/**
 * Meds tab glance: unions patient overlay + global pack (chart-med labels).
 */

import { searchKnowledgeCache } from '@/data';
import { searchPackChunks } from '@/clinical-evidence/pack';
import { getMedKnowledgeGlance } from './medKnowledgeGlance';

jest.mock('@/data', () => ({
  searchKnowledgeCache: jest.fn(() => []),
}));

jest.mock('@/clinical-evidence/pack', () => ({
  searchPackChunks: jest.fn(() => []),
}));

jest.mock('@/clinical-evidence/retrieval-helper', () => ({
  citationSourceLabel: (s: string) => s,
}));

const mockOverlay = searchKnowledgeCache as jest.Mock;
const mockPack = searchPackChunks as jest.Mock;

const packLabelChunk = {
  chunkId: 'pack:meds_base:DM-1#s0',
  source: 'dailymed',
  text: 'Baclofen is indicated for the treatment of spasticity. Do not stop abruptly.',
  retrievedAt: new Date().toISOString(),
};

describe('getMedKnowledgeGlance', () => {
  beforeEach(() => {
    mockOverlay.mockReset().mockReturnValue([]);
    mockPack.mockReset().mockReturnValue([]);
  });

  it('returns null when neither overlay nor pack has content', () => {
    expect(getMedKnowledgeGlance('Baclofen', 'p1')).toBeNull();
  });

  it('reads chart-med labels from the global pack', () => {
    mockPack.mockReturnValue([packLabelChunk]);
    const glance = getMedKnowledgeGlance('Baclofen', 'p1');
    expect(glance).not.toBeNull();
    expect(glance?.indication).toContain('indicated');
    expect(glance?.sourceLabels).toContain('Drug label');
  });

  it('dedupes chunks present in both overlay and pack', () => {
    const overlayChunk = {
      chunkId: 'shared-1',
      source: 'dailymed',
      text: 'Baclofen is indicated for spasticity.',
      retrievedAt: new Date().toISOString(),
      useCount: 0,
    };
    mockOverlay.mockReturnValue([overlayChunk]);
    mockPack.mockReturnValue([{ ...packLabelChunk, chunkId: 'shared-1' }]);
    const glance = getMedKnowledgeGlance('Baclofen', 'p1');
    expect(glance).not.toBeNull();
    expect(glance?.sourceLabels.length).toBeGreaterThan(0);
  });

  it('returns null without a patient id', () => {
    expect(getMedKnowledgeGlance('Baclofen', null)).toBeNull();
  });
});

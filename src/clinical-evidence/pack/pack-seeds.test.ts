import {
  buildMedicationSeedsFingerprint,
  mergeMedicationSeeds,
  PACK_LAYER_MIN_CHUNKS,
} from './pack-seeds';

describe('mergeMedicationSeeds (patient chart only)', () => {
  it('dedupes and lowercases chart meds', () => {
    expect(mergeMedicationSeeds(['Baclofen', ' baclofen ', 'Albuterol'])).toEqual([
      'baclofen',
      'albuterol',
    ]);
  });

  it('returns empty for empty chart', () => {
    expect(mergeMedicationSeeds([])).toEqual([]);
    expect(mergeMedicationSeeds(['', '  '])).toEqual([]);
  });

  it('does not inject a global formulary', () => {
    const names = mergeMedicationSeeds(['baclofen']);
    expect(names).toEqual(['baclofen']);
    expect(names.length).toBe(1);
  });
});

describe('buildMedicationSeedsFingerprint', () => {
  it('is order-independent', () => {
    expect(buildMedicationSeedsFingerprint(['albuterol', 'baclofen'])).toBe(
      buildMedicationSeedsFingerprint(['baclofen', 'albuterol']),
    );
  });
});

describe('PACK_LAYER_MIN_CHUNKS med floors', () => {
  it('allows empty patient-scoped med layers', () => {
    expect(PACK_LAYER_MIN_CHUNKS.meds_base).toBe(0);
    expect(PACK_LAYER_MIN_CHUNKS.openfda).toBe(0);
  });
});

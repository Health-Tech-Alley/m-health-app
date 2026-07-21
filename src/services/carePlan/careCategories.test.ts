import {
  CARE_CATEGORY_ORDER,
  careCategoryForUc4Domain,
  careCategoryLabel,
  categorizeCareText,
  uc4FocusCodeForCategory,
} from './careCategories';

describe('categorizeCareText', () => {
  it('maps medication text to medication before broader categories', () => {
    expect(categorizeCareText('Track fatigue around medication timing')).toBe('medication');
  });

  it('maps skin and repositioning text to skin & pressure', () => {
    expect(categorizeCareText('Reposition every 2 hours to protect skin')).toBe('skin_pressure');
  });

  it('maps bowel/bladder text', () => {
    expect(categorizeCareText('Document bowel routine changes')).toBe('bowel_bladder');
  });

  it('maps breathing text', () => {
    expect(categorizeCareText('Watch breathing during sleep')).toBe('breathing');
  });

  it('maps therapy text', () => {
    expect(categorizeCareText('Daily stretching exercises')).toBe('therapy');
  });

  it('maps responsiveness text', () => {
    expect(categorizeCareText('Note any unusual responsiveness or confusion')).toBe('responsiveness');
  });

  it('falls back to other for unmatched or empty text', () => {
    expect(categorizeCareText('Quarterly care conference')).toBe('other');
    expect(categorizeCareText('')).toBe('other');
    expect(categorizeCareText(null)).toBe('other');
    expect(categorizeCareText(undefined)).toBe('other');
  });
});

describe('careCategoryForUc4Domain', () => {
  it('maps known engine domains', () => {
    expect(careCategoryForUc4Domain('skin_pressure_prevention_context')).toBe('skin_pressure');
    expect(careCategoryForUc4Domain('medication_timing_context')).toBe('medication');
    expect(careCategoryForUc4Domain('rehab_therapy_context')).toBe('therapy');
    expect(careCategoryForUc4Domain('fall_context')).toBe('mobility_transfers');
  });

  it('falls back to other for unknown or missing domains', () => {
    expect(careCategoryForUc4Domain('nonsense')).toBe('other');
    expect(careCategoryForUc4Domain(null)).toBe('other');
  });
});

describe('uc4FocusCodeForCategory', () => {
  it('maps the five engine-supported categories', () => {
    expect(uc4FocusCodeForCategory('skin_pressure')).toBe('SKIN_PRESSURE');
    expect(uc4FocusCodeForCategory('bowel_bladder')).toBe('BOWEL_BLADDER');
    expect(uc4FocusCodeForCategory('breathing')).toBe('BREATHING_CONTEXT');
    expect(uc4FocusCodeForCategory('responsiveness')).toBe('RESPONSIVENESS_CONTEXT');
    expect(uc4FocusCodeForCategory('therapy')).toBe('REHAB_THERAPY');
  });

  it('returns null for categories the engine does not evaluate', () => {
    expect(uc4FocusCodeForCategory('medication')).toBeNull();
    expect(uc4FocusCodeForCategory('other')).toBeNull();
  });
});

describe('labels and order', () => {
  it('has a label for every category and an order covering all keys', () => {
    for (const key of CARE_CATEGORY_ORDER) {
      expect(careCategoryLabel(key).length).toBeGreaterThan(0);
    }
    expect(CARE_CATEGORY_ORDER).toContain('other');
  });
});

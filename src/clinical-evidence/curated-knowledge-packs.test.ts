import {
  selectCpgFixturesForConditions,
  CPG_FIXTURES,
} from '@/knowledge/corpora/cpg-fixtures';
import {
  selectDisabilityCareGapsForConditions,
  disabilityCareGapsToChunks,
} from '@/knowledge/corpora/disability-care-gap-fixtures';
import { shouldRunMedSafetyContext } from './med-safety-context';

describe('selectCpgFixturesForConditions', () => {
  it('returns AAN CP guidelines for cerebral palsy', () => {
    const rows = selectCpgFixturesForConditions(['Spastic quadriplegic cerebral palsy']);
    const ids = rows.map((r) => r.docId);
    expect(ids).toContain('CPG-AAN-CP-2017');
    expect(ids).toContain('CPG-AAN-CP-dysphagia');
  });

  it('returns TBI stubs for traumatic brain injury', () => {
    const rows = selectCpgFixturesForConditions(['Traumatic brain injury']);
    const ids = rows.map((r) => r.docId);
    expect(ids).toContain('CPG-TBI-rehab-home');
    expect(ids.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty when no condition matches', () => {
    expect(selectCpgFixturesForConditions(['Seasonal allergies'])).toEqual([]);
  });

  it('keeps all CPG fixtures addressable', () => {
    expect(CPG_FIXTURES.length).toBeGreaterThanOrEqual(10);
  });
});

describe('disability care-gap pack', () => {
  it('always includes general gaps and CP-specific gaps for CP', () => {
    const gaps = selectDisabilityCareGapsForConditions([
      'Spastic quadriplegic cerebral palsy',
    ]);
    const ids = gaps.map((g) => g.id);
    expect(ids).toContain('GAP-therapy-followup');
    expect(ids).toContain('GAP-aspiration-feeding');
    expect(ids).toContain('GAP-skin-pressure');
  });

  it('includes AD gap for spina bifida', () => {
    const gaps = selectDisabilityCareGapsForConditions(['Spina bifida']);
    expect(gaps.map((g) => g.id)).toContain('GAP-autonomic-dysreflexia');
  });

  it('maps gaps to knowledge chunks with stable ids', () => {
    const gaps = selectDisabilityCareGapsForConditions(['COPD']);
    const chunks = disabilityCareGapsToChunks(gaps, 'COPD');
    expect(chunks.every((c) => c.chunkId.startsWith('GAP-'))).toBe(true);
    expect(chunks.every((c) => c.documentType === 'guideline')).toBe(true);
  });
});

describe('shouldRunMedSafetyContext', () => {
  it('runs on med_check intent', () => {
    expect(
      shouldRunMedSafetyContext({
        medicationNames: ['Baclofen', 'Tizanidine'],
        intent: 'med_check',
      }),
    ).toBe(true);
  });

  it('runs when medication entities present', () => {
    expect(
      shouldRunMedSafetyContext({
        medicationNames: ['Baclofen'],
        hasMedicationEntities: true,
      }),
    ).toBe(true);
  });

  it('skips general chat without med signals', () => {
    expect(
      shouldRunMedSafetyContext({
        medicationNames: ['Baclofen', 'Keppra'],
        intent: 'caregiver_chat_general',
        message: 'How was his sleep last night?',
      }),
    ).toBe(false);
  });
});

import {
  runUC4StructuredMicroPriorities,
  UC4_RULE_REGISTRY,
  UC4_TEMPLATE_REGISTRY,
  type UC4RunInput,
} from './index';

function baseInput(overrides: Partial<UC4RunInput> = {}): UC4RunInput {
  return {
    patient: {
      patientId: 'patient-1',
      displayName: 'Patient',
      synthetic: false,
      primaryContextLabel: 'Post stroke rehabilitation',
      carePlanFocusCodes: ['REHAB_THERAPY', 'SKIN_PRESSURE', 'BOWEL_BLADDER', 'BREATHING_CONTEXT'],
    },
    medications: [],
    recentEvents: [
      {
        eventId: 'fatigue-1',
        patientId: 'patient-1',
        timestampIso: '2026-07-15T12:00:00.000Z',
        source: 'caregiver_checkin',
        observationCodes: ['UNUSUAL_FATIGUE'],
        contextCodes: ['AFTER_ACTIVITY_OR_THERAPY'],
        freeTextUsedForScoring: false,
      },
      {
        eventId: 'fatigue-2',
        patientId: 'patient-1',
        timestampIso: '2026-07-16T12:00:00.000Z',
        source: 'caregiver_checkin',
        observationCodes: ['UNUSUAL_FATIGUE', 'THERAPY_ROUTINE_DIFFICULTY'],
        contextCodes: ['AFTER_ACTIVITY_OR_THERAPY'],
        freeTextUsedForScoring: false,
      },
      {
        eventId: 'transfer-1',
        patientId: 'patient-1',
        timestampIso: '2026-07-16T13:00:00.000Z',
        source: 'caregiver_checkin',
        observationCodes: ['PAIN_OR_DISCOMFORT', 'TRANSFER_OR_POSITIONING_CONTEXT'],
        contextCodes: ['DURING_TRANSFER'],
        freeTextUsedForScoring: false,
      },
    ],
    previousPriorities: [],
    uc1ActiveEmergency: false,
    currentSeverityContext: 'routine',
    nowIso: '2026-07-17T12:00:00.000Z',
    ...overrides,
  };
}

describe('Jay UC4 runtime parity surface', () => {
  it('uses Jay registry/template entry points and renders only valid structured cards', () => {
    expect(UC4_RULE_REGISTRY.some((rule) => rule.ruleCode === 'R_FATIGUE_RECURRENCE')).toBe(true);
    expect(UC4_TEMPLATE_REGISTRY.some((template) => template.templateId === 'THERAPY_REHAB_ROUTINE_DIFFICULTY')).toBe(true);

    const output = runUC4StructuredMicroPriorities(baseInput());

    expect(output.paused).toBe(false);
    expect(output.selectedCards.length).toBeGreaterThan(0);
    expect(output.selectedCards.length).toBeLessThanOrEqual(3);
    for (const card of output.selectedCards) {
      expect(card.whatToLogNextSchema.length).toBeGreaterThan(0);
      expect(card.freeTextUsedForScoring).toBe(false);
      expect(card.safetyBoundary.length).toBeGreaterThan(0);
    }
  });

  it('preserves Jay emergency pause behavior', () => {
    const output = runUC4StructuredMicroPriorities(baseInput({
      uc1ActiveEmergency: true,
      currentSeverityContext: 'uc1_or_uc2_severity_3_emergency',
    }));

    expect(output.paused).toBe(true);
    expect(output.pauseReason).toContain('Severity 3 emergency');
    expect(output.selectedCards).toHaveLength(0);
  });
});

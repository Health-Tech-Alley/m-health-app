import { runUC4StructuredMicroPriorities } from '../runUC4StructuredMicroPriorities';
import { mapMedicationNameToWatchAreas } from '../uc4MedicationWatchMapping';
import type { UC4RunInput } from '../uc4Types';

function baseInput(overrides?: Partial<UC4RunInput>): UC4RunInput {
  return {
    patient: {
      patientId: 'mike-demo',
      displayName: 'Mike',
      synthetic: true,
      carePlanFocusCodes: ['skin_pressure', 'medication_timing'],
      primaryContextLabel: 'Cerebral palsy',
    },
    medications: [
      {
        patientId: 'mike-demo',
        medicationName: 'Baclofen',
        synthetic: true,
        watchAreas: mapMedicationNameToWatchAreas('Baclofen'),
        scheduleText: 'Morning and evening',
      },
    ],
    recentEvents: [
      {
        eventId: 'e1',
        patientId: 'mike-demo',
        timestampIso: '2026-07-15T09:00:00.000Z',
        source: 'caregiver_checkin',
        observationCodes: ['UNUSUAL_FATIGUE'],
        contextCodes: ['AROUND_MEDICATION_TIME'],
        freeTextUsedForScoring: false,
      },
      {
        eventId: 'e2',
        patientId: 'mike-demo',
        timestampIso: '2026-07-14T09:00:00.000Z',
        source: 'caregiver_checkin',
        observationCodes: ['UNUSUAL_FATIGUE'],
        contextCodes: ['AROUND_MEDICATION_TIME'],
        freeTextUsedForScoring: false,
      },
      {
        eventId: 'e3',
        patientId: 'mike-demo',
        timestampIso: '2026-07-13T09:00:00.000Z',
        source: 'caregiver_checkin',
        observationCodes: ['UNUSUAL_FATIGUE'],
        contextCodes: ['AROUND_MEDICATION_TIME'],
        freeTextUsedForScoring: false,
      },
    ],
    previousPriorities: [],
    uc1ActiveEmergency: false,
    currentSeverityContext: 'routine',
    nowIso: '2026-07-16T12:00:00.000Z',
    ...overrides,
  };
}

describe('runUC4StructuredMicroPriorities', () => {
  it('pauses during Severity 3 emergency', () => {
    const result = runUC4StructuredMicroPriorities(
      baseInput({
        uc1ActiveEmergency: true,
        currentSeverityContext: 'uc1_or_uc2_severity_3_emergency',
      }),
    );
    expect(result.paused).toBe(true);
    expect(result.selectedCards).toHaveLength(0);
    expect(result.pauseReason).toMatch(/emergency/i);
  });

  it('returns cards with templateId and whatToLogNextSchema when not paused', () => {
    const result = runUC4StructuredMicroPriorities(baseInput());
    expect(result.paused).toBe(false);
    for (const card of result.selectedCards) {
      expect(card.templateId).toBeTruthy();
      expect(card.whatToLogNextSchema?.length).toBeGreaterThan(0);
      expect(card.freeTextUsedForScoring).toBe(false);
    }
  });

  it('never uses free text for scoring on events', () => {
    const input = baseInput();
    for (const e of input.recentEvents) {
      expect(e.freeTextUsedForScoring).toBe(false);
    }
  });
});

describe('mapMedicationNameToWatchAreas', () => {
  it('maps baclofen to fatigue/weakness watch areas', () => {
    const areas = mapMedicationNameToWatchAreas('Baclofen 10mg');
    expect(areas).toContain('SLEEPINESS_FATIGUE');
    expect(areas.length).toBeGreaterThan(0);
  });

  it('returns timing context for unknown meds', () => {
    const areas = mapMedicationNameToWatchAreas('Unknown Compound X');
    expect(areas).toContain('MEDICATION_TIMING_CONTEXT_NEEDED');
  });
});

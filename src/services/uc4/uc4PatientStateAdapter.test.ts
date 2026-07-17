import type { PatientRecordSnapshot } from '../../data/types';
import { adaptPatientRecordSnapshotToUC4Input } from './uc4PatientStateAdapter';

function snapshot(overrides: Partial<PatientRecordSnapshot> = {}): PatientRecordSnapshot {
  return {
    patient: { patientId: 'patient-1', name: 'Patient One', preferredName: 'Pat' } as never,
    safetyNotes: '',
    caregiver: { name: 'Caregiver', relationship: 'spouse' } as never,
    conditions: [{ conditionId: 'cond-1', patientId: 'patient-1', name: 'Post stroke' }],
    comorbidities: [],
    primaryCondition: { conditionId: 'cond-1', patientId: 'patient-1', name: 'Post stroke' },
    pendingReviewConditions: [],
    symptoms: [],
    wearable: { connected: true } as never,
    medications: [{ medicationId: 'med-1', patientId: 'patient-1', name: 'Medication', active: true }],
    medicationCandidates: [],
    medicationConfirmationRequirements: {},
    functionalObservations: [],
    thresholds: [],
    carePlan: { planId: 'plan-1', patientId: 'patient-1' } as never,
    carePlans: [],
    rehabPlanMetrics: [{ id: 'metric-1', metricKey: 'walkingMinutes' }] as never,
    rehabExerciseAssignments: [],
    todayDailyCareEntry: null,
    rehabDailyEntries: [
      {
        entryId: 'daily-2',
        patientId: 'patient-1',
        entryDate: '2026-07-16',
        therapyCompleted: false,
        skippedReason: 'shortness of breath',
        painScore: 2,
        fatigue: 4,
        symptoms: ['fall_with_injury'],
        assignedExerciseKeys: ['supported_arm_reach'],
        completedExerciseKeys: [],
      } as never,
      {
        entryId: 'daily-1',
        patientId: 'patient-1',
        entryDate: '2026-07-15',
        therapyCompleted: true,
        painScore: 0,
        fatigue: 0,
        symptoms: [],
      } as never,
    ],
    latestUc3TrajectoryResult: null,
    latestUc4Run: null,
    latestUc4PriorityCards: [],
    recentUc4CaregiverResponses: [
      {
        responseId: 'response-1',
        patientId: 'patient-1',
        cardId: 'card-1',
        templateId: 'THERAPY_REHAB_ROUTINE_DIFFICULTY',
        action: 'caregiver_response_submitted',
        observationCodes: ['CAREGIVER_WANTS_PROVIDER_REVIEW'],
        contextCodes: ['AFTER_ACTIVITY_OR_THERAPY'],
        caregiverRequestedProviderReview: true,
        createdAt: '2026-07-17T09:00:00.000Z',
      },
    ],
    careContextItems: [],
    timelineEvents: [],
    carePlanGoals: [],
    knowledgeStats: { total: 0, bySource: {} },
    enrichmentStats: { total: 0, bySource: {} },
    bundlePending: false,
    bundleStatus: { state: 'complete', chunksAdded: 0 },
    lastRefreshedAt: '2026-07-17T12:00:00.000Z',
    ...overrides,
  };
}

describe('adaptPatientRecordSnapshotToUC4Input', () => {
  it('maps hydrated state only into Jay UC4 input without querying repositories', () => {
    const result = adaptPatientRecordSnapshotToUC4Input({
      snapshot: snapshot(),
      activeAlerts: [{ alertId: 'alert-1', severity: 2, title: 'Review', createdAt: '2026-07-17T00:00:00.000Z' }],
      previousPriorities: [],
      nowIso: '2026-07-17T12:00:00.000Z',
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.input.patient).toMatchObject({
      patientId: 'patient-1',
      displayName: 'Pat',
      carePlanFocusCodes: ['REHAB_THERAPY'],
    });
    expect(result.input.currentSeverityContext).toBe('uc2_severity_2_provider_review');
    expect(result.input.uc1ActiveEmergency).toBe(false);
    expect(result.input.medications[0].watchAreas).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'medication_watch_areas_omitted',
      'wearable_summary_omitted',
    ]);
  });

  it('uses shared caregiver facts and deterministic ordering', () => {
    const result = adaptPatientRecordSnapshotToUC4Input({
      snapshot: snapshot(),
      activeAlerts: [],
      previousPriorities: [],
      nowIso: '2026-07-17T12:00:00.000Z',
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.input.recentEvents.map((event) => event.eventId)).toEqual([
      'response-1',
      'uc4-daily:patient-1:2026-07-16T12:00:00.000Z:0',
    ]);
    expect(result.input.recentEvents[1].observationCodes).toEqual([
      'BREATHING_CONCERN',
      'FALL_OR_NEAR_FALL',
      'PAIN_OR_DISCOMFORT',
      'THERAPY_ROUTINE_DIFFICULTY',
      'UNUSUAL_FATIGUE',
    ]);
  });

  it('does not default unavailable wearable flags to false', () => {
    const result = adaptPatientRecordSnapshotToUC4Input({
      snapshot: snapshot({ wearable: null }),
      activeAlerts: [],
      previousPriorities: [],
      nowIso: '2026-07-17T12:00:00.000Z',
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.input.wearableSummary).toBeUndefined();
  });
});

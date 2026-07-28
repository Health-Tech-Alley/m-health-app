import { mapChatLabelToCareIntent, fillArgsForCareIntent } from '../careIntentMapper';
import type { PatientRecordSnapshot } from '@/data/types';
import type { LinkedEntity } from '@/nlu/types';

function snap(partial: Partial<PatientRecordSnapshot> = {}): PatientRecordSnapshot {
  return {
    patient: null,
    safetyNotes: '',
    caregiver: null,
    conditions: [],
    comorbidities: [],
    primaryCondition: null,
    pendingReviewConditions: [],
    symptoms: [],
    wearable: null,
    medications: [],
    medicationCandidates: [],
    medicationConfirmationRequirements: {},
    functionalObservations: [],
    thresholds: [],
    carePlan: null,
    carePlans: [],
    rehabPlanMetrics: [],
    rehabExerciseAssignments: [],
    todayDailyCareEntry: null,
    rehabDailyEntries: [],
    latestUc3TrajectoryResult: {
      resultId: 'uc3-1',
      patientId: 'p1',
      carePlanId: 'cp1',
      modelFamily: 'uc3',
      modelVersion: '1',
      inputFingerprint: 'x',
      eventType: 'TRAJECTORY_FAILURE_DETECTED',
      severity: 'non_emergency',
      requiresHumanReview: true,
      emergencyThresholdBreach: false,
      reviewPriorityScore: 0.8,
      reasonCodes: [],
      explanations: [],
      metricAnalyses: {},
      dataQuality: {} as never,
      createdAt: new Date().toISOString(),
    } as never,
    latestUc4Run: null,
    latestUc4PriorityCards: [
      {
        cardId: 'card-1',
        patientId: 'p1',
        runId: 'run-1',
        templateId: 't1',
        priorityKind: 'focus',
        title: 'Fatigue',
        body: 'Watch fatigue timing',
        domain: 'energy',
        score: 0.9,
        firedRuleCodes: [],
        evidence: [],
        whatToLogNextSchema: [],
        safetyBoundary: 'non_emergency',
        status: 'active',
        generatedAt: new Date().toISOString(),
      } as never,
    ],
    recentUc4CaregiverResponses: [],
    careContextItems: [],
    timelineEvents: [],
    carePlanGoals: [],
    knowledgeStats: { total: 0, bySource: {} },
    enrichmentStats: { total: 0, bySource: {} },
    bundlePending: false,
    bundleStatus: 'idle' as never,
    activeAdcpVersion: null,
    pendingPlanProposals: [],
    therapyContractPresent: true,
    lastRefreshedAt: new Date().toISOString(),
    ...partial,
  };
}

describe('mapChatLabelToCareIntent', () => {
  it('maps promote phrase to promote_uc4_to_plan_task with cardId', () => {
    const mapped = mapChatLabelToCareIntent({
      chatLabel: 'caregiver_chat_general',
      confidence: 0.5,
      entities: [],
      snapshot: snap(),
      text: "add this priority to the plan",
    });
    expect(mapped?.intent).toBe('promote_uc4_to_plan_task');
    expect(mapped?.args.cardId).toBe('card-1');
  });

  it('maps logging phrase', () => {
    const mapped = mapChatLabelToCareIntent({
      chatLabel: 'detect_care_gaps',
      confidence: 0.8,
      entities: [],
      snapshot: snap(),
      text: 'what should I log today',
    });
    expect(mapped?.intent).toBe('suggest_todays_logging');
  });

  it('maps therapy language to explain_uc3_result', () => {
    const mapped = mapChatLabelToCareIntent({
      chatLabel: 'knowledge_qa',
      confidence: 0.6,
      entities: [],
      snapshot: snap(),
      text: "how is James's therapy going",
    });
    expect(mapped?.intent).toBe('explain_uc3_result');
    expect(mapped?.args.resultId).toBe('uc3-1');
  });

  it('maps surface entity priorities list', () => {
    const entities: LinkedEntity[] = [
      {
        type: 'app_surface',
        id: 'surface:priorities_list',
        label: 'priorities list',
        score: 0.95,
      },
    ];
    const mapped = mapChatLabelToCareIntent({
      chatLabel: 'next_steps',
      confidence: 0.6,
      entities,
      snapshot: snap(),
      text: 'what is on the priorities list',
    });
    expect(mapped?.intent).toBe('explain_uc4_card');
    expect(mapped?.source).toBe('surface');
  });
});

describe('fillArgsForCareIntent', () => {
  it('fills uc4 card and uc3 result ids', () => {
    const s = snap();
    expect(fillArgsForCareIntent('explain_uc4_card', [], s).cardId).toBe('card-1');
    expect(fillArgsForCareIntent('explain_uc3_result', [], s).resultId).toBe('uc3-1');
  });
});

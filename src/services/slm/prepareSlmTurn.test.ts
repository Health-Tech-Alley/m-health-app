import { fetchOnDemandMedToOverlay } from '@/clinical-evidence/pack';
import { prepareSlmTurn, selectOnDemandMedCandidates } from './prepareSlmTurn';

jest.mock('@/clinical-evidence/pack', () => ({
  fetchOnDemandMedToOverlay: jest.fn(async () => []),
}));

const mockFetchOnDemand = fetchOnDemandMedToOverlay as jest.Mock;

describe('selectOnDemandMedCandidates', () => {
  it('picks mentioned meds that are not on the chart', () => {
    expect(
      selectOnDemandMedCandidates(['Ibuprofen', 'Baclofen'], ['baclofen 10mg']),
    ).toEqual(['Ibuprofen']);
  });

  it('returns empty when all mentioned meds are chart meds', () => {
    expect(selectOnDemandMedCandidates(['Baclofen'], ['Baclofen'])).toEqual([]);
  });

  it('does not treat a different drug as charted via shared first token', () => {
    expect(
      selectOnDemandMedCandidates(['insulin lispro'], ['insulin glargine 100 units/ml']),
    ).toEqual(['insulin lispro']);
  });

  it('dedupes and caps at two', () => {
    expect(
      selectOnDemandMedCandidates(['Aspirin', 'aspirin', 'Melatonin', 'Zolpidem'], []),
    ).toEqual(['Aspirin', 'Melatonin']);
  });
});

describe('prepareSlmTurn', () => {
  it('returns system + user content without throwing when NLU is unavailable', async () => {
    const prepared = await prepareSlmTurn({
      userText: 'What should I watch for with SpO2 drops?',
      snapshot: null,
      retriever: null,
      forceDeep: true,
      allowDevelopmentNluFallback: true,
      nluTimeoutMs: 500,
      logTag: 'test',
    });

    expect(prepared.systemContext.length).toBeGreaterThan(20);
    expect(prepared.userContent).toContain('SpO2');
    expect(prepared.generation.reasoningFormat).toBe('auto');
    expect(Array.isArray(prepared.citationChunks)).toBe(true);
  });

  it('appends extraSystemContext and can skip NLU with empty tools', async () => {
    const prepared = await prepareSlmTurn({
      userText: 'What exercise is most important?',
      snapshot: null,
      retriever: null,
      forceDeep: true,
      skipNlu: true,
      toolsOverride: [],
      extraSystemContext: 'UC3 THERAPY (record)\nExercises: Sit-to-stand practice',
      logTag: 'test-uc3',
    });

    expect(prepared.systemContext).toContain('UC3 THERAPY (record)');
    expect(prepared.systemContext).toContain('Sit-to-stand practice');
    expect(prepared.nluPacket).toBeNull();
    expect(prepared.userContent).toBe('What exercise is most important?');
  });

  it('injects local data locator (locations only) into main-chat turns', async () => {
    const snapshot = {
      therapyContractPresent: true,
      rehabExerciseAssignments: [],
      rehabPlanMetrics: [],
      rehabDailyEntries: [],
      todayDailyCareEntry: {
        entryId: 'd1',
        patientId: 'p1',
        entryDate: '2026-07-27',
        therapyCompleted: true,
        setsCompleted: 2,
        recommendedSets: 2,
        exerciseRepetitions: 15,
        caregiverConcern: false,
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:00:00.000Z',
      },
      medications: [],
      conditions: [],
      comorbidities: [],
      symptoms: [],
      patient: {
        patientId: 'p1',
        name: 'James',
        preferredName: 'James',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      caregiver: null,
      primaryCondition: null,
      pendingReviewConditions: [],
      wearable: null,
      medicationCandidates: [],
      medicationConfirmationRequirements: {},
      functionalObservations: [],
      thresholds: [],
      carePlan: null,
      carePlans: [],
      latestUc3TrajectoryResult: null,
      latestUc4Run: null,
      latestUc4PriorityCards: [],
      recentUc4CaregiverResponses: [],
      careContextItems: [],
      timelineEvents: [],
      carePlanGoals: [],
      knowledgeStats: { total: 0, bySource: {} },
      enrichmentStats: { total: 0, bySource: {} },
      bundlePending: false,
      bundleStatus: { state: 'complete', chunksAdded: 0 },
      activeAdcpVersion: null,
      pendingPlanProposals: [],
      safetyNotes: '',
      lastRefreshedAt: '2026-07-27T00:00:00.000Z',
    } as never;

    const prepared = await prepareSlmTurn({
      userText: 'Where are my therapy logs?',
      snapshot,
      retriever: null,
      forceDeep: true,
      skipNlu: true,
      toolsOverride: [],
      logTag: 'test-main-locator',
    });

    expect(prepared.systemContext).toContain('LOCAL DATA MAP');
    expect(prepared.systemContext).toContain('daily_care_entries');
    expect(prepared.systemContext).toContain('health_samples');
    expect(prepared.systemContext).not.toContain('reps 15');
  });

  it('does not inject locator when extraSystemContext is already set', async () => {
    const snapshot = {
      therapyContractPresent: true,
      rehabExerciseAssignments: [],
      rehabPlanMetrics: [],
      rehabDailyEntries: [],
      todayDailyCareEntry: null,
      medications: [],
      conditions: [],
      comorbidities: [],
      symptoms: [],
      patient: {
        patientId: 'p1',
        name: 'James',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      caregiver: null,
      primaryCondition: null,
      pendingReviewConditions: [],
      wearable: null,
      medicationCandidates: [],
      medicationConfirmationRequirements: {},
      functionalObservations: [],
      thresholds: [],
      carePlan: null,
      carePlans: [],
      latestUc3TrajectoryResult: null,
      latestUc4Run: null,
      latestUc4PriorityCards: [],
      recentUc4CaregiverResponses: [],
      careContextItems: [],
      timelineEvents: [],
      carePlanGoals: [],
      knowledgeStats: { total: 0, bySource: {} },
      enrichmentStats: { total: 0, bySource: {} },
      bundlePending: false,
      bundleStatus: { state: 'complete', chunksAdded: 0 },
      activeAdcpVersion: null,
      pendingPlanProposals: [],
      safetyNotes: '',
      lastRefreshedAt: '2026-07-27T00:00:00.000Z',
    } as never;

    const prepared = await prepareSlmTurn({
      userText: 'Explain',
      snapshot,
      retriever: null,
      forceDeep: true,
      skipNlu: true,
      toolsOverride: [],
      extraSystemContext: 'Custom in-card only',
      logTag: 'test-no-double',
    });

    expect(prepared.systemContext).toContain('Custom in-card only');
    expect(prepared.systemContext).not.toContain('LOCAL DATA MAP');
  });

  it('does not fetch on-demand med labels without NLU med entities', async () => {
    mockFetchOnDemand.mockClear();
    await prepareSlmTurn({
      userText: 'What exercise is most important?',
      snapshot: null,
      retriever: null,
      forceDeep: true,
      skipNlu: true,
      toolsOverride: [],
      logTag: 'test-on-demand-skip',
    });
    expect(mockFetchOnDemand).not.toHaveBeenCalled();
  });
});


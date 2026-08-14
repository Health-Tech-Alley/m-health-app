import type { PendingPlanProposal } from '@/data/adcp/types';
import type { PatientRecordSnapshot } from '@/data/types';
import {
  buildPlanWatchBlock,
  countPendingPlanReviews,
  detectPlanOpportunities,
} from './planOpportunities';

jest.mock('@/data/repositories/adcpRepository', () => ({
  listPendingProposals: jest.fn(),
}));
jest.mock('@/data/repositories/thresholdRecommendationRepository', () => ({
  getPendingThresholdRecommendations: jest.fn(),
}));

const { listPendingProposals } = jest.requireMock(
  '@/data/repositories/adcpRepository',
) as { listPendingProposals: jest.Mock };
const { getPendingThresholdRecommendations } = jest.requireMock(
  '@/data/repositories/thresholdRecommendationRepository',
) as { getPendingThresholdRecommendations: jest.Mock };

function snapshot(overrides: Partial<PatientRecordSnapshot> = {}): PatientRecordSnapshot {
  return {
    patient: { patientId: 'p1' },
    latestUc3TrajectoryResult: null,
    latestUc4PriorityCards: [],
    pendingPlanProposals: [],
    ...overrides,
  } as unknown as PatientRecordSnapshot;
}

beforeEach(() => {
  jest.clearAllMocks();
  listPendingProposals.mockReturnValue([]);
  getPendingThresholdRecommendations.mockReturnValue([]);
});

describe('detectPlanOpportunities', () => {
  it('returns [] without an active patient', () => {
    expect(detectPlanOpportunities(snapshot({ patient: null }))).toEqual([]);
    expect(detectPlanOpportunities(null)).toEqual([]);
  });

  it('flags a UC3 plateau as a therapy opportunity', () => {
    const s = snapshot({
      latestUc3TrajectoryResult: {
        resultId: 'r1',
        eventType: 'ROM_PLATEAU_TRAJECTORY_FAILURE',
        metricAnalyses: { rom: { plateauDays: 9 } },
      } as unknown as PatientRecordSnapshot['latestUc3TrajectoryResult'],
    });
    const opportunities = detectPlanOpportunities(s);
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].intentId).toBe('propose_therapy_contract_patch');
    expect(opportunities[0].id).toBe('uc3:r1');
  });

  it('skips the therapy opportunity when one is already pending', () => {
    listPendingProposals.mockReturnValue([
      {
        status: 'awaiting_hitl',
        payload: { kind: 'therapy_patch' },
      } as unknown as PendingPlanProposal,
    ]);
    const s = snapshot({
      latestUc3TrajectoryResult: {
        resultId: 'r1',
        eventType: 'ROM_PLATEAU_TRAJECTORY_FAILURE',
        metricAnalyses: { rom: { plateauDays: 9 } },
      } as unknown as PatientRecordSnapshot['latestUc3TrajectoryResult'],
    });
    expect(detectPlanOpportunities(s)).toEqual([]);
  });

  it('flags active UC4 cards (by score) as promote opportunities with cardId args', () => {
    const s = snapshot({
      latestUc4PriorityCards: [
        {
          cardId: 'card-low',
          title: 'Low score card',
          score: 0.4,
          status: 'active',
        },
        {
          cardId: 'card-high',
          title: 'Watch SpO2 overnight',
          score: 0.9,
          status: 'active',
        },
        {
          cardId: 'card-dismissed',
          title: 'Dismissed card',
          score: 1,
          status: 'dismissed',
        },
      ] as unknown as PatientRecordSnapshot['latestUc4PriorityCards'],
    });
    const opportunities = detectPlanOpportunities(s);
    expect(opportunities.map((o) => o.intentId)).toEqual([
      'promote_uc4_to_plan_task',
      'promote_uc4_to_plan_task',
    ]);
    expect(opportunities[0].args).toEqual({ cardId: 'card-high' });
    expect(opportunities[0].id).toBe('uc4:card-high');
  });

  it('flags pending threshold recommendations', () => {
    getPendingThresholdRecommendations.mockReturnValue([{ recommendationId: 't1' }]);
    const s = snapshot();
    const opportunities = detectPlanOpportunities(s);
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].intentId).toBe('review_monitoring_contract');
  });

  it('caps at max opportunities', () => {
    getPendingThresholdRecommendations.mockReturnValue([{ recommendationId: 't1' }]);
    const s = snapshot({
      latestUc4PriorityCards: [
        { cardId: 'c1', title: 'A', score: 0.9, status: 'active' },
        { cardId: 'c2', title: 'B', score: 0.8, status: 'active' },
        { cardId: 'c3', title: 'C', score: 0.7, status: 'active' },
      ] as unknown as PatientRecordSnapshot['latestUc4PriorityCards'],
    });
    expect(detectPlanOpportunities(s)).toHaveLength(3);
    expect(detectPlanOpportunities(s, { max: 2 })).toHaveLength(2);
  });
});

describe('countPendingPlanReviews', () => {
  it('counts draft / awaiting_hitl / awaiting_ml_vet slices', () => {
    const s = snapshot({
      pendingPlanProposals: [
        { status: 'awaiting_hitl' },
        { status: 'awaiting_ml_vet' },
        { status: 'applied' },
      ] as unknown as PatientRecordSnapshot['pendingPlanProposals'],
    });
    expect(countPendingPlanReviews(s)).toBe(2);
  });
});

describe('buildPlanWatchBlock', () => {
  it('returns empty string when nothing to watch', () => {
    expect(buildPlanWatchBlock(snapshot(), [])).toBe('');
  });

  it('includes pending review count, opportunities, and the ACTION format', () => {
    const s = snapshot({
      pendingPlanProposals: [
        { status: 'awaiting_hitl' },
      ] as unknown as PatientRecordSnapshot['pendingPlanProposals'],
    });
    const block = buildPlanWatchBlock(s, [
      {
        id: 'uc4:card-1',
        intentId: 'promote_uc4_to_plan_task',
        args: { cardId: 'card-1' },
        summary: 'The care focus "Watch SpO2" is active.',
        dedupeKey: 'promote:card-1',
      },
    ]);
    expect(block).toContain('PLAN WATCH');
    expect(block).toContain('1 plan proposal(s) are waiting');
    expect(block).toContain('Watch SpO2');
    expect(block).toContain('cardId":"card-1"');
    expect(block).toContain('ACTION: propose_care_plan_update');
    expect(block).toContain('Propose only');
  });
});

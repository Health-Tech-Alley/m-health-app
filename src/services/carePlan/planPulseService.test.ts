import type { AdcpPlanDocument } from '@/data/adcp/types';
import type { PatientRecordSnapshot } from '@/data/types';
import { computePlanPulse, UC4_FRESH_MS } from './planPulseService';

const NOW = Date.parse('2026-07-21T12:00:00.000Z');

function snapshot(overrides: Partial<PatientRecordSnapshot> = {}): PatientRecordSnapshot {
  return {
    carePlanGoals: [],
    thresholds: [],
    latestUc4Run: null,
    latestUc4PriorityCards: [],
    todayDailyCareEntry: null,
    therapyContractPresent: false,
    recentUc4CaregiverResponses: [],
    pendingPlanProposals: [],
    ...overrides,
  } as unknown as PatientRecordSnapshot;
}

function plan(overrides: Partial<AdcpPlanDocument> = {}): AdcpPlanDocument {
  return {
    identity: { planId: 'plan-1', version: 3 },
    carePriorities: { priorities: [] },
    therapyContract: { present: false, reason: 'no_rehab_plan' },
    ...overrides,
  } as unknown as AdcpPlanDocument;
}

describe('computePlanPulse — score', () => {
  it('scores zero when there is no plan and no data', () => {
    const pulse = computePlanPulse(snapshot(), null, 'full', NOW);
    expect(pulse.score).toBe(0);
  });

  it('gives full structural credit for plan, goals, and monitoring', () => {
    const pulse = computePlanPulse(
      snapshot({
        carePlanGoals: [{ goalId: 'g1' } as never],
        thresholds: [{ thresholdId: 't1' } as never],
      }),
      plan(),
      'full',
      NOW,
    );
    // 20 plan + 15 goals + 15 monitoring + redistribution (5/5/5 → +15 with no therapy)
    expect(pulse.score).toBe(25 + 20 + 20);
  });

  it('gives full UC4 credit when the latest run is fresh and half when stale', () => {
    const fresh = computePlanPulse(
      snapshot({
        latestUc4Run: { generatedAt: new Date(NOW - 1000).toISOString(), status: 'completed', paused: false } as never,
      }),
      null,
      'full',
      NOW,
    );
    expect(fresh.score).toBe(15);

    const stale = computePlanPulse(
      snapshot({
        latestUc4Run: { generatedAt: new Date(NOW - UC4_FRESH_MS * 2).toISOString(), status: 'completed', paused: false } as never,
      }),
      null,
      'full',
      NOW,
    );
    expect(stale.score).toBe(8);
  });

  it('counts therapy engagement only when a contract exists and today is logged', () => {
    const withContractNoLog = computePlanPulse(
      snapshot({ therapyContractPresent: true }),
      plan({ therapyContract: { present: true } as never }),
      'full',
      NOW,
    );
    expect(withContractNoLog.score).toBe(20); // plan only; engagement 0, no redistribution

    const withContractLogged = computePlanPulse(
      snapshot({ therapyContractPresent: true, todayDailyCareEntry: { entryId: 'e1' } as never }),
      plan({ therapyContract: { present: true } as never }),
      'full',
      NOW,
    );
    expect(withContractLogged.score).toBe(35);
  });

  it('reaches a high score for a fully engaged non-rehab patient', () => {
    const pulse = computePlanPulse(
      snapshot({
        carePlanGoals: [{ goalId: 'g1' } as never],
        thresholds: [{ thresholdId: 't1' } as never],
        latestUc4Run: { generatedAt: new Date(NOW - 1000).toISOString(), status: 'completed', paused: false } as never,
        latestUc4PriorityCards: [{ cardId: 'c1', status: 'active' } as never],
        recentUc4CaregiverResponses: [{ responseId: 'r1' } as never],
      }),
      plan(),
      'full',
      NOW,
    );
    // 25 plan + 20 goals + 20 monitoring + 15 uc4 + 10 priorities + 10 responses
    expect(pulse.score).toBe(100);
  });
});

describe('computePlanPulse — attention', () => {
  it('is calm when nothing needs the caregiver', () => {
    expect(computePlanPulse(snapshot(), plan(), 'full', NOW).attention).toBe('calm');
  });

  it('is review when proposals are pending', () => {
    const pulse = computePlanPulse(
      snapshot({ pendingPlanProposals: [{ status: 'awaiting_hitl' } as never] }),
      plan(),
      'full',
      NOW,
    );
    expect(pulse.attention).toBe('review');
  });

  it('is review when live UC4 cards are unactioned', () => {
    const pulse = computePlanPulse(
      snapshot({ latestUc4PriorityCards: [{ cardId: 'c1', status: 'active' } as never] }),
      plan(),
      'full',
      NOW,
    );
    expect(pulse.attention).toBe('review');
  });

  it('is review when a therapy contract has no log today', () => {
    const pulse = computePlanPulse(
      snapshot({ therapyContractPresent: true }),
      plan({ therapyContract: { present: true } as never }),
      'full',
      NOW,
    );
    expect(pulse.attention).toBe('review');
  });

  it('is urgent when the latest UC4 run paused for an emergency context', () => {
    const pulse = computePlanPulse(
      snapshot({
        latestUc4Run: { generatedAt: new Date(NOW - 1000).toISOString(), status: 'paused', paused: true } as never,
      }),
      plan(),
      'full',
      NOW,
    );
    expect(pulse.attention).toBe('urgent');
  });
});

describe('computePlanPulse — status word', () => {
  it('is activated when full mode and calm', () => {
    expect(computePlanPulse(snapshot(), plan(), 'full', NOW).statusWord).toBe('activated');
  });

  it('is needs_review when attention is not calm', () => {
    const pulse = computePlanPulse(
      snapshot({ pendingPlanProposals: [{ status: 'draft' } as never] }),
      plan(),
      'full',
      NOW,
    );
    expect(pulse.statusWord).toBe('needs_review');
  });

  it('is view_only in read-only mode regardless of attention', () => {
    const pulse = computePlanPulse(
      snapshot({ pendingPlanProposals: [{ status: 'draft' } as never] }),
      plan(),
      'read_only',
      NOW,
    );
    expect(pulse.statusWord).toBe('view_only');
  });
});

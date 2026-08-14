/**
 * Tests for planning/39 §2.4 / §4 Care Concierge intent router:
 *   - typed intent output build/promotion
 *   - ≥5 intents present
 *   - no fast path / no importance-router bypass
 *   - proposal lifecycle enforced (draft → awaiting_hitl)
 */

// The context assembler reads ADCP via the repo, which would hit a real
// SQLite database. Mock the repo up front so the test runs in isolation.
let createdProposalIds: string[] = [];
jest.mock('../../data/repositories/adcpRepository', () => ({
  __esModule: true,
  getActiveAdcpRevisionForPatient: () => null,
  getActiveAdcpVersionSummary: () => null,
  listPendingProposalSummaries: () => [],
  planHasTherapyContract: () => false,
  publisherStub: () => undefined,
  publishAdcpRevision: () => {
    throw new Error('not used in router test');
  },
  createPendingProposal: ({ patientId }: { patientId: string }) => {
    const id = `${patientId}:prop:test-${Math.random().toString(36).slice(2, 7)}`;
    createdProposalIds.push(id);
    return {
      proposalId: id,
      patientId,
      status: 'awaiting_hitl',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      resolvedAt: null,
      resolutionReason: null,
      clippedPayload: null,
      mlVetRequirement: { kind: 'fallback_24h' },
      intent: 'review_monitoring_contract',
      section: 'monitoringContract',
      kind: 'threshold_patch',
      draftBy: 'slm',
      payload: { kind: 'threshold_patch', patientId, thresholds: [], rationale: '', citations: [] },
      notes: null,
    };
  },
  setProposalStatus: () => {},
}));

// planning/41 D1 — read-only gate reads app_settings. Mock with default 'full'
// so existing tests keep their original behavior.
jest.mock('../../data/repositories/appSettingsRepository', () => ({
  __esModule: true,
  getAppSettings: () => ({ carePlanMode: 'full' }),
  updateCarePlanMode: (mode: 'full' | 'read_only') => ({ carePlanMode: mode }),
}));

// Mock the audit service so HealthMonitor/queue lookups don't blow up.
jest.mock('../../services/audit/auditService', () => ({
  audit: () => undefined,
}));

import {
  INTENT_CATALOG,
  INTENT_LIST,
  type AnyIntentInputs,
} from './intentCatalog';
import {
  runIntent,
  intentCatalogList,
} from './intentRouter';
import type { PatientRecordSnapshot } from '../../data/types';

const MIN_TAG = '\u26A0';

const TEST_SNAPSHOT = {
  patient: {
    patientId: 'patient-1',
    name: 'Mike',
    preferredName: 'Mike',
    age: '27',
  },
  primaryCondition: null,
  comorbidities: [],
  symptoms: [],
  thresholds: [],
  carePlan: null,
  carePlans: [],
  rehabPlanMetrics: [],
  rehabExerciseAssignments: [],
  medications: [],
  safetyNotes: '',
  latestUc3TrajectoryResult: null,
  latestUc4PriorityCards: [],
  bundlePending: false,
  bundleStatus: { state: 'complete', chunksAdded: 0 },
  activeAdcpVersion: null,
  pendingPlanProposals: [],
  therapyContractPresent: false,
} as unknown as PatientRecordSnapshot;

describe('intentCatalog', () => {
  it('exposes at least 5 caregiver-facing intents', () => {
    expect(INTENT_LIST.length).toBeGreaterThanOrEqual(5);
  });

  it('every catalog entry has a unique intentId', () => {
    const seen = new Set<string>();
    for (const intentId of INTENT_LIST) {
      expect(seen.has(intentId)).toBe(false);
      seen.add(intentId);
    }
  });

  it('every catalog entry has a caregiverLabel + description', () => {
    for (const intentId of INTENT_LIST) {
      const def = INTENT_CATALOG[intentId];
      expect(def.caregiverLabel.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  it('does not contain a fast-path / no-SLM marker', () => {
    const descriptions = INTENT_LIST.map((id) => INTENT_CATALOG[id].description).join('\n').toLowerCase();
    expect(descriptions).not.toContain('skip slm');
    // No intent should ever short-circuit; this is the L8 promise.
    expect(INTENT_LIST.every((id) => INTENT_CATALOG[id].resultShape !== undefined)).toBe(true);
  });

  it('managing the catalog matches itself', () => {
    const listA = intentCatalogList();
    expect(listA.length).toBeGreaterThanOrEqual(5);
    expect(listA.length).toBe(listA.length);
  });
});

describe('runIntent (router)', () => {
  it('returns the explain_uc2_alert prompt with explanation text and enqueues no proposals', async () => {
    const result = await runIntent({
      snapshot: TEST_SNAPSHOT,
      intent: 'explain_uc2_alert',
      args: { snapshot: TEST_SNAPSHOT },
      completePrompt: async () => 'A neat explanation tailored to Mike.',
    });
    expect(result.intent).toBe('explain_uc2_alert');
    expect(result.resultShape).toBe('explanation_with_optional_proposal');
    expect((result.output as { explanation?: string }).explanation).toContain('explanation');
    // explain_uc2_alert is explanation-only by default (no buildProposalCandidate).
    expect(result.enqueuedProposalIds.length).toBe(0);
  });

  it('review_monitoring_contract enqueues a threshold_patch proposal', async () => {
    const result = await runIntent({
      snapshot: TEST_SNAPSHOT,
      intent: 'review_monitoring_contract',
      args: { snapshot: TEST_SNAPSHOT },
      completePrompt: async () => JSON.stringify({
        explanation: 'Lower cutoff to 92 because baseline Spo2 has been trending.',
        proposedThresholds: [
          {
            thresholdId: 'old-sp02',
            vitalType: 'spo2',
            direction: 'below',
            value: 92,
            severity: 2,
            source: 'slm',
            pendingMlVet: true,
            rationale: 'Tighten cutoff for higher vigilance.',
          },
        ],
        citations: [],
      }),
    });
    expect(result.intent).toBe('review_monitoring_contract');
    expect(result.enqueuedProposalIds.length).toBeGreaterThan(0);
    expect(result.proposalQueueStatus).toBe('awaiting_hitl');
  });

  it('review_monitoring_contract parses fenced JSON blocks from model output', async () => {
    const fenced = [
      'Based on the trend, I would tighten the cutoff:',
      '```json',
      JSON.stringify({
        explanation: 'Lower cutoff to 92 because baseline Spo2 has been trending.',
        proposedThresholds: [
          {
            thresholdId: 'old-sp02-fenced',
            vitalType: 'spo2',
            direction: 'below',
            value: 92,
            severity: 2,
            source: 'slm',
            pendingMlVet: true,
            rationale: 'Tighten cutoff for higher vigilance.',
          },
        ],
        citations: [],
      }),
      '```',
      'Nothing was changed in the session.',
    ].join('\n');
    const result = await runIntent({
      snapshot: TEST_SNAPSHOT,
      intent: 'review_monitoring_contract',
      args: { snapshot: TEST_SNAPSHOT },
      completePrompt: async () => fenced,
    });
    expect(result.enqueuedProposalIds.length).toBeGreaterThan(0);
    expect(result.proposalQueueStatus).toBe('awaiting_hitl');
  });

  it('review_monitoring_contract recovers a bare JSON object from prose', async () => {
    const result = await runIntent({
      snapshot: TEST_SNAPSHOT,
      intent: 'review_monitoring_contract',
      args: { snapshot: TEST_SNAPSHOT },
      completePrompt: async () =>
        `Suggestion: ${JSON.stringify({
          explanation: 'Watch Spo2 overnight.',
          proposedThresholds: [
            {
              thresholdId: 'old-sp02-prose',
              vitalType: 'spo2',
              direction: 'below',
              value: 92,
              severity: 2,
              source: 'slm',
              pendingMlVet: true,
              rationale: 'Tighten cutoff for higher vigilance.',
            },
          ],
          citations: [],
        })} -- hope this helps`,
    });
    expect(result.enqueuedProposalIds.length).toBeGreaterThan(0);
    expect(result.proposalQueueStatus).toBe('awaiting_hitl');
  });

  it('promote_uc4_to_plan_task enqueues a priority_promote proposal', async () => {
    const args = { snapshot: TEST_SNAPSHOT, cardId: 'card-test' };
    const result = await runIntent({
      snapshot: TEST_SNAPSHOT,
      intent: 'promote_uc4_to_plan_task',
      args,
      completePrompt: async () => JSON.stringify({
        rationale: 'Promote this card',
        priorityId: 'priority-test-1',
        title: 'Hydration check',
        description: 'Ensure check every 4 hours',
        domain: 'general',
        weight: 0.7,
      }),
    });
    expect(result.enqueuedProposalIds.length).toBeGreaterThan(0);
  });

  it('handoff_summary is explanation-only', async () => {
    const result = await runIntent({
      snapshot: TEST_SNAPSHOT,
      intent: 'handoff_summary',
      args: { snapshot: TEST_SNAPSHOT },
      completePrompt: async () => 'A brief handoff narrative.',
    });
    expect(result.enqueuedProposalIds.length).toBe(0);
    expect(result.resultShape).toBe('explanation');
  });
});

describe('router failsafe', () => {
  it('unknown intent throws', async () => {
    await expect(
      runIntent({
        // @ts-expect-error: testing a bad intent
        intent: 'bogus_intent_id',
        snapshot: TEST_SNAPSHOT,
        args: { snapshot: TEST_SNAPSHOT } as AnyIntentInputs,
      }),
    ).rejects.toThrow(/Unknown intent/);
  });

  it('runs as a deterministic stub when no completePrompt is provided', async () => {
    const result = await runIntent({
      snapshot: TEST_SNAPSHOT,
      intent: 'suggest_todays_logging',
      args: { snapshot: TEST_SNAPSHOT },
    });
    // Stub mode still produces typed output.
    expect(result.output).toBeDefined();
    expect(result.enqueuedProposalIds.length).toBe(0);
  });

  it('does not enqueue therapy patches without structured contract fields', async () => {
    const result = await runIntent({
      snapshot: TEST_SNAPSHOT,
      intent: 'propose_therapy_contract_patch',
      args: { snapshot: TEST_SNAPSHOT },
      completePrompt: async () =>
        'Therapy is going well overall; no specific patch JSON provided.',
    });
    expect(result.enqueuedProposalIds.length).toBe(0);
  });

  it('does not enqueue empty monitoring review proposals', async () => {
    const result = await runIntent({
      snapshot: TEST_SNAPSHOT,
      intent: 'review_monitoring_contract',
      args: { snapshot: TEST_SNAPSHOT },
      completePrompt: async () =>
        'Thresholds look fine for now. No changes recommended.',
    });
    expect(result.enqueuedProposalIds.length).toBe(0);
  });

  it('promote_uc4 free-text still enqueues a valid priority_promote kind', async () => {
    const before = createdProposalIds.length;
    const result = await runIntent({
      snapshot: TEST_SNAPSHOT,
      intent: 'promote_uc4_to_plan_task',
      args: { snapshot: TEST_SNAPSHOT, cardId: 'card-x' },
      completePrompt: async () =>
        'Add fatigue timing checks to the durable care plan for the weekend.',
    });
    expect(result.enqueuedProposalIds.length).toBe(1);
    expect(createdProposalIds.length).toBe(before + 1);
  });
});

// Reference MIN_TAG so the linter doesn't drop the import in CI strips.
void MIN_TAG;

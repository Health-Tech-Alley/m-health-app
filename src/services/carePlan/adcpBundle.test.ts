/**
 * Tests for planning/39 §7.5 P5 JSON ADCP Bundle.
 *   - round-trip preserves fields
 *   - integrity hash verifies
 *   - rejects missing/extra `bundleId` / `schemaVersion`
 *   - rejects cross-patient import (P5-D4)
 */

import {
  ADCP_BUNDLE_ID,
  type AdcpPlanDocument,
} from '@/data/adcp/types';
import {
  buildAdcpBundleV1,
  parseAdcpBundleV1,
  sha256HexOf,
  type BuildAdcpBundleDependencies,
} from './adcpBundle';
import type { PatientRecordSnapshot } from '@/data/types';

function makeSnapshot(patientId: string): PatientRecordSnapshot {
  return {
    patient: {
      patientId,
      name: 'Mike',
      preferredName: 'Mike',
      age: '27',
    },
    safetyNotes: '',
    caregiver: null,
    conditions: [],
    comorbidities: [],
    primaryCondition: null,
    pendingReviewConditions: [],
    symptoms: [],
    wearable: null,
    medications: [
      { medicationId: 'med-1', name: 'Albuterol', active: true },
    ],
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
    therapyContractPresent: false,
    lastRefreshedAt: new Date().toISOString(),
  };
}

function makePlan(overrides?: Partial<AdcpPlanDocument>): AdcpPlanDocument {
  return {
    identity: {
      planId: 'patient-1:v1',
      version: 1,
      effectiveAt: '2026-07-19T00:00:00.000Z',
      supersedes: null,
      source: 'seed:onboarding',
      publishedBy: 'system',
    },
    clinicalFraming: { comorbidities: [] },
    safetyEnvelope: { neverDo: [], alwaysDo: [] },
    goals: { goals: [] },
    monitoringContract: { thresholds: [], escalationPolicyRefs: [], vettingWindow: { kind: 'fallback_24h' } },
    therapyContract: { present: false, reason: 'no_rehab_plan' },
    carePriorities: { priorities: [] },
    medicationBindings: { bindings: [] },
    decisionLog: { entries: [] },
    evidenceAnchors: { knowledgeChunkIds: [], knowledgeGraphIds: [], citationsCount: 0 },
    extensions: {},
    ...(overrides ?? {}),
  };
}

describe('sha256HexOf', () => {
  it('produces a stable 64-char hex digest', () => {
    expect(sha256HexOf('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(/^[0-9a-f]{64}$/.test(sha256HexOf('anything'))).toBe(true);
  });
});

describe('buildAdcpBundleV1', () => {
  const deps: BuildAdcpBundleDependencies = { activePlan: makePlan() };

  it('produces the canonical bundle id + schema version', () => {
    const { bundle } = buildAdcpBundleV1(makeSnapshot('patient-1'), {}, deps);
    expect(bundle.bundleId).toBe(ADCP_BUNDLE_ID);
    expect(bundle.schemaVersion).toBe(1);
  });

  it('serializes patient record + plan document + integrity hash', () => {
    const { bundle, sha256 } = buildAdcpBundleV1(makeSnapshot('patient-1'), {}, deps);
    expect(bundle.patient.patientId).toBe('patient-1');
    expect(bundle.patient.displayName).toBe('Mike');
    expect(bundle.activePlan.identity.planId).toBe('patient-1:v1');
    expect(bundle.integrity.payloadSha256).toBe(sha256);
    expect(bundle.medicationJoin?.some((m) => m.name === 'Albuterol')).toBe(true);
  });

  it('emits valid JSON', () => {
    const { json } = buildAdcpBundleV1(makeSnapshot('patient-1'), {}, deps);
    const parsed = JSON.parse(json);
    expect(parsed.bundleId).toBe(ADCP_BUNDLE_ID);
  });

  it('throws if snapshot is missing patient identity', () => {
    const empty: PatientRecordSnapshot = { ...makeSnapshot('patient-1'), patient: null };
    expect(() => buildAdcpBundleV1(empty, {}, deps)).toThrow(/patientId/);
  });

  it('throws if dependencies.activePlan is missing', () => {
    expect(() =>
      buildAdcpBundleV1(makeSnapshot('patient-1'), {}, { activePlan: null as unknown as AdcpPlanDocument }),
    ).toThrow(/activePlan/);
  });

  it('optionally includes pending proposals + decision log', () => {
    const proposal = {
      proposalId: 'p-1',
      patientId: 'patient-1',
      intent: 'review_monitoring_contract',
      section: 'monitoringContract',
      kind: 'threshold_patch',
      status: 'awaiting_hitl',
      summary: 'tweak',
      rationale: 'trend',
      draftedBy: 'slm' as const,
      createdAt: '2026-07-19T00:00:00.000Z',
      updatedAt: '2026-07-19T00:00:00.000Z',
      resolvedAt: null,
    };
    const decision = {
      decisionId: 'd-1',
      patientId: 'patient-1',
      proposalId: null,
      type: 'plan_published',
      actor: 'system' as const,
      createdAt: '2026-07-19T00:00:00.000Z',
      summary: 'plan published',
    };
    const { bundle } = buildAdcpBundleV1(
      makeSnapshot('patient-1'),
      { includePendingProposals: true },
      {
        activePlan: makePlan(),
        pendingProposals: [proposal],
        decisionLogEntries: [decision],
      },
    );
    expect(bundle.pendingProposals?.length).toBe(1);
    expect(bundle.pendingProposals?.[0]?.proposalId).toBe('p-1');
    expect(bundle.decisionLogExtra?.length).toBe(1);
  });
});

describe('parseAdcpBundleV1', () => {
  function roundTrip(): string {
    const deps: BuildAdcpBundleDependencies = { activePlan: makePlan() };
    return buildAdcpBundleV1(makeSnapshot('patient-1'), {}, deps).json;
  }

  it('round-trip preserves integrity', () => {
    const json = roundTrip();
    const result = parseAdcpBundleV1(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.integrityVerified).toBe(true);
      expect(result.integrityMismatch).toBe(false);
      expect(result.bundle.activePlan.identity.planId).toBe('patient-1:v1');
    }
  });

  it('rejects unknown bundleId', () => {
    const json = roundTrip();
    const tampered = JSON.parse(json);
    tampered.bundleId = 'accessdp.careplan.v0';
    const result = parseAdcpBundleV1(tampered, { requirePatientId: 'patient-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(/Unsupported bundleId/.test(result.error)).toBe(true);
  });

  it('rejects unknown schemaVersion', () => {
    const json = roundTrip();
    const tampered = JSON.parse(json);
    tampered.schemaVersion = 99;
    const result = parseAdcpBundleV1(tampered, { requirePatientId: 'patient-1' });
    expect(result.ok).toBe(false);
  });

  it('flags integrity mismatch but still returns bundle with warning', () => {
    const json = roundTrip();
    const tampered = JSON.parse(json);
    tampered.activePlan.identity.title = 'tampered';
    const result = parseAdcpBundleV1(tampered, { requirePatientId: 'patient-1' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.integrityVerified).toBe(false);
      expect(result.integrityMismatch).toBe(true);
    }
  });

  it('rejects cross-patient import (P5-D4)', () => {
    const json = roundTrip();
    const result = parseAdcpBundleV1(json, { requirePatientId: 'OTHER-PATIENT' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(/does not match expected 'OTHER-PATIENT'/.test(result.error)).toBe(true);
    }
  });

  it('rejects root string (non-object)', () => {
    const result = parseAdcpBundleV1('"not-an-object"');
    expect(result.ok).toBe(false);
  });

  it('rejects when activePlan missing', () => {
    const result = parseAdcpBundleV1({ bundleId: ADCP_BUNDLE_ID, schemaVersion: 1, patient: { patientId: 'x' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(/activePlan/.test(result.error)).toBe(true);
  });
});

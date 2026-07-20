/**
 * Tests for planning/39 §7.5 P5 ADCP export + import services + the FHIR
 * Bundle projection (P5b — golden, opt-in via dev flag).
 */

const mockDecisionsLog: Array<{
  decision_id: string;
  patient_id: string;
  proposal_id: string | null;
  type: string;
  actor: string;
  ref_ids_json: string;
  summary: string;
  payload_json: string | null;
  created_at: string;
}> = [];
const mockRevisions: Array<Record<string, unknown>> = [];
const mockProposals: Array<Record<string, unknown>> = [];
const mockAuditEntries: Array<Record<string, unknown>> = [];
const mockConsentTokens: Array<{ scope: string; revoked: boolean }> = [{ scope: 'adcp_backup', revoked: false }];

jest.mock('@/data/db', () => ({
  getDatabase: () => ({
    runSync: () => undefined,
    getFirstSync: () => null,
    getAllSync: () => [],
    execSync: () => undefined,
  }),
  initializeDatabase: () => {},
  closeDatabase: () => {},
  resetDatabase: () => {},
}));

jest.mock('@/data/repositories/adcpRepository', () => {
  return {
    __esModule: true,
    getActiveAdcpRevisionForPatient: (patientId: string) => {
      const candidates = mockRevisions.filter((r) => r.patient_id === patientId);
      return candidates.length > 0 ? candidates[candidates.length - 1] : null;
    },
    listAdcpRevisionsForPatient: (patientId: string) =>
      mockRevisions.filter((r) => r.patient_id === patientId),
    listPendingProposalSummaries: (patientId: string) =>
      mockProposals.filter((p) => p.patient_id === patientId),
    listPlanDecisionLog: (patientId: string, _limit: number) =>
      mockDecisionsLog.filter((d) => d.patient_id === patientId),
    publishAdcpRevision: (input: { patientId: string; identity: { planId?: string; version?: number } } & Record<string, unknown>) => {
      const version = (input.identity.version ?? 0) + 1;
      const planId = input.identity.planId ?? `adcp:${input.patientId}:v${version}`;
      const document = {
        identity: { planId, version, ...input.identity },
        ...input,
      };
      mockRevisions.push({
        patient_id: input.patientId,
        plan_id: planId,
        version,
        source: 'restore',
        // The application layer reads `rev.identity.planId` so we mirror the
        // AdcpPlanDocument shape (not the SQL row).
        identity: document.identity,
        clinicalFraming: input.clinicalFraming,
        safetyEnvelope: input.safetyEnvelope,
        goals: input.goals,
        monitoringContract: input.monitoringContract,
        therapyContract: input.therapyContract,
        carePriorities: input.carePriorities,
        medicationBindings: input.medicationBindings,
        decisionLog: input.decisionLog,
        evidenceAnchors: input.evidenceAnchors,
        extensions: input.extensions,
      });
      return document;
    },
    appendDecisionLog: (input: { decisionId: string; patientId: string; createdAt: string }) => {
      mockDecisionsLog.push({
        decision_id: input.decisionId,
        patient_id: input.patientId,
        proposal_id: null,
        type: 'plan_published',
        actor: 'caregiver',
        ref_ids_json: '[]',
        summary: 'restored',
        payload_json: null,
        created_at: input.createdAt,
      });
    },
  };
});

jest.mock('@/services/audit/auditService', () => ({
  audit: (input: Record<string, unknown>) => {
    mockAuditEntries.push(input);
  },
}));

jest.mock('@/data', () => ({
  hasActiveConsent: (patientId: string, scope: string) => {
    return mockConsentTokens.some((t) => t.scope === scope && !t.revoked);
  },
  insertConsentToken: () => undefined,
  revokeConsent: () => undefined,
  getActiveMedications: () => [
    { medicationId: 'med-1', name: 'Albuterol', active: true },
  ],
  getPatient: (patientId: string) => ({ patientId, name: 'Mike', preferredName: 'Mike', age: '27' }),
}));

jest.mock('@/data/repositories/patientRepository', () => ({
  getActiveMedications: () => [
    { medicationId: 'med-1', name: 'Albuterol', active: true },
  ],
}));

jest.mock('@/services/consent/consentGate', () => ({
  checkEgressConsent: (patientId: string, toolName: string) => {
    if (toolName.includes('ccda')) {
      return { allowed: mockConsentTokens.some((t) => t.scope === 'ccda_export' && !t.revoked) };
    }
    if (toolName.includes('adcp_export') || toolName.includes('adcp_restore')) {
      return { allowed: mockConsentTokens.some((t) => t.scope === 'adcp_backup' && !t.revoked) };
    }
    return { allowed: true };
  },
  grantConsent: (patientId: string, scope: string, _ttlMinutes?: number) => {
    mockConsentTokens.push({ scope, revoked: false });
    return { tokenId: `ct-${Date.now()}`, patientId, scope, granted: true };
  },
}));

import type { PatientRecordSnapshot } from '@/data/types';
import { exportAdcpBundle, buildBundleOnlyJson } from './adcpExportService';
import { importAdcpBundle } from './adcpImportService';

function seededPlanRow(): Record<string, unknown> {
  return {
    patient_id: 'patient-1',
    plan_id: 'patient-1:v1',
    version: 1,
    source: 'seed:onboarding',
    identity: { planId: 'patient-1:v1', version: 1, source: 'seed:onboarding', effectiveAt: '2026-07-19T00:00:00.000Z', publishedBy: 'system' },
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
  };
}

function makeSnapshot(): PatientRecordSnapshot {
  return {
    patient: { patientId: 'patient-1', name: 'Mike', preferredName: 'Mike', age: '27' },
    safetyNotes: '',
    caregiver: null,
    conditions: [],
    comorbidities: [],
    primaryCondition: null,
    pendingReviewConditions: [],
    symptoms: [],
    wearable: null,
    medications: [
      { medicationId: 'med-1', name: 'Albuterol', active: true } as never,
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

describe('adcpExportService', () => {
  beforeEach(() => {
    mockDecisionsLog.length = 0;
    mockRevisions.length = 0;
    mockProposals.length = 0;
    mockAuditEntries.length = 0;
    mockConsentTokens.length = 0;
    mockConsentTokens.push({ scope: 'adcp_backup', revoked: false });
  });

  it('returns ok=false when no active ADCP revision exists', () => {
    const result = buildBundleOnlyJson({ snapshot: makeSnapshot() });
    expect(result.ok).toBe(false);
  });

  it('produces json + filename when active revision exists', () => {
    mockRevisions.push(seededPlanRow());

    const result = buildBundleOnlyJson({ snapshot: makeSnapshot() });
    expect(result.ok).toBe(true);
    expect(result.filename).toMatch(/^adcp-patient-1-v1-/);
    expect(result.json).toContain('accessdp.careplan.v1');
  });

  it('exportAdcpBundle writes audit when consent already granted', () => {
    mockRevisions.push(seededPlanRow());

    const result = exportAdcpBundle({ snapshot: makeSnapshot() });
    expect(result.ok).toBe(true);
    expect(mockAuditEntries.some((e) => e.action === 'export' && e.resourceType === 'adcp_backup')).toBe(true);
  });

  it('exportAdcpBundle denies without consent and writes audit', () => {
    mockConsentTokens.length = 0;
    mockRevisions.push(seededPlanRow());

    const result = exportAdcpBundle({ snapshot: makeSnapshot() });
    expect(result.ok).toBe(false);
    expect(result.consentRequired).toBe(true);
    expect(mockAuditEntries.some((e) => e.action === 'export_denied')).toBe(true);
  });

  it('exportAdcpBundle auto-grants consent when caller opts in', () => {
    mockConsentTokens.length = 0;
    mockRevisions.push(seededPlanRow());

    exportAdcpBundle({ snapshot: makeSnapshot(), autoGrantConsent: true, consentTtlMinutes: 30 });
    expect(mockConsentTokens.some((t) => t.scope === 'adcp_backup')).toBe(true);
    expect(mockAuditEntries.some((e) => e.action === 'export')).toBe(true);
  });
});

describe('adcpImportService', () => {
  beforeEach(() => {
    mockDecisionsLog.length = 0;
    mockRevisions.length = 0;
    mockProposals.length = 0;
    mockAuditEntries.length = 0;
    mockConsentTokens.length = 0;
    mockConsentTokens.push({ scope: 'adcp_backup', revoked: false });
  });

  it('rejects when patient id does not match active patient (P5-D4)', () => {
    mockRevisions.push(seededPlanRow());
    const exported = exportAdcpBundle({ snapshot: makeSnapshot() });
    expect(exported.ok).toBe(true);

    if (exported.json) {
      const result = importAdcpBundle({
        bundle: exported.json,
        activePatientId: 'OTHER-PATIENT',
      });
      expect(result.ok).toBe(false);
    }
  });

  it('imports into matching active patient and bumps version', () => {
    mockRevisions.push(seededPlanRow());
    const exported = exportAdcpBundle({ snapshot: makeSnapshot() });
    expect(exported.json).toBeDefined();
    if (exported.json) {
      const result = importAdcpBundle({ bundle: exported.json, activePatientId: 'patient-1' });
      expect(result.ok).toBe(true);
      expect(result.newPlanVersion).toBe(2);
      expect(mockAuditEntries.some((e) => e.action === 'restore' && e.resourceType === 'adcp_backup')).toBe(true);
    }
  });

  it('rejects tampered bundle by default', () => {
    mockRevisions.push(seededPlanRow());
    const exported = exportAdcpBundle({ snapshot: makeSnapshot() });
    expect(exported.json).toBeDefined();
    if (exported.json) {
      const tampered = JSON.parse(exported.json);
      tampered.activePlan = tampered.activePlan ?? {};
      tampered.activePlan.identity = { ...(tampered.activePlan.identity ?? {}), title: 'tampered' };
      const result = importAdcpBundle({
        bundle: JSON.stringify(tampered),
        activePatientId: 'patient-1',
      });
      expect(result.ok).toBe(false);
      expect(result.integrityMismatch).toBe(true);
    }
  });

  it('imports tampered bundle when importOnHashMismatch is true', () => {
    mockRevisions.push(seededPlanRow());
    const exported = exportAdcpBundle({ snapshot: makeSnapshot() });
    expect(exported.json).toBeDefined();
    if (exported.json) {
      const tampered = JSON.parse(exported.json);
      tampered.activePlan = tampered.activePlan ?? {};
      tampered.activePlan.identity = { ...(tampered.activePlan.identity ?? {}), title: 'tampered' };
      const result = importAdcpBundle({
        bundle: JSON.stringify(tampered),
        activePatientId: 'patient-1',
        importOnHashMismatch: true,
      });
      expect(result.ok).toBe(true);
      expect(result.integrityMismatch).toBe(true);
    }
  });
});

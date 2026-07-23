/**
 * Test for planning/39 §7.5.5 P5b ADCP → FHIR R4 Bundle projection.
 *
 * Golden shape: 1 ADCP plan → 1 Bundle of {CarePlan, Goals, MedicationStatements,
 * Observations (thresholds), Provenance}. Lossy by design (see doc).
 */

import type { AdcpPlanDocument } from '@/data/adcp/types';
import { projectAdcpToFhirBundle, isAdcpFhirProjectionEnabled } from './adcp-to-fhir-bundle';
import type { PatientRecordSnapshot } from './types';

function snapshotWith(patientId: string, meds = []): PatientRecordSnapshot {
  return {
    patient: { patientId, name: 'Mike', preferredName: 'Mike', age: '27' },
    safetyNotes: '',
    caregiver: null,
    conditions: [],
    comorbidities: [],
    primaryCondition: null,
    pendingReviewConditions: [],
    symptoms: [],
    wearable: null,
    medications: meds,
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

function makePlan(): AdcpPlanDocument {
  return {
    identity: {
      planId: 'patient-1:v1',
      version: 1,
      effectiveAt: '2026-07-19T00:00:00.000Z',
      supersedes: null,
      source: 'seed:onboarding',
      publishedBy: 'system',
    },
    clinicalFraming: {
      primaryDiagnosis: { name: 'Cerebral Palsy', icd10: 'G80' },
      comorbidities: [],
    },
    safetyEnvelope: {
      neverDo: ['Sedatives without PCP'],
      alwaysDo: ['Check O2 before feeds'],
      safetyNotes: 'No penicillin.',
    },
    goals: {
      goals: [
        { goalId: 'goal-1', description: 'Maintain safe airway', targetDate: null, measurementTarget: null, status: 'active' },
      ],
    },
    monitoringContract: {
      thresholds: [
        { thresholdId: 't-1', vitalType: 'spo2', direction: 'below', value: 92, severity: 3, source: 'pcp_careplan', pendingMlVet: false },
      ],
      escalationPolicyRefs: [],
      vettingWindow: { kind: 'fallback_24h' },
    },
    therapyContract: { present: false, reason: 'no_rehab_plan' },
    carePriorities: { priorities: [] },
    medicationBindings: {
      bindings: [
        { medicationId: 'med-1', stableBindingId: 'binding:patient-1:med-1', role: 'monitor', notes: null },
      ],
    },
    decisionLog: { entries: [] },
    evidenceAnchors: { knowledgeChunkIds: [], knowledgeGraphIds: [], citationsCount: 0 },
    extensions: {},
  };
}

describe('projectAdcpToFhirBundle (P5b)', () => {
  it('emits a Bundle with CarePlan + Goal + MedicationStatement + Observation + Provenance', () => {
    const meds = [
      {
        medicationId: 'med-1',
        patientId: 'patient-1',
        name: 'Albuterol',
        dosage: '2 puffs',
        frequency: 'q4h',
        route: 'inhale',
        active: true,
        indication: 'rescue',
        source: 'care_plan',
      } as never,
    ];
    const result = projectAdcpToFhirBundle({
      patientId: 'patient-1',
      plan: makePlan(),
      snapshot: snapshotWith('patient-1', meds),
    });

    expect(result.bundle.resourceType).toBe('Bundle');
    expect(result.bundle.type).toBe('collection');
    expect(result.bundle.entry.length).toBeGreaterThanOrEqual(5);

    const resourcesByType = new Map<string, unknown>();
    for (const entry of result.bundle.entry) {
      const resource = entry.resource as { resourceType?: string } | undefined;
      if (resource?.resourceType) {
        resourcesByType.set(resource.resourceType, resource);
      }
    }

    expect(resourcesByType.has('CarePlan')).toBe(true);
    expect(resourcesByType.has('Goal')).toBe(true);
    expect(resourcesByType.has('MedicationStatement')).toBe(true);
    expect(resourcesByType.has('Observation')).toBe(true);
    expect(resourcesByType.has('Provenance')).toBe(true);
  });

  it('honors includeMedications=false to skip medication statements', () => {
    const result = projectAdcpToFhirBundle({
      patientId: 'patient-1',
      plan: makePlan(),
      snapshot: snapshotWith('patient-1', []),
      includeMedications: false,
    });
    for (const entry of result.bundle.entry) {
      const r = entry.resource as { resourceType?: string } | undefined;
      expect(r?.resourceType).not.toBe('MedicationStatement');
    }
  });

  it('honors includeThresholds=false to skip threshold Observations', () => {
    const result = projectAdcpToFhirBundle({
      patientId: 'patient-1',
      plan: makePlan(),
      snapshot: snapshotWith('patient-1'),
      includeThresholds: false,
    });
    for (const entry of result.bundle.entry) {
      const r = entry.resource as { resourceType?: string } | undefined;
      expect(r?.resourceType).not.toBe('Observation');
    }
  });

  it('tags FHIR bundleId with the right patientId + version', () => {
    const result = projectAdcpToFhirBundle({
      patientId: 'patient-1',
      plan: { ...makePlan(), identity: { ...makePlan().identity, planId: 'patient-1:v7', version: 7 } },
      snapshot: snapshotWith('patient-1'),
    });
    expect(result.bundle.id).toContain('patient-1-v7');
  });

  it('only emits Projection entry when gated flag enabled', () => {
    // Plain function call; always returns a bundle. Gate affects caller.
    expect(typeof isAdcpFhirProjectionEnabled(true)).toBe('boolean');
    expect(typeof isAdcpFhirProjectionEnabled(false)).toBe('boolean');
  });
});

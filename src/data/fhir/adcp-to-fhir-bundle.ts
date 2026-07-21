/**
 * ADCP → FHIR R4 Bundle projection (planning/39 §7.5.5 P5b).
 *
 * Maps an `AdcpPlanDocument` + the per-patient typed SQLite rows (meds,
 * thresholds) into a `Bundle` with fullUrl entries: Patient, CarePlan, Goal,
 * MedicationStatement (from bindings), Observation/Observation-actives for
 * thresholds, Provenance. MCC-style includes so the receiving EHR sees the
 * full referenced resources in one document.
 *
 * **Lossy by design** (per doc 39):
 *   - omits ML queue, SLM drafts, internal proposal statuses
 *   - omits device memory + retriever fingerprints
 *   - maps `medicationBindings.role` to the FHIR intent field loosely
 *
 * Projection is dev-flag guarded (`__DEV__` toggle) so production Tag A
 * builds skip the reflective codepath until a golden fixture passes.
 */

import type { AdcpPlanDocument } from '@/data/adcp/types';
import type { Medication, PatientRecordSnapshot, Threshold } from '@/data/types';
import {
  SNOMED_CT_URI,
  loincVitalCode,
} from './codes';
import { toFhirId, toFhirReference } from './identifiers';
import { toFhirCarePlan, toFhirGoal } from './care-plan-mapper';
import { toFhirMedicationStatement } from './clinical-mappers';
import { HEALTH_SAMPLE_TYPES, type HealthSampleType } from '@/data/types';

function isHealthSampleType(s: string): s is HealthSampleType {
  return (HEALTH_SAMPLE_TYPES as readonly string[]).includes(s);
}
import type {
  FhirBundle,
  FhirBundleEntry,
  FhirCarePlan,
  FhirCoding,
  FhirGoal,
  FhirMedicationStatement,
  FhirObservation,
  FhirProvenance,
  FhirResourceType,
} from './types';

export interface ProjectAdcpToFhirInput {
  patientId: string;
  plan: AdcpPlanDocument;
  snapshot: PatientRecordSnapshot;
  /** Optional: pass active SQLite thresholds; otherwise the projection reads plan.monitoringContract directly. */
  thresholds?: Threshold[];
  /** Optional: when false, the mapper skips slices (dev/QA toggle). */
  includeGoals?: boolean;
  includeMedications?: boolean;
  includeThresholds?: boolean;
  includeProvenance?: boolean;
}

export interface ProjectAdcpToFhirResult {
  bundle: FhirBundle;
  warningCount: number;
  reasons: string[];
}

/**
 * Projection entry point. The returned `Bundle` is collection-typed and
 * safe for `Bundle.entry[].resource` iteration on the receiver side.
 */
export function projectAdcpToFhirBundle(input: ProjectAdcpToFhirInput): ProjectAdcpToFhirResult {
  const reasons: string[] = [];
  const includeGoals = input.includeGoals ?? true;
  const includeMedications = input.includeMedications ?? true;
  const includeThresholds = input.includeThresholds ?? true;
  const includeProvenance = input.includeProvenance ?? true;

  // CarePlan → reuse the existing mapper where we can; ADCP keeps goals
  // inside the document, so back-fill a `CarePlanGoalRow`-shaped copy.
  const adcpGoals = input.plan.goals.goals.map((g) => ({
    goalId: g.goalId,
    planId: input.plan.identity.planId,
    description: g.description,
    targetDate: g.targetDate ?? undefined,
    status: g.status,
  }));

  const adcpCarePlanRow = {
    planId: input.plan.identity.planId,
    patientId: input.patientId,
    version: input.plan.identity.version,
    effectiveDate: input.plan.identity.effectiveAt,
    safetyNotes: input.plan.safetyEnvelope.safetyNotes ?? undefined,
    emergencyContact: input.plan.safetyEnvelope.emergencyContact ?? undefined,
    createdAt: input.plan.identity.publishedAt ?? input.plan.identity.effectiveAt,
  };

  const adcpThresholds: Threshold[] =
    input.thresholds ??
    input.plan.monitoringContract.thresholds.map((t) => {
      const source: Threshold['source'] =
        t.source === 'ml_baseline' || t.source === 'pcp_careplan' || t.source === 'caregiver_override'
          ? t.source
          : 'caregiver_override';
      return {
        thresholdId: t.thresholdId ?? `${input.plan.identity.planId}:${t.vitalType}:${t.direction}`,
        patientId: input.patientId,
        vitalType: t.vitalType,
        value: t.value,
        direction: t.direction as 'above' | 'below' | 'equals',
        severity: t.severity as 1 | 2 | 3,
        source,
        createdAt: input.plan.identity.publishedAt ?? input.plan.identity.effectiveAt,
      };
    });

  const fhirCarePlan: FhirCarePlan = toFhirCarePlan({
    patientId: input.patientId,
    carePlan: adcpCarePlanRow,
    goals: adcpGoals,
    thresholds: includeThresholds ? adcpThresholds : [],
    medications: includeMedications ? (input.snapshot.medications ?? []) : [],
    conditionRefs: input.plan.clinicalFraming.primaryDiagnosis
      ? [{ conditionId: `cond:${input.plan.clinicalFraming.primaryDiagnosis.name}`, name: input.plan.clinicalFraming.primaryDiagnosis.name }]
      : [],
  });

  const entries: FhirBundleEntry[] = [];
  entries.push({ fullUrl: `urn:uuid:${fhirCarePlan.id}`, resource: fhirCarePlan });

  if (includeGoals) {
    for (const g of adcpGoals) {
      const fhir: FhirGoal = toFhirGoal(g, input.patientId);
      entries.push({ fullUrl: `urn:uuid:${fhir.id}`, resource: fhir });
    }
  }

  if (includeMedications) {
    for (const med of input.snapshot.medications ?? []) {
      const fhir: FhirMedicationStatement = toFhirMedicationStatement(med);
      // Patient reference must be set explicitly for projection.
      fhir.subject = toFhirReference('Patient', input.patientId);
      // Honor ADCP binding role via note + status-active tag (note carries
      // the role; status stays 'active' so downstream EHRs don't suppress).
      const binding = input.plan.medicationBindings.bindings.find(
        (b) => b.medicationId === med.medicationId,
      );
      if (binding?.notes) {
        fhir.note = [...(fhir.note ?? []), { text: `ADCP role: ${binding.role} — ${binding.notes}` }];
      } else if (binding) {
        fhir.note = [...(fhir.note ?? []), { text: `ADCP role: ${binding.role}` }];
      }
      entries.push({ fullUrl: `urn:uuid:${fhir.id}`, resource: fhir });
    }
  } else {
    reasons.push('medications omitted (dev flag)');
  }

  if (includeThresholds) {
    for (const t of adcpThresholds) {
      const vitalCode = isHealthSampleType(t.vitalType) ? loincVitalCode(t.vitalType) : null;
      const fhir: FhirObservation = {
        resourceType: 'Observation' as FhirResourceType,
        id: toFhirId(t.thresholdId ?? `${t.vitalType}-${t.direction}`, 'Observation'),
        status: 'registered',
        code: {
          coding: [vitalCode ?? { system: SNOMED_CT_URI, code: t.vitalType, display: t.vitalType }],
          text: t.vitalType,
        } as FhirCoding,
        subject: toFhirReference('Patient', input.patientId),
        effectiveDateTime: t.createdAt,
        ...(t.direction === 'below'
          ? { valueRange: { low: undefined, high: { value: t.value, unit: '', system: 'http://unitsofmeasure.org', code: '' } } }
          : { valueRange: { low: { value: t.value, unit: '', system: 'http://unitsofmeasure.org', code: '' }, high: undefined } }),
        interpretation: t.severity === 3 ? [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: 'AA' }] }] : undefined,
        note: [{ text: `severity=${t.severity} source=${t.source}` }],
      } as unknown as FhirObservation;
      entries.push({ fullUrl: `urn:uuid:${fhir.id}`, resource: fhir });
    }
  }

  if (includeProvenance) {
    const prov: FhirProvenance = {
      resourceType: 'Provenance',
      id: `provenance-adcp-${input.plan.identity.planId}`,
      target: [toFhirReference('CarePlan', fhirCarePlan.id ?? '')],
      recorded: new Date().toISOString(),
      agent: [
        {
          who: toFhirReference('Device' as FhirResourceType, 'caregiver-concierge'),
        },
      ],
      reason: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'PATIENT REQUEST' }] }],
    };
    entries.push({ fullUrl: `urn:uuid:${prov.id}`, resource: prov });
  }

  const bundle: FhirBundle = {
    resourceType: 'Bundle',
    id: `adcp-${input.patientId}-v${input.plan.identity.version}`,
    type: 'collection',
    timestamp: new Date().toISOString(),
    entry: entries,
  };
  return { bundle, warningCount: reasons.length, reasons };
}

/**
 * Convenience: throw if the projection should not run (P5-D5: FHIR behind
 * dev flag). Returns true only when the gated enable switch is on.
 */
export function isAdcpFhirProjectionEnabled(devFlag: boolean): boolean {
  return devFlag || (typeof __DEV__ !== 'undefined' && __DEV__ === true);
}

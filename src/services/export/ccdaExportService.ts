/**
 * C-CDA export orchestrator.
 *
 * Reads typed SQLite rows for a patient, maps them to FHIR resources, builds
 * the FHIR Composition that anchors the document, and serializes a C-CDA XML
 * document. Every export is consent-gated (`ccda_export` scope) and the
 * resulting XML is enqueued to the `fhir_resources` table
 * (`kind='export_queue'`) so it can be synced when connectivity resumes.
 */

import {
  getActiveMedications,
  getActiveThresholds,
  getCaregiverForPatient,
  getConditionsForPatient,
  getDatabase,
  getOpenAlerts,
  getPatient,
  getRecentHealthSamples,
  upsertFhirResource,
  type HealthSampleType,
} from '@/data';
import {
  buildCcdDocument,
  buildFhirComposition,
  toFhirCarePlan,
  toFhirCondition,
  toFhirMedicationStatement,
  toFhirObservation,
  toFhirPatient,
  toFhirPractitioner,
  toFhirRelatedPerson,
} from '@/data/fhir';
import type {
  FhirCarePlan,
  FhirComposition,
  FhirCondition,
  FhirMedicationStatement,
  FhirObservation,
  FhirPatient,
  FhirPractitioner,
  FhirRelatedPerson,
} from '@/data/fhir';
import { checkEgressConsent } from '@/services/consent/consentGate';
import { audit } from '@/services/audit/auditService';

const VITAL_TYPES: HealthSampleType[] = [
  'spo2',
  'heart_rate',
  'respiratory_rate',
  'blood_pressure_systolic',
  'blood_pressure_diastolic',
  'temperature',
  'blood_glucose',
  'steps',
  'sleep',
  'coughing',
];

const EXPORT_WINDOW_HOURS = 24;

interface ProviderRow {
  providerId: string;
  patientId: string;
  name: string;
  phone?: string;
  email?: string;
  role?: string;
  createdAt: string;
}

interface CarePlanRow {
  planId: string;
  patientId: string;
  version: number;
  effectiveDate: string;
  safetyNotes?: string;
  emergencyContact?: string;
  createdAt?: string;
}

interface CarePlanGoalRow {
  goalId: string;
  planId: string;
  description: string;
  targetDate?: string;
  status: string;
}

function getProviderForPatient(patientId: string): ProviderRow | null {
  const db = getDatabase();
  return (
    db.getFirstSync<ProviderRow>(
      `SELECT provider_id AS providerId, patient_id AS patientId, name, phone, email, role, created_at AS createdAt
       FROM providers WHERE patient_id = ? ORDER BY created_at DESC LIMIT 1;`,
      patientId,
    ) ?? null
  );
}

function getCarePlanForPatient(patientId: string): CarePlanRow | null {
  const db = getDatabase();
  return (
    db.getFirstSync<CarePlanRow>(
      `SELECT plan_id AS planId, patient_id AS patientId, version, effective_date AS effectiveDate,
              safety_notes AS safetyNotes, emergency_contact AS emergencyContact, created_at AS createdAt
       FROM care_plans WHERE patient_id = ? ORDER BY version DESC LIMIT 1;`,
      patientId,
    ) ?? null
  );
}

function getGoalsForCarePlan(planId: string): CarePlanGoalRow[] {
  const db = getDatabase();
  return db.getAllSync<CarePlanGoalRow>(
    `SELECT goal_id AS goalId, plan_id AS planId, description, target_date AS targetDate, status
     FROM care_plan_goals WHERE plan_id = ? ORDER BY target_date;`,
    planId,
  );
}

export interface BuildCcdResult {
  xml: string;
  composition: FhirComposition;
  carePlan: FhirCarePlan;
}

export function buildCcd(patientId: string): BuildCcdResult {
  const patient = getPatient(patientId);
  if (!patient) {
    throw new Error(`buildCcd: patient ${patientId} not found`);
  }

  const caregiver = getCaregiverForPatient(patientId);
  const providerRow = getProviderForPatient(patientId);
  const conditions = getConditionsForPatient(patientId);
  const medications = getActiveMedications(patientId);
  const thresholds = getActiveThresholds(patientId);
  const carePlanRow = getCarePlanForPatient(patientId);
  const goals = carePlanRow ? getGoalsForCarePlan(carePlanRow.planId) : [];
  const alerts = getOpenAlerts(patientId);

  const since = new Date(Date.now() - EXPORT_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const observations: FhirObservation[] = [];
  for (const type of VITAL_TYPES) {
    const samples = getRecentHealthSamples(patientId, type, since, 10);
    for (const s of samples) {
      observations.push(toFhirObservation(s));
    }
  }

  const fhirPatient: FhirPatient = toFhirPatient(patient);
  const fhirCaregiver: FhirRelatedPerson | undefined = caregiver
    ? toFhirRelatedPerson(caregiver, patientId)
    : undefined;
  const fhirProvider: FhirPractitioner | undefined = providerRow
    ? toFhirPractitioner(providerRow)
    : undefined;
  const fhirConditions: FhirCondition[] = conditions.map(toFhirCondition);
  const fhirMedications: FhirMedicationStatement[] = medications.map(toFhirMedicationStatement);

  const fhirCarePlan = toFhirCarePlan({
    patientId,
    carePlan: carePlanRow
      ? {
          planId: carePlanRow.planId,
          patientId: carePlanRow.patientId,
          version: carePlanRow.version,
          effectiveDate: carePlanRow.effectiveDate,
          safetyNotes: carePlanRow.safetyNotes,
          emergencyContact: carePlanRow.emergencyContact,
          createdAt: carePlanRow.createdAt,
        }
      : undefined,
    goals,
    thresholds,
    medications,
    conditionRefs: conditions.map((c) => ({ conditionId: c.conditionId, name: c.name })),
    contributorRefs: [
      ...(providerRow ? [{ resourceType: 'Practitioner' as const, rowId: providerRow.providerId, display: providerRow.name }] : []),
      ...(caregiver ? [{ resourceType: 'RelatedPerson' as const, rowId: caregiver.caregiverId, display: caregiver.name }] : []),
    ],
  });

  const assessmentNotes = alerts.slice(0, 5).map(
    (a) => `[sev ${a.severity}] ${a.title}: ${a.body}`,
  );

  const composition = buildFhirComposition({
    patient: fhirPatient,
    compositionType: 'ccd',
    author: fhirCaregiver
      ? { reference: `RelatedPerson/${fhirCaregiver.id}`, display: caregiver?.name }
      : { reference: 'Device/caregiver-concierge', display: 'Caregiver Concierge App' },
    conditions: fhirConditions,
    observations,
    medications: fhirMedications,
    carePlan: fhirCarePlan,
    assessmentNotes,
  });

  const xml = buildCcdDocument({
    patient: fhirPatient,
    caregiver: fhirCaregiver,
    provider: fhirProvider,
    conditions: fhirConditions,
    observations,
    medications: fhirMedications,
    carePlan: fhirCarePlan,
    assessmentNotes,
    compositionType: 'ccd',
  });

  return { xml, composition, carePlan: fhirCarePlan };
}

export interface ExportCcdResult {
  xml: string;
  queued: boolean;
  denied?: boolean;
  reason?: string;
}

export function exportCcd(patientId: string): ExportCcdResult {
  const consent = checkEgressConsent(patientId, 'ccda_export');
  if (!consent.allowed) {
    audit({
      actor: 'system',
      action: 'export_denied',
      resourceType: 'ccd_export',
      resourceId: patientId,
      patientId,
      payload: { reason: consent.reason },
    });
    return { xml: '', queued: false, denied: true, reason: consent.reason };
  }

  const { xml, composition } = buildCcd(patientId);
  const now = new Date().toISOString();
  const exportId = `ccd-${patientId}-${now}`;

  upsertFhirResource({
    resourceType: 'Composition',
    resourceId: exportId,
    version: 1,
    kind: 'export_queue',
    payloadJson: JSON.stringify({ composition, xml }),
    lastSyncedAt: now,
    createdAt: now,
  });

  audit({
    actor: 'system',
    action: 'export',
    resourceType: 'ccd_export',
    resourceId: exportId,
    patientId,
    payload: { compositionId: composition.id, bytes: xml.length },
  });

  return { xml, queued: true };
}

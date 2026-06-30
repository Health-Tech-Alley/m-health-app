// src/data/fhir-import.ts

import { getDatabase } from '../db';
import { upsertCarePlan } from '../repositories/carePlanRepository';
import { upsertPatientLongitudinalObservation } from '../repositories/patientLongitudinalObservationRepository';
import { upsertRehabilitationMeasurement } from '../repositories/rehabilitationMeasurementRepository';
import type { LongitudinalObservationType, RehabilitationMeasurementType } from '../types';

type SaveFHIRBundleOptions = {
  patientId?: string;
};

export function saveFHIRBundleToDB(bundle: any, options: SaveFHIRBundleOptions = {}): string | null {
  const db = getDatabase();
  const importedPatientId = getBundlePatientId(bundle, options.patientId);
  if (!importedPatientId) return null;
  const practitionerDisplayByReference = buildPractitionerDisplayMap(bundle);

  db.withTransactionSync(() => {
    for (const entry of bundle.entry ?? []) {
      const resource = entry.resource;
      if (!resource) continue;
      // console.log('[FHIR Import] Processing resource: ', resource.resourceType, ', id: ', resource.id);
      switch (resource.resourceType) {
        case 'Patient':
          upsertPatient(db, resource, importedPatientId);
          break;
        case 'Observation':
          upsertObservation(db, resource, importedPatientId);
          break;
        case 'MedicationRequest':
          upsertMedication(db, resource, importedPatientId);
          break;
        case 'Condition':
          upsertCondition(db, resource, importedPatientId);
          break;
        case 'CarePlan':
          upsertFHIRCarePlan(resource, importedPatientId, practitionerDisplayByReference);
          break;
        // add more resource types as needed
      }
      cacheRawResource(db, resource);
    }
  });

  return importedPatientId;
}

function calculateAge(birthdate: Date): number | null {
    if (Number.isNaN(birthdate.getTime())) return null;
    const today: Date = new Date();
    const diff: number = today.getTime() - birthdate.getTime();
    const ageDate: Date = new Date(diff);
    return Math.abs(ageDate.getUTCFullYear() - 1970);
}

function getBundlePatientId(bundle: any, explicitPatientId?: string): string | null {
  if (explicitPatientId) return explicitPatientId;
  const patientEntry = bundle.entry?.find((entry: any) => entry.resource?.resourceType === 'Patient');
  const patient = patientEntry?.resource;
  return normalizePatientId(patient?.id) ?? normalizePatientReference(patientEntry?.fullUrl) ?? null;
}

function normalizePatientReference(reference?: string): string | null {
  if (!reference) return null;
  if (reference.startsWith('urn:uuid:')) {
    return normalizePatientId(reference.replace('urn:uuid:', ''));
  }
  const patientMatch = reference.match(/^Patient\/(.+)$/);
  return normalizePatientId(patientMatch?.[1]);
}

function normalizePatientId(patientId?: string): string | null {
  const normalized = patientId?.trim();
  return normalized ? normalized : null;
}

function getImportedPatientId(resource: any, fallbackPatientId: string): string {
  return normalizePatientReference(resource.subject?.reference) ?? fallbackPatientId;
}

function buildPractitionerDisplayMap(bundle: any): Map<string, string> {
  const displayByReference = new Map<string, string>();
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (resource?.resourceType !== 'Practitioner' || !resource.id) continue;
    const display = getPractitionerDisplay(resource);
    if (!display) continue;
    displayByReference.set(`Practitioner/${resource.id}`, display);
    if (entry.fullUrl) {
      displayByReference.set(entry.fullUrl, display);
    }
  }
  return displayByReference;
}

function getPractitionerDisplay(resource: any): string | null {
  const name = resource.name?.[0];
  const text = name?.text;
  const fullName = [name?.prefix?.join(' '), name?.given?.join(' '), name?.family]
    .filter(Boolean)
    .join(' ');
  return text ?? fullName ?? null;
}

function upsertPatient(db: any, r: any, activePatientId: string): void {
  const name = r.name?.[0];
  const fullName = [name?.given?.join(' '), name?.family].filter(Boolean).join(' ');
  const now = new Date().toISOString();
  const patientId = getImportedPatientId(r, activePatientId);
  if (!patientId) return;
  const baselineDailyRoutine = getStringExtension(r, 'baseline-daily-routine');
  const currentMedications = getStringExtension(r, 'current-medications');
  const spo2Cutoff = getStringExtension(r, 'spo2-cutoff');
  const baselineHeartRate = getStringExtension(r, 'baseline-heart-rate');
  const gmfcs = getStringExtension(r, 'gmfcs');
  const fms = getStringExtension(r, 'fms');
  const macs = getStringExtension(r, 'macs');
  const cfcs = getStringExtension(r, 'cfcs');
  const edacs = getStringExtension(r, 'edacs');

  // your patients table uses: patient_id, name, age, conditions,
  // baseline_daily_routine, current_medications, spo2_cutoff,
  // baseline_heart_rate, created_at, updated_at
  db.runSync(
    `INSERT INTO patients (
       patient_id, name, age, baseline_daily_routine, current_medications,
       spo2_cutoff, baseline_heart_rate, gmfcs, fms, macs, cfcs, edacs,
       created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(patient_id) DO UPDATE SET
       name = COALESCE(NULLIF(patients.name, ''), NULLIF(excluded.name, ''), patients.name),
       age  = COALESCE(NULLIF(patients.age, ''), excluded.age, patients.age),
       baseline_daily_routine = COALESCE(NULLIF(patients.baseline_daily_routine, ''), NULLIF(excluded.baseline_daily_routine, ''), patients.baseline_daily_routine),
       current_medications = COALESCE(NULLIF(patients.current_medications, ''), NULLIF(excluded.current_medications, ''), patients.current_medications),
       spo2_cutoff = COALESCE(NULLIF(patients.spo2_cutoff, ''), NULLIF(excluded.spo2_cutoff, ''), patients.spo2_cutoff),
       baseline_heart_rate = COALESCE(NULLIF(patients.baseline_heart_rate, ''), NULLIF(excluded.baseline_heart_rate, ''), patients.baseline_heart_rate),
       gmfcs = COALESCE(NULLIF(patients.gmfcs, ''), NULLIF(excluded.gmfcs, ''), patients.gmfcs),
       fms = COALESCE(NULLIF(patients.fms, ''), NULLIF(excluded.fms, ''), patients.fms),
       macs = COALESCE(NULLIF(patients.macs, ''), NULLIF(excluded.macs, ''), patients.macs),
       cfcs = COALESCE(NULLIF(patients.cfcs, ''), NULLIF(excluded.cfcs, ''), patients.cfcs),
       edacs = COALESCE(NULLIF(patients.edacs, ''), NULLIF(excluded.edacs, ''), patients.edacs),
       updated_at = excluded.updated_at;`,
    patientId,
    fullName,
    r.birthDate ? calculateAge(new Date(r.birthDate)) : null,
    baselineDailyRoutine,
    currentMedications,
    spo2Cutoff,
    baselineHeartRate,
    gmfcs,
    fms,
    macs,
    cfcs,
    edacs,
    now,
    now,
  );
}

function getStringExtension(resource: any, suffix: string): string | null {
  const extension = resource.extension?.find((item: any) => item?.url?.endsWith(`/${suffix}`));
  return extension?.valueString ?? null;
}

function upsertObservation(db: any, r: any, activePatientId: string): void {
  // your health_samples table:
  // sample_id, patient_id, source, type, value, value_json, unit, recorded_at, received_at
  // console.log('[FHIR Import] Upserting Observation:', r.id, r.code?.coding?.[0]?.code, r.effectiveDateTime);

  const patientId = getImportedPatientId(r, activePatientId);
  if (!patientId) return;
  const observationCode = getObservationCode(r);
  const loincCode = r.code?.coding?.[0]?.code;
  const date = r.effectiveDateTime ?? new Date().toISOString();
  const now = new Date().toISOString();

  const rehabilitationType = rehabilitationObservationTypeMap[observationCode ?? ''];
  if (rehabilitationType && r.id && typeof r.valueQuantity?.value === 'number') {
    upsertRehabilitationMeasurement(
      {
        measurementId: r.id,
        patientId,
        type: rehabilitationType,
        value: r.valueQuantity.value,
        unit: r.valueQuantity.unit ?? r.valueQuantity.code ?? '',
        recordedAt: date,
        source: 'fhir',
        createdAt: now,
      },
      db,
    );
    return;
  }

  const longitudinalType = longitudinalObservationTypeMap[observationCode ?? ''];
  if (longitudinalType && r.id) {
    const coding = getObservationCoding(r, observationCode);
    const numericValue =
      typeof r.valueQuantity?.value === 'number' ? r.valueQuantity.value : undefined;
    const textValue =
      typeof r.valueString === 'string' ? r.valueString : undefined;

    upsertPatientLongitudinalObservation(
      {
        patientId,
        observationId: r.id,
        measurementType: longitudinalType,
        recordedAt: date,
        encounterId: getReferenceId(r.encounter?.reference),
        numericValue,
        textValue,
        unit: r.valueQuantity?.unit ?? r.valueQuantity?.code ?? undefined,
        sourceSystem: coding?.system,
        sourceCode: coding?.code ?? observationCode,
        sourceType: 'fhir',
      },
      db,
    );
    return;
  }

  // Blood pressure — two components, store as value_json
  if (loincCode === '85354-9') {
    const systolic = r.component?.find(
      (c: any) => c.code?.coding?.[0]?.code === '8480-6'
    )?.valueQuantity?.value;
    const diastolic = r.component?.find(
      (c: any) => c.code?.coding?.[0]?.code === '8462-4'
    )?.valueQuantity?.value;

    db.runSync(
      `INSERT OR REPLACE INTO health_samples
         (sample_id, patient_id, source, type, value, unit, recorded_at, received_at)
       VALUES (?, ?, 'fhir', 'blood_pressure_systolic', ?, 'mmHg', ?, ?);`,
      `${r.id}-systolic`,
      patientId,
      systolic ?? null,
      date,
      now,
    );
    db.runSync(
      `INSERT OR REPLACE INTO health_samples
         (sample_id, patient_id, source, type, value, unit, recorded_at, received_at)
       VALUES (?, ?, 'fhir', 'blood_pressure_diastolic', ?, 'mmHg', ?, ?);`,
      `${r.id}-diastolic`,
      patientId,
      diastolic ?? null,
      date,
      now,
    );
    return;
  }

  const separateBloodPressureTypeMap: Record<string, string> = {
    '8480-6': 'blood_pressure_systolic',
    '8462-4': 'blood_pressure_diastolic',
  };

  const separateBloodPressureType = separateBloodPressureTypeMap[loincCode];
  if (separateBloodPressureType) {
    db.runSync(
      `INSERT OR REPLACE INTO health_samples
         (sample_id, patient_id, source, type, value, unit, recorded_at, received_at)
       VALUES (?, ?, 'fhir', ?, ?, ?, ?, ?);`,
      r.id,
      patientId,
      separateBloodPressureType,
      r.valueQuantity?.value ?? null,
      r.valueQuantity?.unit ?? '',
      date,
      now,
    );
    return;
  }

  // Single-value vitals
  const typeMap: Record<string, string> = {
    '8867-4':  'heart_rate',
    '8310-5':  'temperature',
    '59408-5': 'spo2',
    '2708-6':  'spo2',
    '9279-1':  'respiratory_rate',
    '29463-7': 'weight',
  };

  const type = typeMap[loincCode];
  if (!type) return;

  db.runSync(
    `INSERT OR REPLACE INTO health_samples
       (sample_id, patient_id, source, type, value, unit, recorded_at, received_at)
     VALUES (?, ?, 'fhir', ?, ?, ?, ?, ?);`,
    r.id,
    patientId,
    type,
    r.valueQuantity?.value ?? null,
    r.valueQuantity?.unit ?? '',
    date,
    now,
  );
}

function upsertMedication(db: any, r: any, activePatientId: string): void {
  // your medications table:
  // medication_id, patient_id, name, dosage, frequency, route, indication, active, source
  const patientId = getImportedPatientId(r, activePatientId);
  if (!patientId) return;

  db.runSync(
    `INSERT OR REPLACE INTO medications
       (medication_id, patient_id, name, dosage, frequency, route, indication, active, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'fhir');`,
    r.id,
    patientId,
    r.medicationCodeableConcept?.text ?? r.medicationReference?.display ?? '',
    r.dosageInstruction?.[0]?.doseAndRate?.[0]?.doseQuantity?.value?.toString() ??
      r.dosageInstruction?.[0]?.text ??
      null,
    r.dosageInstruction?.[0]?.timing?.code?.text ?? null,
    r.dosageInstruction?.[0]?.route?.text ?? null,
    r.reasonCode?.[0]?.text ?? null,
  );
}

function upsertCondition(db: any, r: any, activePatientId: string): void {
  // your patient_conditions table:
  // condition_id, patient_id, name, icd10, onset_date,
  // category, is_primary, source, needs_review
  const patientId = getImportedPatientId(r, activePatientId);
  if (!patientId) return;

  db.runSync(
    `INSERT OR REPLACE INTO patient_conditions
       (condition_id, patient_id, name, icd10, onset_date, source, needs_review)
     VALUES (?, ?, ?, ?, ?, 'fhir_import', 1);`,
    r.id,
    patientId,
    r.code?.text ?? r.code?.coding?.[0]?.display ?? '',
    r.code?.coding?.[0]?.code ?? null,
    r.onsetDateTime ?? null,
  );
}

const rehabilitationObservationTypeMap: Record<string, RehabilitationMeasurementType> = {
  'james-gait-speed': 'rehabilitation_gait_speed',
  'james-shoulder-rom': 'rehabilitation_shoulder_rom',
  'james-grip-strength': 'rehabilitation_grip_strength',
  'james-berg-balance': 'rehabilitation_berg_balance',
  'james-fatigue': 'rehabilitation_fatigue',
};

const longitudinalObservationTypeMap: Record<string, LongitudinalObservationType> = {
  'sofia-vomiting-episodes': 'vomiting_episodes',
  'sofia-urinary-symptom-score': 'urinary_symptom_score',
  'sofia-bowel-regimen-score': 'bowel_regimen_score',
  'sofia-mobility-score': 'mobility_score',
  'sofia-sleep-quality': 'sleep_quality',
  'sofia-pain-score': 'pain_score',
  'sofia-hydration-status': 'hydration_status',
};

function getObservationCode(resource: any): string | null {
  const coding = resource.code?.coding;
  if (!Array.isArray(coding)) return resource.code?.text ?? null;
  const rehabilitationCode = coding.find((item: any) => rehabilitationObservationTypeMap[item?.code]);
  const longitudinalCode = coding.find((item: any) => longitudinalObservationTypeMap[item?.code]);
  return rehabilitationCode?.code ?? longitudinalCode?.code ?? coding[0]?.code ?? resource.code?.text ?? null;
}

function getObservationCoding(resource: any, code?: string | null): any | null {
  const coding = resource.code?.coding;
  if (!Array.isArray(coding)) return null;
  return coding.find((item: any) => item?.code === code) ?? coding[0] ?? null;
}

function getReferenceId(reference?: string): string | undefined {
  if (!reference) return undefined;
  return reference.split('/').pop() || reference;
}

function upsertFHIRCarePlan(
  r: any,
  activePatientId: string,
  practitionerDisplayByReference: Map<string, string>,
): void {
  const patientId = getImportedPatientId(r, activePatientId);
  if (!patientId || !r.id) return;

  const now = new Date().toISOString();
  const careTeamDisplay = (r.careTeam ?? [])
    .map((reference: any) => resolveReferenceDisplay(reference, practitionerDisplayByReference))
    .filter((display: string | null): display is string => Boolean(display));

  upsertCarePlan({
    planId: r.id,
    patientId,
    version: 1,
    effectiveDate: r.period?.start ?? now,
    status: r.status ?? null,
    intent: r.intent ?? null,
    title: r.title ?? null,
    description: r.description ?? null,
    periodStart: r.period?.start ?? null,
    periodEnd: r.period?.end ?? null,
    careTeamDisplayJson: JSON.stringify(careTeamDisplay),
    safetyNotes: undefined,
    emergencyContact: undefined,
    createdAt: now,
    activities: (r.activity ?? []).map((activity: any, index: number) => ({
      activityId: `${r.id}-activity-${index + 1}`,
      planId: r.id,
      status: activity.detail?.status ?? null,
      description: activity.detail?.description ?? activity.detail?.code?.text ?? null,
      sequence: index,
    })),
  });
}

function resolveReferenceDisplay(
  reference: any,
  practitionerDisplayByReference: Map<string, string>,
): string | null {
  if (!reference) return null;
  if (reference.display) return reference.display;
  if (reference.reference) {
    return practitionerDisplayByReference.get(reference.reference) ?? reference.reference;
  }
  return null;
}


function cacheRawResource(db: any, r: any): void {
  // fhir_resources table:
  // resource_type, resource_id, version, kind, payload_json, last_synced_at, created_at
  const now = new Date().toISOString();

  db.runSync(
    `INSERT INTO fhir_resources
       (resource_type, resource_id, version, kind, payload_json, last_synced_at, created_at)
     VALUES (?, ?, 1, 'imported', ?, ?, ?)
     ON CONFLICT(resource_type, resource_id, version) DO UPDATE SET
       payload_json   = excluded.payload_json,
       last_synced_at = excluded.last_synced_at;`,
    r.resourceType,
    r.id,
    JSON.stringify(r),
    now,
    now,
  );
}

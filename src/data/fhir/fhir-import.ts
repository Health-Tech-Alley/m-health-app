// src/data/fhir-import.ts

import { getDatabase } from '../db';

type SaveFHIRBundleOptions = {
  patientId?: string;
};

export function saveFHIRBundleToDB(bundle: any, options: SaveFHIRBundleOptions = {}): void {
  const db = getDatabase();
  const activePatientId =
    options.patientId ??
    bundle.entry?.find((entry: any) => entry.resource?.resourceType === 'Patient')?.resource?.id;

  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (!resource) continue;
    // console.log('[FHIR Import] Processing resource: ', resource.resourceType, ', id: ', resource.id);
    switch (resource.resourceType) {
      case 'Patient':
        upsertPatient(db, resource, activePatientId);
        break;
      case 'Observation':
        upsertObservation(db, resource, activePatientId);
        break;
      case 'MedicationRequest':
        upsertMedication(db, resource, activePatientId);
        break;
      case 'Condition':
        upsertCondition(db, resource, activePatientId);
        break;
      // add more resource types as needed
    }
    cacheRawResource(db, resource);
  }
  const patients = db.getAllSync('SELECT * FROM patients;');
  console.log('[FHIR Import] Patients in DB:', JSON.stringify(patients, null, 2));
  //   const caregivers = db.getAllSync('SELECT * FROM caregivers;');
  //   console.log('[FHIR Import] Caregivers in DB:', JSON.stringify(caregivers, null, 2));
//   const healthSamples = db.getAllSync('SELECT * FROM health_samples;');
//   console.log(`[FHIR Import] ${healthSamples.length} Health Samples in DB:`, JSON.stringify(healthSamples, null, 2));
}

function calculateAge(birthdate: Date): number | null {
    if (Number.isNaN(birthdate.getTime())) return null;
    const today: Date = new Date();
    const diff: number = today.getTime() - birthdate.getTime();
    const ageDate: Date = new Date(diff);
    return Math.abs(ageDate.getUTCFullYear() - 1970);
}

function getImportedPatientId(resource: any, fallbackPatientId?: string): string {
  return fallbackPatientId || resource.subject?.reference?.replace('urn:uuid:', '') || resource.id || '';
}

function upsertPatient(db: any, r: any, activePatientId?: string): void {
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

function upsertObservation(db: any, r: any, activePatientId?: string): void {
  // your health_samples table:
  // sample_id, patient_id, source, type, value, value_json, unit, recorded_at, received_at
  // console.log('[FHIR Import] Upserting Observation:', r.id, r.code?.coding?.[0]?.code, r.effectiveDateTime);

  const patientId = getImportedPatientId(r, activePatientId);
  if (!patientId) return;
  const loincCode = r.code?.coding?.[0]?.code;
  const date = r.effectiveDateTime ?? new Date().toISOString();
  const now = new Date().toISOString();

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

  // Single-value vitals
  const typeMap: Record<string, string> = {
    '8867-4':  'heart_rate',
    '8310-5':  'temperature',
    '59408-5': 'spo2',
    '9279-1':  'respiratory_rate',
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

function upsertMedication(db: any, r: any, activePatientId?: string): void {
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
    r.dosageInstruction?.[0]?.doseAndRate?.[0]?.doseQuantity?.value?.toString() ?? null,
    r.dosageInstruction?.[0]?.timing?.code?.text ?? null,
    r.dosageInstruction?.[0]?.route?.text ?? null,
    r.reasonCode?.[0]?.text ?? null,
  );
}

function upsertCondition(db: any, r: any, activePatientId?: string): void {
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

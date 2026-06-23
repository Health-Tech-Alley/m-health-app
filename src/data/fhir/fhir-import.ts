// src/data/fhir-import.ts

import { getDatabase } from '../db';

export function saveFHIRBundleToDB(bundle: any): void {
  const db = getDatabase();

  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (!resource) continue;
    // console.log('[FHIR Import] Processing resource: ', resource.resourceType, ', id: ', resource.id);
    switch (resource.resourceType) {
      case 'Patient':
        upsertPatient(db, resource);
        break;
      case 'Observation':
        upsertObservation(db, resource);
        break;
      case 'MedicationRequest':
        upsertMedication(db, resource);
        break;
      case 'Condition':
        upsertCondition(db, resource);
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

function calculateAge(birthdate: Date): number {
    const today: Date = new Date();
    const diff: number = today.getTime() - birthdate.getTime();
    const ageDate: Date = new Date(diff);
    return Math.abs(ageDate.getUTCFullYear() - 1970);
}

function upsertPatient(db: any, r: any): void {
  const name = r.name?.[0];
  const fullName = [name?.given?.join(' '), name?.family].filter(Boolean).join(' ');
  const now = new Date().toISOString();

  // your patients table uses: patient_id, name, age, conditions,
  // baseline_daily_routine, current_medications, spo2_cutoff,
  // baseline_heart_rate, created_at, updated_at
  db.runSync(
    `INSERT INTO patients (patient_id, name, age, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(patient_id) DO UPDATE SET
       name = excluded.name,
       age  = excluded.age,
       updated_at = excluded.updated_at;`,
    r.id,
    fullName,
    calculateAge(new Date(r.birthDate)),
    now,
    now,
  );
}

function upsertObservation(db: any, r: any): void {
  // your health_samples table:
  // sample_id, patient_id, source, type, value, value_json, unit, recorded_at, received_at
  // console.log('[FHIR Import] Upserting Observation:', r.id, r.code?.coding?.[0]?.code, r.effectiveDateTime);

  const patientId = r.subject?.reference?.replace('urn:uuid:', '') ?? '';
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
         (sample_id, patient_id, source, type, value_json, unit, recorded_at, received_at)
       VALUES (?, ?, 'fhir', 'blood_pressure', ?, 'mmHg', ?, ?);`,
      r.id,
      patientId,
      JSON.stringify({ systolic, diastolic }),
      date,
      now,
    );
    return;
  }

  // Single-value vitals
  const typeMap: Record<string, string> = {
    '8867-4':  'heart_rate',
    '8310-5':  'body_temperature',
    '59408-5': 'oxygen_saturation',
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

function upsertMedication(db: any, r: any): void {
  // your medications table:
  // medication_id, patient_id, name, dosage, frequency, route, indication, active, source
  const patientId = r.subject?.reference?.replace('urn:uuid:', '') ?? '';

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

function upsertCondition(db: any, r: any): void {
  // your patient_conditions table:
  // condition_id, patient_id, name, icd10, onset_date,
  // category, is_primary, source, needs_review
  const patientId = r.subject?.reference?.replace('urn:uuid:', '') ?? '';

  db.runSync(
    `INSERT OR REPLACE INTO patient_conditions
       (condition_id, patient_id, name, icd10, onset_date, source, needs_review)
     VALUES (?, ?, ?, ?, ?, 'fhir', 1);`,
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
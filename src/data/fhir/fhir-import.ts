// src/data/fhir-import.ts

import { getDatabase } from '../db';
import { upsertCarePlan } from '../repositories/carePlanRepository';
import { replaceCarePlanRehabMetrics } from '../repositories/carePlanRehabMetricRepository';
import { upsertPatientCareContextItem } from '../repositories/patientCareContextRepository';
import { upsertPatientLongitudinalObservation } from '../repositories/patientLongitudinalObservationRepository';
import { upsertPatientTimelineEvent } from '../repositories/patientTimelineEventRepository';
import { upsertRehabilitationMeasurement } from '../repositories/rehabilitationMeasurementRepository';
import type {
  CarePlanRehabMetric,
  CarePlanRehabMetricKey,
  LongitudinalObservationType,
  PatientConditionRole,
  PatientConditionSourceReference,
  PatientTimelineEventType,
  RehabilitationMeasurementType,
} from '../types';
import { assertFhirBundleReferenceIntegrity } from './reference-validator';

type ResourceReferenceTarget = {
  resourceType: string;
  id: string;
  fullUrl?: string;
};

type ObservationEffectiveTimeResolution =
  | {
      recordedAt: string;
      reason: 'EFFECTIVE_DATETIME' | 'EFFECTIVE_PERIOD_START' | 'EFFECTIVE_PERIOD_END';
    }
  | {
      recordedAt: null;
      reason: 'MISSING_EFFECTIVE_TIME';
    };

export const REHAB_PLAN_METRIC_CODE_SYSTEM =
  'https://access-dp.local/fhir/CodeSystem/rehab-plan-metric';

const rehabPlanMetricDefinitions: Record<CarePlanRehabMetricKey, { displayName: string }> = {
  romDegrees: { displayName: 'Range of motion' },
  exerciseReps: { displayName: 'Exercise repetitions' },
  adherence: { displayName: 'Exercise participation' },
  painScore: { displayName: 'Pain' },
  fatigueScore: { displayName: 'Fatigue' },
  walkingMinutes: { displayName: 'Walking time' },
};

export function saveFHIRBundleToDB(bundle: any): string | null {
  assertFhirBundleReferenceIntegrity(bundle);

  const canonicalPatientId = getBundlePatientId(bundle);
  if (!canonicalPatientId) return null;
  const db = getDatabase();
  const resourceReferenceMap = buildResourceReferenceMap(bundle);
  const patientReferenceMap = buildPatientReferenceMap(bundle, canonicalPatientId);
  const practitionerDisplayByReference = buildPractitionerDisplayMap(bundle);
  const provenanceIdByConditionId = buildConditionProvenanceMap(bundle, resourceReferenceMap);
  const latestDaysFromFirstVisit = getLatestDaysFromFirstVisit(bundle);
  const rehabPlanResourceIndex = buildRehabPlanResourceIndex(bundle);

  db.withTransactionSync(() => {
    for (const entry of bundle.entry ?? []) {
      const resource = entry.resource;
      if (!resource) continue;
      cacheRawResource(db, resource, entry.fullUrl);
      if (!hasResourceId(resource)) {
        reportRawOnlyObservationTimeIssue(resource);
        continue;
      }

      // console.log('[FHIR Import] Processing resource: ', resource.resourceType, ', id: ', resource.id);
      switch (resource.resourceType) {
        case 'Patient':
          upsertPatient(db, resource, canonicalPatientId);
          break;
        case 'Observation':
          upsertObservation(
            db,
            resource,
            canonicalPatientId,
            patientReferenceMap,
            resourceReferenceMap,
          );
          break;
        case 'MedicationRequest':
          upsertMedication(db, resource, canonicalPatientId, patientReferenceMap);
          break;
        case 'Condition':
          upsertCondition(
            db,
            resource,
            canonicalPatientId,
            patientReferenceMap,
            provenanceIdByConditionId.get(resource.id),
            latestDaysFromFirstVisit,
          );
          break;
        case 'CarePlan':
          upsertFHIRCarePlan(
            resource,
            canonicalPatientId,
            patientReferenceMap,
            practitionerDisplayByReference,
            rehabPlanResourceIndex,
            resourceReferenceMap,
          );
          break;
        case 'Basic':
          upsertPatientTimelineEventFromBasic(resource, canonicalPatientId, patientReferenceMap);
          upsertPatientCareContextItemFromBasic(resource, canonicalPatientId, patientReferenceMap);
          break;
        // add more resource types as needed
      }
    }
  });

  return canonicalPatientId;
}

const FULL_BIRTH_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function calculateAgeFromBirthDate(birthDate: unknown): number | null {
  if (typeof birthDate !== 'string' || birthDate.length === 0 || birthDate !== birthDate.trim()) {
    return null;
  }

  const match = birthDate.match(FULL_BIRTH_DATE_PATTERN);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isInteger(year) || year < 1) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth) return null;

  const today = new Date();
  let age = today.getFullYear() - year;
  const currentMonth = today.getMonth() + 1;
  const currentDay = today.getDate();
  if (currentMonth < month || (currentMonth === month && currentDay < day)) {
    age -= 1;
  }

  return age < 0 ? null : age;
}

function getBundlePatientId(bundle: any): string | null {
  const patientEntry = bundle.entry?.find((entry: any) => entry.resource?.resourceType === 'Patient');
  const patient = patientEntry?.resource;
  return normalizePatientId(patient?.id);
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

function buildResourceReferenceMap(bundle: any): Map<string, ResourceReferenceTarget> {
  const referenceMap = new Map<string, ResourceReferenceTarget>();

  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (!resource?.resourceType || !resource.id) continue;

    const target: ResourceReferenceTarget = {
      resourceType: resource.resourceType,
      id: resource.id,
      fullUrl: typeof entry.fullUrl === 'string' ? entry.fullUrl : undefined,
    };

    referenceMap.set(`${resource.resourceType}/${resource.id}`, target);
    referenceMap.set(`urn:uuid:${resource.id}`, target);
    if (target.fullUrl) {
      referenceMap.set(target.fullUrl, target);
    }
  }

  return referenceMap;
}

function buildPatientReferenceMap(bundle: any, canonicalPatientId: string): Map<string, string> {
  const referenceMap = new Map<string, string>();
  const addReference = (value?: string | null) => {
    const normalized = normalizePatientId(value ?? undefined);
    if (normalized) referenceMap.set(normalized, canonicalPatientId);
  };

  addReference(canonicalPatientId);
  addReference(`Patient/${canonicalPatientId}`);

  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (resource?.resourceType !== 'Patient') continue;

    addReference(resource.id);
    addReference(`Patient/${resource.id}`);
    addReference(entry.fullUrl);

    if (typeof entry.fullUrl === 'string' && entry.fullUrl.startsWith('urn:uuid:')) {
      const urnId = entry.fullUrl.replace('urn:uuid:', '');
      addReference(urnId);
      addReference(`Patient/${urnId}`);
    }
  }

  return referenceMap;
}

function resolvePatientReference(
  reference: string | undefined,
  referenceMap?: Map<string, string>,
): string | null {
  if (!reference) return null;
  const directMatch = referenceMap?.get(reference);
  if (directMatch) return directMatch;

  const normalizedReference = normalizePatientReference(reference);
  if (!normalizedReference) return null;

  return (
    referenceMap?.get(normalizedReference) ??
    referenceMap?.get(`Patient/${normalizedReference}`) ??
    normalizedReference
  );
}

function getImportedPatientId(
  resource: any,
  fallbackPatientId: string,
  referenceMap?: Map<string, string>,
): string | null {
  const patientReferences = [
    resource.subject?.reference,
    resource.patient?.reference,
    resource.beneficiary?.reference,
  ].filter(
    (reference): reference is string =>
      typeof reference === 'string' && reference.trim().length > 0,
  );

  for (const reference of patientReferences) {
    const resolved = resolvePatientReference(reference, referenceMap);
    if (!resolved) return null;
    return resolved;
  }

  return resource.resourceType === 'Patient' ? fallbackPatientId : null;
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

type RehabPlanResourceIndex = {
  goalsByReference: Map<string, any>;
  baselineObservations: any[];
};

function buildRehabPlanResourceIndex(bundle: any): RehabPlanResourceIndex {
  const goalsByReference = new Map<string, any>();
  const baselineObservations: any[] = [];

  const addResourceReference = (resourceType: string, resource: any, fullUrl?: string) => {
    if (!resource?.id) return;
    goalsByReference.set(resource.id, resource);
    goalsByReference.set(`${resourceType}/${resource.id}`, resource);
    if (fullUrl) {
      goalsByReference.set(fullUrl, resource);
    }
  };

  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (resource?.resourceType === 'Goal') {
      addResourceReference('Goal', resource, entry.fullUrl);
    } else if (
      resource?.resourceType === 'Observation' &&
      getRehabPlanMetricKey(resource.code) &&
      typeof resource.valueQuantity?.value === 'number'
    ) {
      baselineObservations.push(resource);
    }
  }

  return { goalsByReference, baselineObservations };
}

function buildConditionProvenanceMap(
  bundle: any,
  resourceReferenceMap: Map<string, ResourceReferenceTarget>,
): Map<string, string> {
  const provenanceByConditionId = new Map<string, string>();
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (resource?.resourceType !== 'Provenance' || !resource.id) continue;
    for (const target of resource.target ?? []) {
      const conditionId = getReferenceId(target?.reference, resourceReferenceMap);
      if (conditionId) {
        provenanceByConditionId.set(conditionId, resource.id);
      }
    }
  }
  return provenanceByConditionId;
}

function getLatestDaysFromFirstVisit(bundle: any): number | undefined {
  let latest: number | undefined;
  for (const entry of bundle.entry ?? []) {
    for (const value of getDaysFromFirstVisitValues(entry.resource)) {
      latest = Math.max(latest ?? value, value);
    }
  }
  return latest;
}

function getDaysFromFirstVisitValues(resource: any): number[] {
  const values: number[] = [];
  for (const extension of resource?.extension ?? []) {
    const nested = extension?.extension;
    if (Array.isArray(nested)) {
      for (const item of nested) {
        if (
          isExtensionSuffix(item, 'days_from_first_visit') &&
          typeof item.valueInteger === 'number'
        ) {
          values.push(item.valueInteger);
        }
      }
    }

    if (
      isExtensionSuffix(extension, 'days-from-first-visit') &&
      typeof extension.valueInteger === 'number'
    ) {
      values.push(extension.valueInteger);
    }
  }
  return values;
}

function getPractitionerDisplay(resource: any): string | null {
  const name = resource.name?.[0];
  const text = name?.text;
  const fullName = [name?.prefix?.join(' '), name?.given?.join(' '), name?.family]
    .filter(Boolean)
    .join(' ');
  return text ?? fullName ?? null;
}

function getHumanNameDisplay(name: any): string {
  const text = typeof name?.text === 'string' ? name.text.trim() : '';
  if (text) return text;

  return [
    Array.isArray(name?.prefix) ? name.prefix.join(' ') : undefined,
    Array.isArray(name?.given) ? name.given.join(' ') : undefined,
    name?.family,
    Array.isArray(name?.suffix) ? name.suffix.join(' ') : undefined,
  ]
    .filter(Boolean)
    .join(' ')
    .trim();
}

function getFirstGivenName(name: any): string | null {
  const firstGiven = Array.isArray(name?.given)
    ? name.given.find((part: unknown) => typeof part === 'string' && part.trim())
    : undefined;
  return typeof firstGiven === 'string' ? firstGiven.trim() : null;
}

function upsertPatient(db: any, r: any, activePatientId: string): void {
  const name = Array.isArray(r.name)
    ? r.name.find((entry: any) => entry?.use === 'official') ?? r.name[0]
    : undefined;
  const fullName = getHumanNameDisplay(name);
  const importedPreferredName = getFirstGivenName(name);
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
  const importedAge = calculateAgeFromBirthDate(r.birthDate);
  if (typeof r.birthDate === 'string' && importedAge === null) {
    console.warn('[FHIR Import] Skipping invalid Patient.birthDate', {
      patientId,
      birthDate: r.birthDate,
    });
  }

  // Patient.birthDate is the generic source for normalized runtime age.
  db.runSync(
    `INSERT INTO patients (
       patient_id, name, preferred_name, age, baseline_daily_routine, current_medications,
       spo2_cutoff, baseline_heart_rate, gmfcs, fms, macs, cfcs, edacs,
       created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(patient_id) DO UPDATE SET
       name = COALESCE(NULLIF(excluded.name, ''), patients.name),
       preferred_name = COALESCE(NULLIF(patients.preferred_name, ''), NULLIF(excluded.preferred_name, ''), patients.preferred_name),
       age = excluded.age,
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
    importedPreferredName,
    importedAge === null ? null : String(importedAge),
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
  const extension = resource.extension?.find((item: any) => isExtensionSuffix(item, suffix));
  return extension?.valueString ?? null;
}

function getIntegerExtension(resource: any, suffix: string): number | null {
  const extension = resource.extension?.find((item: any) => isExtensionSuffix(item, suffix));
  return typeof extension?.valueInteger === 'number' ? extension.valueInteger : null;
}

function isExtensionSuffix(extension: any, suffix: string): boolean {
  const url = extension?.url;
  return typeof url === 'string' && (url === suffix || url.endsWith(`/${suffix}`));
}

function upsertObservation(
  db: any,
  r: any,
  activePatientId: string,
  patientReferenceMap?: Map<string, string>,
  resourceReferenceMap?: Map<string, ResourceReferenceTarget>,
): void {
  // your health_samples table:
  // sample_id, patient_id, source, type, value, value_json, unit, recorded_at, received_at
  // console.log('[FHIR Import] Upserting Observation:', r.id, r.code?.coding?.[0]?.code, r.effectiveDateTime);

  const patientId = getImportedPatientId(r, activePatientId, patientReferenceMap);
  if (!patientId) return;
  const observationCode = getObservationCode(r);
  const loincCode = r.code?.coding?.[0]?.code;
  const effectiveTime = resolveObservationEffectiveTime(r);
  if (effectiveTime.recordedAt === null) {
    reportObservationNormalizationIssue(r, effectiveTime.reason);
    return;
  }
  const date = effectiveTime.recordedAt;
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
      typeof r.valueString === 'string'
        ? r.valueString
        : typeof r.valueCodeableConcept?.text === 'string'
          ? r.valueCodeableConcept.text
          : undefined;

    upsertPatientLongitudinalObservation(
      {
        patientId,
        observationId: r.id,
        measurementType: longitudinalType,
        recordedAt: date,
        encounterId: getReferenceId(r.encounter?.reference, resourceReferenceMap),
        numericValue,
        textValue,
        unit: r.valueQuantity?.unit ?? r.valueQuantity?.code ?? undefined,
        sourceSystem: coding?.system,
        sourceCode: coding?.code ?? observationCode,
        sourceType: 'fhir',
        sourceLabel: getStringExtension(r, 'source-label') ?? r.code?.text ?? undefined,
        sourceFile: getStringExtension(r, 'source-file') ?? undefined,
        sourceSection: getStringExtension(r, 'source-section') ?? undefined,
        visitIndex: getIntegerExtension(r, 'visit-index') ?? undefined,
        daysFromFirstVisit: getIntegerExtension(r, 'days-from-first-visit') ?? undefined,
        confidence: getStringExtension(r, 'confidence') ?? undefined,
        rawExcerpt: getStringExtension(r, 'raw-excerpt') ?? r.note?.[0]?.text ?? undefined,
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
    '8302-2':  'height',
    '39156-5': 'bmi',
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

function resolveObservationEffectiveTime(resource: any): ObservationEffectiveTimeResolution {
  const effectiveDateTime = getNonEmptyString(resource?.effectiveDateTime);
  if (effectiveDateTime) {
    return { recordedAt: effectiveDateTime, reason: 'EFFECTIVE_DATETIME' };
  }

  const effectivePeriodStart = getNonEmptyString(resource?.effectivePeriod?.start);
  if (effectivePeriodStart) {
    return { recordedAt: effectivePeriodStart, reason: 'EFFECTIVE_PERIOD_START' };
  }

  const effectivePeriodEnd = getNonEmptyString(resource?.effectivePeriod?.end);
  if (effectivePeriodEnd) {
    return { recordedAt: effectivePeriodEnd, reason: 'EFFECTIVE_PERIOD_END' };
  }

  // Observation.issued is the release time for this version, not the clinical measurement time.
  return { recordedAt: null, reason: 'MISSING_EFFECTIVE_TIME' };
}

function getNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function reportObservationNormalizationIssue(resource: any, reason: 'MISSING_EFFECTIVE_TIME'): void {
  console.warn('[FHIR Import] Observation kept raw-only during normalization', {
    resourceType: 'Observation',
    id: typeof resource?.id === 'string' ? resource.id : null,
    code: getObservationCode(resource),
    reason,
  });
}

function reportRawOnlyObservationTimeIssue(resource: any): void {
  if (resource?.resourceType !== 'Observation') return;
  const effectiveTime = resolveObservationEffectiveTime(resource);
  if (effectiveTime.recordedAt !== null) return;
  reportObservationNormalizationIssue(resource, effectiveTime.reason);
}

function upsertMedication(
  db: any,
  r: any,
  activePatientId: string,
  patientReferenceMap?: Map<string, string>,
): void {
  // your medications table:
  // medication_id, patient_id, name, dosage, frequency, route, indication, active, source
  const patientId = getImportedPatientId(r, activePatientId, patientReferenceMap);
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

function upsertCondition(
  db: any,
  r: any,
  activePatientId: string,
  patientReferenceMap?: Map<string, string>,
  provenanceId?: string,
  latestDaysFromFirstVisit?: number,
): void {
  // your patient_conditions table:
  // condition_id, patient_id, name, icd10, snomed_code, onset_date,
  // category, is_primary, source, needs_review, condition_role, source_references_json
  const patientId = getImportedPatientId(r, activePatientId, patientReferenceMap);
  if (!patientId) return;

  const coding = r.code?.coding ?? [];
  const icd10 = coding.find((c: any) => c?.system?.includes('icd-10'))?.code
    ?? coding[0]?.code
    ?? null;
  const snomed = coding.find((c: any) => c?.system?.includes('snomed'))?.code
    ?? null;
  const name = r.code?.text ?? r.code?.coding?.[0]?.display ?? '';
  const conditionRole = getConditionRoleExtension(r);
  const sourceReferences = getConditionSourceReferences(
    r,
    name,
    provenanceId,
    latestDaysFromFirstVisit,
  );

  db.runSync(
    `INSERT OR REPLACE INTO patient_conditions
       (condition_id, patient_id, name, icd10, snomed_code, onset_date, is_primary, source,
        needs_review, condition_role, source_references_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'fhir_import', ?, ?, ?);`,
    r.id,
    patientId,
    name,
    icd10,
    snomed,
    r.onsetDateTime ?? null,
    conditionRole === 'primary_diagnosis' ? 1 : 0,
    0,
    conditionRole ?? null,
    sourceReferences.length > 0 ? JSON.stringify(sourceReferences) : null,
  );
}

function getConditionRoleExtension(resource: any): PatientConditionRole | undefined {
  const role = getStringExtension(resource, 'condition-role');
  if (
    role === 'primary_diagnosis' ||
    role === 'active_comorbidity' ||
    role === 'history_context'
  ) {
    return role;
  }
  return undefined;
}

function getConditionSourceReferences(
  resource: any,
  rawLabel: string,
  provenanceId?: string,
  latestDaysFromFirstVisit?: number,
): PatientConditionSourceReference[] {
  return (resource.extension ?? [])
    .filter((extension: any) => isExtensionSuffix(extension, 'source-reference'))
    .map((extension: any) => {
      const sourceReference = getNestedSourceReferenceValues(extension);
      const daysFromFirstVisit = sourceReference.daysFromFirstVisit;
      return {
        rawLabel,
        sourceFile: sourceReference.sourceFile,
        sourceSection: sourceReference.sourceSection,
        visitIndex: sourceReference.visitIndex,
        daysFromFirstVisit,
        daysBeforeLatestVisit:
          typeof latestDaysFromFirstVisit === 'number' &&
          typeof daysFromFirstVisit === 'number'
            ? latestDaysFromFirstVisit - daysFromFirstVisit
            : undefined,
        dateKind: 'first_source_mention',
        provenanceId,
      };
    });
}

function getNestedSourceReferenceValues(extension: any): {
  sourceFile?: string;
  sourceSection?: string;
  visitIndex?: number;
  daysFromFirstVisit?: number;
} {
  const values = {
    sourceFile: undefined as string | undefined,
    sourceSection: undefined as string | undefined,
    visitIndex: undefined as number | undefined,
    daysFromFirstVisit: undefined as number | undefined,
  };

  for (const item of extension.extension ?? []) {
    if (isExtensionSuffix(item, 'source_file') && typeof item.valueString === 'string') {
      values.sourceFile = item.valueString;
    } else if (
      isExtensionSuffix(item, 'source_category') &&
      typeof item.valueString === 'string'
    ) {
      values.sourceSection = item.valueString;
    } else if (
      isExtensionSuffix(item, 'visit_index') &&
      typeof item.valueInteger === 'number'
    ) {
      values.visitIndex = item.valueInteger;
    } else if (
      isExtensionSuffix(item, 'days_from_first_visit') &&
      typeof item.valueInteger === 'number'
    ) {
      values.daysFromFirstVisit = item.valueInteger;
    }
  }

  return values;
}

const timelineEventTypes = new Set<PatientTimelineEventType>([
  'pre_op_planning',
  'operative_event',
  'discharge_restrictions',
  'post_op_follow_up',
  'ot_orthosis_plan',
  'equipment_orthotics_support',
]);

function upsertPatientTimelineEventFromBasic(
  r: any,
  activePatientId: string,
  patientReferenceMap?: Map<string, string>,
): void {
  const code = r.code?.coding?.[0]?.code ?? r.code?.text;
  if (code !== 'patient-timeline-event') return;

  const patientId = getImportedPatientId(r, activePatientId, patientReferenceMap);
  const eventType = getStringExtension(r, 'timeline-event-type');
  const visitIndex = getIntegerExtension(r, 'visit-index');
  const daysFromFirstVisit = getIntegerExtension(r, 'days-from-first-visit');
  const daysBeforeLatestVisit = getIntegerExtension(r, 'days-before-latest-visit');
  const sourceFile = getStringExtension(r, 'source-file');
  const sourceSection = getStringExtension(r, 'source-section');
  const confidence = getStringExtension(r, 'confidence');
  const clinicalRelevance =
    getStringExtension(r, 'clinical-review-relevance') ??
    getStringExtension(r, 'transition-planning-relevance');

  if (
    !patientId ||
    !r.id ||
    !timelineEventTypes.has(eventType as PatientTimelineEventType) ||
    typeof visitIndex !== 'number' ||
    typeof daysFromFirstVisit !== 'number' ||
    typeof daysBeforeLatestVisit !== 'number' ||
    !sourceFile ||
    !sourceSection ||
    (confidence !== 'high' && confidence !== 'medium' && confidence !== 'low') ||
    !clinicalRelevance
  ) {
    return;
  }

  upsertPatientTimelineEvent({
    eventId: r.id,
    patientId,
    eventType: eventType as PatientTimelineEventType,
    title: r.code?.text ?? 'Documented care context',
    summary: r.note?.[0]?.text ?? r.text?.div ?? '',
    visitIndex,
    daysFromFirstVisit,
    daysBeforeLatestVisit,
    sourceFile,
    sourceSection,
    confidence,
    clinicalRelevance,
    createdAt: new Date().toISOString(),
  });
}

function upsertPatientCareContextItemFromBasic(
  r: any,
  activePatientId: string,
  patientReferenceMap?: Map<string, string>,
): void {
  const code = r.code?.coding?.[0]?.code ?? r.code?.text;
  if (code !== 'patient-care-context-item') return;

  const patientId = getImportedPatientId(r, activePatientId, patientReferenceMap);
  const contextCategory = getStringExtension(r, 'context-category');
  const plainTitle = getStringExtension(r, 'plain-title');
  const factualSummary = getStringExtension(r, 'factual-summary');
  const sourceExcerpt = getStringExtension(r, 'source-excerpt');
  const sourceDocument = getStringExtension(r, 'source-document');
  const sourceSection = getStringExtension(r, 'source-section');
  const handling = getStringExtension(r, 'handling');
  const confidence = getStringExtension(r, 'confidence');

  if (
    !patientId ||
    !r.id ||
    !contextCategory ||
    !plainTitle ||
    !factualSummary ||
    !sourceExcerpt ||
    !sourceDocument ||
    !sourceSection ||
    !handling
  ) {
    return;
  }

  const now = new Date().toISOString();
  upsertPatientCareContextItem(
    {
      itemId: r.id,
      patientId,
      contextCategory,
      plainTitle,
      factualSummary,
      sourceExcerpt,
      sourceDocument,
      sourceSection,
      visitIndex: getIntegerExtension(r, 'visit-index'),
      daysFromFirstVisit: getIntegerExtension(r, 'days-from-first-visit'),
      sourcePath: getStringExtension(r, 'source-path'),
      relatedTimelineEvent: getStringExtension(r, 'related-timeline-event'),
      handling: handling.split(',').map((item) => item.trim()).filter(Boolean),
      confidence,
      limitations: getStringExtension(r, 'limitations'),
      createdAt: now,
      updatedAt: now,
    },
    getDatabase(),
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
  'mike-mobility-assistance-level': 'mobility_assistance_level',
  'mike-musculoskeletal-limitation-level': 'musculoskeletal_limitation_level',
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

function getReferenceId(
  reference?: string,
  resourceReferenceMap?: Map<string, ResourceReferenceTarget>,
): string | undefined {
  if (!reference) return undefined;
  const resolved = resourceReferenceMap?.get(reference);
  if (resolved) return resolved.id;
  if (reference.startsWith('urn:uuid:')) return reference.replace('urn:uuid:', '');
  return reference.split('/').pop() || reference;
}

function referenceMatchesResourceId(
  reference: string | undefined,
  resourceType: string,
  resourceId: string,
  resourceReferenceMap?: Map<string, ResourceReferenceTarget>,
): boolean {
  const resolved = reference ? resourceReferenceMap?.get(reference) : undefined;
  if (resolved) {
    return resolved.resourceType === resourceType && resolved.id === resourceId;
  }
  return (
    reference === resourceId ||
    reference === `${resourceType}/${resourceId}` ||
    reference === `urn:uuid:${resourceId}` ||
    getReferenceId(reference) === resourceId
  );
}

function upsertFHIRCarePlan(
  r: any,
  activePatientId: string,
  patientReferenceMap: Map<string, string> | undefined,
  practitionerDisplayByReference: Map<string, string>,
  rehabPlanResourceIndex: RehabPlanResourceIndex,
  resourceReferenceMap: Map<string, ResourceReferenceTarget>,
): void {
  const patientId = getImportedPatientId(r, activePatientId, patientReferenceMap);
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

  replaceCarePlanRehabMetrics(
    patientId,
    r.id,
    buildCarePlanRehabMetrics(
      r,
      patientId,
      activePatientId,
      patientReferenceMap,
      rehabPlanResourceIndex,
      resourceReferenceMap,
      now,
    ),
  );
}

function buildCarePlanRehabMetrics(
  carePlan: any,
  patientId: string,
  activePatientId: string,
  patientReferenceMap: Map<string, string> | undefined,
  rehabPlanResourceIndex: RehabPlanResourceIndex,
  resourceReferenceMap: Map<string, ResourceReferenceTarget>,
  now: string,
): CarePlanRehabMetric[] {
  const durationDays = getCarePlanDurationDays(carePlan.period);
  if (!durationDays) return [];

  const metrics: CarePlanRehabMetric[] = [];
  const seenMetricKeys = new Set<CarePlanRehabMetricKey>();

  for (const goalReference of carePlan.goal ?? []) {
    const goal = rehabPlanResourceIndex.goalsByReference.get(goalReference?.reference);
    if (!goal?.id) continue;

    const goalPatientId = getImportedPatientId(goal, activePatientId, patientReferenceMap);
    if (goalPatientId !== patientId) continue;

    for (const target of goal.target ?? []) {
      const metricKey = getRehabPlanMetricKey(target?.measure);
      if (!metricKey || seenMetricKeys.has(metricKey)) continue;

      const targetValue = target?.detailQuantity?.value;
      if (typeof targetValue !== 'number') continue;

      const baselineObservation = findBaselineObservationForMetric(
        rehabPlanResourceIndex.baselineObservations,
        carePlan.id,
        patientId,
        activePatientId,
        patientReferenceMap,
        resourceReferenceMap,
        metricKey,
      );
      const baselineValue = baselineObservation?.valueQuantity?.value;
      const definition = rehabPlanMetricDefinitions[metricKey];

      metrics.push({
        id: `${patientId}:${carePlan.id}:${metricKey}`,
        patientId,
        carePlanId: carePlan.id,
        carePlanActivityId: null,
        metricKey,
        displayName: definition.displayName,
        baselineValue: typeof baselineValue === 'number' ? baselineValue : null,
        targetValue,
        unit:
          target.detailQuantity?.unit ??
          baselineObservation?.valueQuantity?.unit ??
          target.detailQuantity?.code ??
          baselineObservation?.valueQuantity?.code ??
          '',
        durationDays,
        sourceGoalId: goal.id,
        sourceBaselineObservationId: baselineObservation?.id ?? null,
        createdAt: now,
        updatedAt: now,
      });
      seenMetricKeys.add(metricKey);
    }
  }

  return metrics;
}

function findBaselineObservationForMetric(
  observations: any[],
  carePlanId: string,
  patientId: string,
  activePatientId: string,
  patientReferenceMap: Map<string, string> | undefined,
  resourceReferenceMap: Map<string, ResourceReferenceTarget>,
  metricKey: CarePlanRehabMetricKey,
): any | null {
  return (
    observations.find((observation) => {
      if (getRehabPlanMetricKey(observation.code) !== metricKey) return false;
      if (getImportedPatientId(observation, activePatientId, patientReferenceMap) !== patientId) {
        return false;
      }
      return (observation.basedOn ?? []).some(
        (reference: any) =>
          referenceMatchesResourceId(
            reference?.reference,
            'CarePlan',
            carePlanId,
            resourceReferenceMap,
          ),
      );
    }) ?? null
  );
}

function getRehabPlanMetricKey(codeableConcept: any): CarePlanRehabMetricKey | null {
  const coding = codeableConcept?.coding;
  if (!Array.isArray(coding)) return null;
  const match = coding.find(
    (item: any) =>
      item?.system === REHAB_PLAN_METRIC_CODE_SYSTEM &&
      Object.prototype.hasOwnProperty.call(rehabPlanMetricDefinitions, item?.code),
  );
  return match?.code ? (match.code as CarePlanRehabMetricKey) : null;
}

function getCarePlanDurationDays(period: any): number | null {
  const start = parseFhirDate(period?.start);
  const end = parseFhirDate(period?.end);
  if (!start || !end || end.getTime() < start.getTime()) return null;
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function parseFhirDate(value?: string): Date | null {
  if (!value) return null;
  const datePart = value.split('T')[0];
  const match = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
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


function hasResourceId(resource: any): boolean {
  return typeof resource?.id === 'string' && resource.id.trim().length > 0;
}

function getRawResourceId(resource: any, fullUrl?: string): string | null {
  const id = typeof resource?.id === 'string' ? resource.id.trim() : '';
  if (id) {
    return id;
  }
  const normalizedFullUrl = normalizeFullUrl(fullUrl);
  if (normalizedFullUrl) return normalizedFullUrl;
  return null;
}

function normalizeFullUrl(fullUrl?: string): string | null {
  return typeof fullUrl === 'string' && fullUrl.trim() ? fullUrl.trim() : null;
}

function cacheRawResource(db: any, r: any, fullUrl?: string): void {
  // fhir_resources table:
  // resource_type, resource_id, version, kind, payload_json, last_synced_at, created_at
  const resourceType = typeof r?.resourceType === 'string' ? r.resourceType : null;
  const resourceId = getRawResourceId(r, fullUrl);
  if (!resourceType || !resourceId) return;

  const now = new Date().toISOString();

  db.runSync(
    `INSERT INTO fhir_resources
       (resource_type, resource_id, version, kind, payload_json, last_synced_at, created_at)
     VALUES (?, ?, 1, 'imported', ?, ?, ?)
     ON CONFLICT(resource_type, resource_id, version) DO UPDATE SET
       payload_json   = excluded.payload_json,
       last_synced_at = excluded.last_synced_at;`,
    resourceType,
    resourceId,
    JSON.stringify(r),
    now,
    now,
  );
}

import { useMemo } from 'react';

import { usePatientRecord } from '@/contexts/patient-record-context';
import { getRecentHealthSamples } from '@/data/repositories/healthSampleRepository';
import type {
  HealthSample,
  HealthSampleType,
  NormalizedActivePatient,
  NormalizedVitalMetric,
  PatientCondition
} from '@/data/types';
import { store, type AppDispatch } from '@/store';
import {
  clearVitalsForPatient,
  hydrationFailed,
  hydrationStarted,
  hydrationSucceeded
} from '@/store/reducers/vitalsSlice';
import { runInBackground } from '@/utils/commonFunctions';

const CLINICAL_VITALS: {
  key: HealthSampleType;
  label: string;
  unitFallback: string;
  pairedKey?: HealthSampleType;
}[] = [
  { key: 'spo2', label: 'Oxygen Saturation', unitFallback: '%' },
  { key: 'heart_rate', label: 'Heart Rate', unitFallback: 'BPM' },
  { key: 'respiratory_rate', label: 'Respiratory Rate', unitFallback: 'br/min' },
  {
    key: 'blood_pressure_systolic',
    label: 'Blood Pressure',
    unitFallback: 'mmHg',
    pairedKey: 'blood_pressure_diastolic',
  },
  { key: 'temperature', label: 'Body Temperature', unitFallback: 'deg F' },
];

function clean(value: string | number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

const LIVE_MONITORING_TYPES: HealthSampleType[] = [
  'spo2',
  'heart_rate',
  'resting_heart_rate',
  'respiratory_rate',
  'blood_pressure_systolic',
  'blood_pressure_diastolic',
  'temperature',
  'blood_glucose',
  'steps',
  'calories_burned',
  'flights_climbed',
  'hrv_sdnn',
  'sleep'
];

const RECENT_MONITORING_WINDOW_DAYS = 7;

const ACTIVE_COMORBIDITY_ORDER = new Map([
  ['contracture', 0],
  ['scoliosis', 1],
  ['constipation', 2],
  ['dysphagia', 3],
  ['esophagitis', 4],
  ['epilepsy', 5],
]);

/**
 * Hydrate the vitalsSlice (Redux) with recent non-FHIR live vitals for the
 * given patient. Called when the patient record refreshes so the
 * WeeklyVitalsCard can render live monitoring readings alongside the
 * imported FHIR clinical vitals.
 */
export function hydrateLiveVitals(patientId: string, dispatch: AppDispatch = store.dispatch): void {
  dispatch(hydrationStarted({ patientId }));
  // make the fucntion non-blocking 
  runInBackground(() => {
    try {
      const since = new Date(Date.now() - RECENT_MONITORING_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const samples = LIVE_MONITORING_TYPES.flatMap((type) =>
        getRecentHealthSamples(patientId, type, since, 100),
      ).filter((sample) => sample.source !== 'fhir');
      dispatch(hydrationSucceeded({ patientId, samples }));
    } catch (error) {
      dispatch(hydrationFailed({ patientId, error: String(error) }));
    }
  });
}

export function clearLiveVitals(dispatch: AppDispatch = store.dispatch): void {
  dispatch(clearVitalsForPatient(undefined));
}

export function normalizeActivePatient(
  snapshot: NonNullable<ReturnType<typeof usePatientRecord>['snapshot']>,
  patientId: string,
): NormalizedActivePatient {
  const patient = snapshot.patient;
  const name = clean(patient?.name);
  const preferredName = clean(patient?.preferredName);
  const displayName = preferredName || name;
  const nameParts = (name || displayName).split(/\s+/).filter(Boolean);
  const confirmedConditions = snapshot.conditions.filter((condition) => !condition.needsReview);
  const hasCuratedConditionRoles = snapshot.conditions.some((condition) =>
    Boolean(condition.conditionRole),
  );
  const primaryDiagnosis =
    snapshot.conditions.find((condition) => condition.conditionRole === 'primary_diagnosis') ??
    snapshot.primaryCondition ??
    confirmedConditions.find((condition) => condition.isPrimary) ??
    confirmedConditions[0] ??
    null;
  const comorbidities = hasCuratedConditionRoles
    ? sortActiveComorbidities(
        snapshot.conditions.filter((condition) => condition.conditionRole === 'active_comorbidity'),
      )
    : confirmedConditions.filter(
        (condition) => condition !== primaryDiagnosis && condition.source !== 'fhir_import',
      );

  const caregiver: NormalizedActivePatient['caregiver'] = snapshot.caregiver
    ? {
        name: snapshot.caregiver.name,
        relationship: snapshot.caregiver.relationship,
      }
    : null;

  return {
    patientId,
    firstName: nameParts[0] ?? '',
    lastName: nameParts.slice(1).join(' '),
    displayName,
    preferredName,
    age: clean(patient?.age),
    caregiver,
    primaryDiagnosis,
    comorbidities,
    pendingConditions: snapshot.pendingReviewConditions,
    classifications: {
      gmfcs: clean(patient?.gmfcs),
      fms: clean(patient?.fms),
      macs: clean(patient?.macs),
      cfcs: clean(patient?.cfcs),
      edacs: clean(patient?.edacs),
    },
    baselineDailyRoutine: clean(patient?.baselineDailyRoutine),
    currentMedications: clean(patient?.currentMedications),
    spo2Cutoff: clean(patient?.spo2Cutoff),
    baselineHeartRate: clean(patient?.baselineHeartRate),
    baselineBloodOxygen: clean(patient?.baselineBloodOxygen),
    baselineRespiratoryRate: clean(patient?.baselineRespiratoryRate),
    baselineBloodPressureSystolic: clean(patient?.baselineBloodPressureSystolic),
    baselineBloodPressureDiastolic: clean(patient?.baselineBloodPressureDiastolic),
    baselineGlucoseLevel: clean(patient?.baselineGlucoseLevel),
    baselineBodyTemperature: clean(patient?.baselineBodyTemperature),
    medicationConfirmationRequirements: snapshot.medicationConfirmationRequirements ?? {},
    status: patient ? 'available' : 'unknown',
    lastRefreshedAt: snapshot.lastRefreshedAt,
  };
}

function sortActiveComorbidities(conditions: PatientCondition[]): PatientCondition[] {
  return [...conditions].sort(
    (a, b) =>
      (ACTIVE_COMORBIDITY_ORDER.get(a.name.toLowerCase()) ?? Number.MAX_SAFE_INTEGER) -
      (ACTIVE_COMORBIDITY_ORDER.get(b.name.toLowerCase()) ?? Number.MAX_SAFE_INTEGER),
  );
}

function getImportedHealthSamples(patientId: string, type: HealthSampleType): HealthSample[] {
  return getRecentHealthSamples(patientId, type, '1970-01-01T00:00:00.000Z', 500)
    .filter((sample) => sample.source === 'fhir');
}

function findPairedSample(
  sample: HealthSample | undefined,
  pairedSamples: HealthSample[],
): HealthSample | undefined {
  if (!sample) return undefined;
  const baseId = sample.sampleId.replace(/-systolic$/, '');
  return (
    pairedSamples.find((candidate) => candidate.sampleId.replace(/-diastolic$/, '') === baseId) ??
    pairedSamples.find((candidate) => candidate.recordedAt === sample.recordedAt)
  );
}

function formatVitalValue(sample?: HealthSample, pairedSample?: HealthSample): string {
  if (!sample || sample.value === undefined || sample.value === null) return '';
  if (sample.type === 'blood_pressure_systolic' && pairedSample?.value != null) {
    return `${sample.value}/${pairedSample.value}`;
  }
  return String(sample.value);
}

function normalizeVitalMetric(
  key: HealthSampleType,
  label: string,
  unitFallback: string,
  samples: HealthSample[],
  pairedSamples: HealthSample[] = [],
): NormalizedVitalMetric | null {
  const sorted = [...samples].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
  );
  if (sorted.length === 0) return null;
  const sortedPaired = [...pairedSamples].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
  );
  const latest = sorted[sorted.length - 1];
  const latestPaired = findPairedSample(latest, sortedPaired);
  const bloodPressureReadings =
    key === 'blood_pressure_systolic'
      ? sorted.map((sample) => {
          const pairedSample = findPairedSample(sample, sortedPaired);
          return {
            systolic: sample.value,
            diastolic: pairedSample?.value,
            systolicSampleId: sample.sampleId,
            diastolicSampleId: pairedSample?.sampleId,
            unit: sample.unit || pairedSample?.unit || unitFallback,
            recordedAt: sample.recordedAt,
            source: sample.source,
          };
        })
      : undefined;
  const bloodPressure =
    key === 'blood_pressure_systolic' && latest
      ? {
          systolic: latest.value,
          diastolic: latestPaired?.value,
          systolicSampleId: latest.sampleId,
          diastolicSampleId: latestPaired?.sampleId,
          unit: latest.unit || latestPaired?.unit || unitFallback,
          recordedAt: latest.recordedAt,
          source: latest.source,
        }
      : undefined;

  return {
    key,
    label,
    value: formatVitalValue(latest, latestPaired),
    unit: latest?.unit || unitFallback,
    status: latest ? 'available' : 'not_available',
    recordedAt: latest?.recordedAt,
    sampleId: latest?.sampleId,
    source: latest?.source,
    readings: sorted.map((sample) => ({
      sampleId: sample.sampleId,
      type: sample.type,
      value: sample.value,
      unit: sample.unit,
      recordedAt: sample.recordedAt,
      source: sample.source,
    })),
    bloodPressure,
    bloodPressureReadings,
    data: sorted
      .map((sample) => sample.value)
      .filter((value): value is number => typeof value === 'number'),
  };
}

/**
 * Memoized view of the active patient derived from the Context snapshot.
 * Returns null when the snapshot is not ready / has no patient. Re-derives
 * only when snapshot.lastRefreshedAt changes.
 */
export function useActivePatientView(): NormalizedActivePatient | null {
  const { snapshot, patientId, ready } = usePatientRecord();
  return useMemo(() => {
    if (!ready || !snapshot || !patientId) return null;
    return normalizeActivePatient(snapshot, patientId);
  }, [snapshot, patientId, ready]);
}

/**
 * Memoized vitals view. Reads SQLite directly (same call as the previous
 * bridge) and rebroadcasts only when the snapshot refresh token changes.
 */
export function useClinicalVitals(): NormalizedVitalMetric[] {
  const { snapshot, patientId, ready } = usePatientRecord();
  const refreshToken = snapshot?.lastRefreshedAt ?? '';
  return useMemo(() => {
    if (!ready || !patientId) return [];
    return CLINICAL_VITALS.map((v) => {
      const samples = getImportedHealthSamples(patientId, v.key);
      const paired = v.pairedKey
        ? getImportedHealthSamples(patientId, v.pairedKey)
        : [];
      return normalizeVitalMetric(v.key, v.label, v.unitFallback, samples, paired);
    }).filter((m): m is NormalizedVitalMetric => m !== null);
  }, [ready, patientId, refreshToken]);
}

import { useMemo } from 'react';

import { usePatientRecord } from '@/contexts/patient-record-context';
import { getRecentHealthSamples } from '@/data/repositories/healthSampleRepository';
import type {
  HealthSample,
  HealthSampleType,
  NormalizedActivePatient,
  NormalizedBloodPressurePair,
  NormalizedVitalMetric,
  NormalizedVitalReading,
} from '@/data/types';

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

function normalizeActivePatient(
  snapshot: NonNullable<ReturnType<typeof usePatientRecord>['snapshot']>,
  patientId: string,
): NormalizedActivePatient {
  const patient = snapshot.patient;
  const name = clean(patient?.name);
  const preferredName = clean(patient?.preferredName);
  const displayName = preferredName || name;
  const nameParts = (name || displayName).split(/\s+/).filter(Boolean);
  const confirmedConditions = snapshot.conditions.filter((condition) => !condition.needsReview);
  const primaryDiagnosis =
    confirmedConditions.find((condition) => condition.isPrimary) ??
    confirmedConditions[0] ??
    null;
  const comorbidities = confirmedConditions.filter((condition) => condition !== primaryDiagnosis);

  return {
    patientId,
    firstName: nameParts[0] ?? '',
    lastName: nameParts.slice(1).join(' '),
    displayName,
    preferredName,
    age: clean(patient?.age),
    caregiver: snapshot.caregiver
      ? {
          name: snapshot.caregiver.name,
          relationship: snapshot.caregiver.relationship,
        }
      : null,
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
    status: patient ? 'available' : 'unknown',
    lastRefreshedAt: snapshot.lastRefreshedAt,
  };
}

function getImportedHealthSamples(patientId: string, type: HealthSampleType): HealthSample[] {
  return getRecentHealthSamples(patientId, type, '1970-01-01T00:00:00.000Z', 500);
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

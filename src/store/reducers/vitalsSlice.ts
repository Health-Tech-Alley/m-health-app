import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type {
  HealthSample,
  HealthSampleSource,
  HealthSampleType,
} from '@/data/types';
import type { RootState } from '@/store';

export type LiveVitalReading = {
  patientId: string;
  sampleId: string;
  type: HealthSampleType;
  value: number;
  unit: string;
  source: HealthSampleSource;
  recordedAt: string;
  receivedAt: string;
};

export type VitalsStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

export interface VitalsState {
  activePatientId: string | null;
  readings: LiveVitalReading[];
  status: VitalsStatus;
  error: string | null;
  hydratedAt: string | null;
}

const READING_LIMIT = 100;
const PRODUCTION_WEARABLE_SOURCES: readonly HealthSampleSource[] = [
  'apple-health',
  'health-connect',
  'wearable',
];
const SIMULATED_SAMPLE_SOURCES: readonly HealthSampleSource[] = ['mock', 'simulated'];

export type LiveVitalReadingFilter = {
  type?: HealthSampleType;
  since?: Date | number | string;
  recentWindowMs?: number;
  sources?: readonly HealthSampleSource[];
  limit?: number;
};

const initialState: VitalsState = {
  activePatientId: null,
  readings: [],
  status: 'idle',
  error: null,
  hydratedAt: null,
};

export function healthSampleToLiveVitalReading(sample: HealthSample): LiveVitalReading {
  return {
    patientId: sample.patientId,
    sampleId: sample.sampleId,
    type: sample.type,
    value: sample.value,
    unit: sample.unit,
    source: sample.source,
    recordedAt: sample.recordedAt,
    receivedAt: sample.receivedAt,
  };
}

export function isProductionWearableSource(source: HealthSampleSource): boolean {
  return PRODUCTION_WEARABLE_SOURCES.includes(source);
}

export function isSimulatedHealthSampleSource(source: HealthSampleSource): boolean {
  return SIMULATED_SAMPLE_SOURCES.includes(source);
}

function sortNewestFirst(readings: LiveVitalReading[]): LiveVitalReading[] {
  const withTime = readings.map((r) => ({ r, t: Date.parse(r.recordedAt) || 0 }));
  withTime.sort((a, b) => b.t - a.t || b.r.sampleId.localeCompare(a.r.sampleId));
  return withTime.map((x) => x.r);
}

function bounded(readings: LiveVitalReading[]): LiveVitalReading[] {
  return sortNewestFirst(readings).slice(0, READING_LIMIT);
}

function resolveSinceMs(options: LiveVitalReadingFilter): number | null {
  if (options.since !== undefined) {
    const parsed =
      options.since instanceof Date
        ? options.since.getTime()
        : typeof options.since === 'number'
          ? options.since
          : Date.parse(options.since);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (options.recentWindowMs !== undefined) {
    return Date.now() - options.recentWindowMs;
  }
  return null;
}

export function filterLiveVitalReadingsForPatient(
  readings: LiveVitalReading[],
  patientId: string,
  options: LiveVitalReadingFilter = {},
): LiveVitalReading[] {
  const sinceMs = resolveSinceMs(options);
  const sourceSet = options.sources ? new Set(options.sources) : null;

  const filtered = readings.filter((reading) => {
    if (reading.patientId !== patientId) return false;
    if (options.type && reading.type !== options.type) return false;
    if (sourceSet && !sourceSet.has(reading.source)) return false;
    if (sinceMs !== null) {
      const recordedAt = Date.parse(reading.recordedAt);
      if (!Number.isFinite(recordedAt) || recordedAt < sinceMs) return false;
    }
    return true;
  });

  const sorted = sortNewestFirst(filtered);
  return options.limit === undefined ? sorted : sorted.slice(0, options.limit);
}

const vitalsSlice = createSlice({
  name: 'vitals',
  initialState,
  reducers: {
    hydrationStarted(state, action: PayloadAction<{ patientId: string }>) {
      state.activePatientId = action.payload.patientId;
      state.readings = [];
      state.status = 'loading';
      state.error = null;
      state.hydratedAt = null;
    },
    hydrationSucceeded(
      state,
      action: PayloadAction<{ patientId: string; samples: HealthSample[] }>,
    ) {
      state.activePatientId = action.payload.patientId;
      state.readings = bounded(action.payload.samples.map(healthSampleToLiveVitalReading));
      state.status = 'ready';
      state.error = null;
      state.hydratedAt = new Date().toISOString();
    },
    hydrationFailed(
      state,
      action: PayloadAction<{ patientId: string | null; error: string }>,
    ) {
      state.activePatientId = action.payload.patientId;
      state.readings = [];
      state.status = 'error';
      state.error = action.payload.error;
      state.hydratedAt = new Date().toISOString();
    },
    projectHealthSample(state, action: PayloadAction<HealthSample>) {
      const reading = healthSampleToLiveVitalReading(action.payload);

      if (state.activePatientId && state.activePatientId !== reading.patientId) {
        return;
      }

      state.activePatientId = reading.patientId;
      state.status = 'ready';
      state.error = null;
      state.readings = bounded([
        reading,
        ...state.readings.filter((item) => item.sampleId !== reading.sampleId),
      ]);
    },
    clearVitalsForPatient(state, action: PayloadAction<{ patientId?: string } | undefined>) {
      const patientId = action.payload?.patientId;
      if (patientId && state.activePatientId && state.activePatientId !== patientId) {
        return;
      }
      state.activePatientId = patientId ?? null;
      state.readings = [];
      state.status = 'idle';
      state.error = null;
      state.hydratedAt = null;
    },
    markVitalsUnavailable(state, action: PayloadAction<{ patientId: string | null }>) {
      state.activePatientId = action.payload.patientId;
      state.readings = [];
      state.status = 'unavailable';
      state.error = null;
      state.hydratedAt = new Date().toISOString();
    },
    ingestSamplesBatch(state, action: PayloadAction<{ samples: LiveVitalReading[] }>) {
      const incoming = action.payload.samples;
      if (incoming.length === 0) return;

      const patientId = state.activePatientId ?? incoming[0].patientId;
      const patientReadings = incoming.filter((reading) => reading.patientId === patientId);
      if (patientReadings.length === 0) return;

      state.activePatientId = patientId;

      const dedupedMap = new Map<string, LiveVitalReading>();
      for (const reading of patientReadings) {
        dedupedMap.set(reading.sampleId, reading);
      }
      const deduped = Array.from(dedupedMap.values());

      const existingIds = new Set(deduped.map((r) => r.sampleId));
      state.readings = bounded([
        ...deduped,
        ...state.readings.filter((r) => !existingIds.has(r.sampleId)),
      ]);

      state.status = 'ready';
      state.error = null;
    },
  },
});

export const {
  clearVitalsForPatient,
  hydrationFailed,
  hydrationStarted,
  hydrationSucceeded,
  markVitalsUnavailable,
  projectHealthSample,
  ingestSamplesBatch, // syncing vitals to the redux store
} = vitalsSlice.actions;

export default vitalsSlice.reducer;

export const selectLiveVitalsState = (state: RootState) => state.vitals;
export const selectLiveVitalReadings = (state: RootState) => state.vitals.readings;
export const selectLiveVitalReadingsForPatient = (
  state: RootState,
  patientId: string,
  options?: LiveVitalReadingFilter,
) => filterLiveVitalReadingsForPatient(state.vitals.readings, patientId, options);
export const selectProductionWearableReadingsForPatient = (
  state: RootState,
  patientId: string,
  options?: Omit<LiveVitalReadingFilter, 'sources'>,
) =>
  filterLiveVitalReadingsForPatient(state.vitals.readings, patientId, {
    ...options,
    sources: PRODUCTION_WEARABLE_SOURCES,
  });
export const selectSimulatedReadingsForPatient = (
  state: RootState,
  patientId: string,
  options?: Omit<LiveVitalReadingFilter, 'sources'>,
) =>
  filterLiveVitalReadingsForPatient(state.vitals.readings, patientId, {
    ...options,
    sources: SIMULATED_SAMPLE_SOURCES,
  });
export const selectLatestLiveVitalReading = (
  state: RootState,
  type: HealthSampleType,
) => state.vitals.readings.find((reading) => reading.type === type) ?? null;
export const selectLatestProductionWearableReading = (
  state: RootState,
  patientId: string,
  type: HealthSampleType,
) => selectProductionWearableReadingsForPatient(state, patientId, { type, limit: 1 })[0] ?? null;

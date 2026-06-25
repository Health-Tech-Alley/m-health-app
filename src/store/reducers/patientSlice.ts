import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Caregiver, PatientCondition } from "@/data/types";

export type NormalizedVitalReading = {
  sampleId: string;
  type: string;
  value: number;
  unit: string;
  recordedAt: string;
  source: string;
};

export type NormalizedBloodPressurePair = {
  systolic?: number;
  diastolic?: number;
  systolicSampleId?: string;
  diastolicSampleId?: string;
  unit: string;
  recordedAt?: string;
  source?: string;
};

export type NormalizedVitalMetric = {
  key: string;
  label: string;
  value: string;
  unit: string;
  status: "available" | "not_available";
  recordedAt?: string;
  sampleId?: string;
  source?: string;
  readings: NormalizedVitalReading[];
  bloodPressure?: NormalizedBloodPressurePair;
  bloodPressureReadings?: NormalizedBloodPressurePair[];
  data: number[];
};

export type NormalizedActivePatient = {
  patientId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  preferredName: string;
  age: string;
  caregiver: Pick<Caregiver, "name" | "relationship"> | null;
  primaryDiagnosis: PatientCondition | null;
  comorbidities: PatientCondition[];
  pendingConditions: PatientCondition[];
  classifications: {
    gmfcs: string;
    fms: string;
    macs: string;
    cfcs: string;
    edacs: string;
  };
  baselineDailyRoutine: string;
  currentMedications: string;
  spo2Cutoff: string;
  baselineHeartRate: string;
  status: "available" | "unknown";
  lastRefreshedAt: string;
};

export type PatientState = {
  patient: any;
  activePatient: NormalizedActivePatient | null;
  clinicalVitals: NormalizedVitalMetric[];
  loading: boolean;
  error: string | null;
  lastSynced: string | null;
  rawFhirLastSynced: string | null;
};

const initialState: PatientState = {
  patient: null,
  activePatient: null,
  clinicalVitals: [],
  loading: false,
  error: null,
  lastSynced: null,
  rawFhirLastSynced: null,
};

const patientSlice = createSlice({
  name: 'patient',
  initialState,
  reducers: {
    addPatient: (state, action) => {
      state.patient = action.payload;
      state.error = null;
      state.rawFhirLastSynced = new Date().toISOString();
    },
    setActivePatient: (state, action: PayloadAction<NormalizedActivePatient | null>) => {
      state.activePatient = action.payload;
      state.loading = false;
      state.error = null;
      state.lastSynced = new Date().toISOString();
    },
    setClinicalVitals: (state, action: PayloadAction<NormalizedVitalMetric[]>) => {
      state.clinicalVitals = action.payload;
      state.lastSynced = new Date().toISOString();
    },
    setPatientError: (state, action: PayloadAction<string>) => {
      state.loading = false;
      state.error = action.payload;
    },
    clearPatient: (state) => {
      state.patient = null;
      state.activePatient = null;
      state.clinicalVitals = [];
      state.error = null;
      state.lastSynced = null;
      state.rawFhirLastSynced = null;
    },
    clearError: (state) => {
      state.error = null;
    },
    getPatient: (state) => {
      state.loading = true;
      state.error = null;
    }
  },
});

export const {
  addPatient,
  clearPatient,
  clearError,
  getPatient,
  setActivePatient,
  setClinicalVitals,
  setPatientError,
} = patientSlice.actions;
export default patientSlice.reducer;

import type { HealthSampleType } from '../types';

export const HK_TYPE_BY_SAMPLE_TYPE: Record<HealthSampleType, string | null> = {
  spo2: 'HKQuantityTypeIdentifierOxygenSaturation',
  heart_rate: 'HKQuantityTypeIdentifierHeartRate',
  respiratory_rate: 'HKQuantityTypeIdentifierRespiratoryRate',
  blood_pressure_systolic: 'HKQuantityTypeIdentifierBloodPressureSystolic',
  blood_pressure_diastolic: 'HKQuantityTypeIdentifierBloodPressureDiastolic',
  temperature: 'HKQuantityTypeIdentifierBodyTemperature',
  weight: 'HKQuantityTypeIdentifierBodyMass',
  height: 'HKQuantityTypeIdentifierHeight',
  bmi: null,
  blood_glucose: 'HKQuantityTypeIdentifierBloodGlucose',
  steps: 'HKQuantityTypeIdentifierStepCount',
  distance: 'HKQuantityTypeIdentifierDistanceWalkingRunning',
  flights_climbed: 'HKQuantityTypeIdentifierFlightsClimbed',
  sleep: 'HKCategoryTypeIdentifierSleepAnalysis',
  coughing: 'HKCategoryTypeIdentifierCoughing',
};

export const SAMPLE_TYPE_BY_HK_TYPE: Record<string, HealthSampleType> = Object.entries(
  HK_TYPE_BY_SAMPLE_TYPE,
).reduce((acc, [sampleType, hkType]) => {
  if (hkType) acc[hkType] = sampleType as HealthSampleType;
  return acc;
}, {} as Record<string, HealthSampleType>);

export const ALL_HEALTHKIT_READ_TYPES: HealthSampleType[] = [
  'spo2', 'heart_rate', 'respiratory_rate',
  'blood_pressure_systolic', 'blood_pressure_diastolic',
  'temperature', 'weight', 'height',
  'blood_glucose', 'steps', 'distance',
  'flights_climbed', 'sleep', 'coughing',
];

export const UNIT_BY_SAMPLE_TYPE: Record<HealthSampleType, string> = {
  spo2: '%',
  heart_rate: 'bpm',
  respiratory_rate: 'rpm',
  blood_pressure_systolic: 'mmHg',
  blood_pressure_diastolic: 'mmHg',
  temperature: 'C',
  weight: 'kg',
  height: 'cm',
  bmi: 'kg/m2',
  blood_glucose: 'mg/dL',
  steps: 'count',
  distance: 'm',
  flights_climbed: 'count',
  sleep: 'category',
  coughing: 'count',
};

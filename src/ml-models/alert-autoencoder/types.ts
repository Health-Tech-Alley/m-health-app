export interface CoreVitals {
  heart_rate: number;
  blood_oxygen: number;
  blood_pressure_systolic: number;
  blood_pressure_diastolic: number;
  glucose_level: number;
  body_temperature: number;
}

export interface ExtendedVitals extends CoreVitals {
  respiratory_rate: number;
  activity_level: number;
  sleep_quality: number;
  stress_level: number;
  hrv_sdnn: number;
  steps_count: number;
  calories_burned: number;
}

export interface StandardScalerParams {
  feature_cols: string[];
  mean: number[];
  scale: number[];
}

export interface ModelMetadata {
  model_name: string;
  model_version: string;
  model_type: string;
  input_dim: number;
  feature_cols: string[];
  threshold: number;
  threshold_percentile: number;
  threshold_source: string;
  health_event_mapping: Record<string, string>;
  training: {
    normal_train_rows: number;
    normal_val_rows: number;
    train_rows_total: number;
    val_rows_total: number;
    test_rows_total: number;
    train_patients: number;
    val_patients: number;
    test_patients: number;
    epochs_ran: number;
    batch_size: number;
  };
  preprocessing: {
    scaler: string;
    derived_features: string[];
    timestamp_required: boolean;
    patient_level_split: boolean;
  };
}

export interface MLResult {
  anomalyScore: number;
  isAnomalous: boolean;
  reconstructionError: number;
  featureErrors: number[];
}

export interface VitalsValidation {
  valid: boolean;
  errors: string[];
}

export const VITALS_RANGES: Record<keyof CoreVitals, { min: number; max: number; unit: string; label: string }> = {
  heart_rate: { min: 40, max: 200, unit: 'bpm', label: 'Heart Rate' },
  blood_oxygen: { min: 70, max: 100, unit: '%', label: 'SpO2' },
  blood_pressure_systolic: { min: 70, max: 250, unit: 'mmHg', label: 'BP Systolic' },
  blood_pressure_diastolic: { min: 40, max: 150, unit: 'mmHg', label: 'BP Diastolic' },
  glucose_level: { min: 30, max: 500, unit: 'mg/dL', label: 'Glucose' },
  body_temperature: { min: 95, max: 108, unit: '\u00B0F', label: 'Temperature' },
};

/**
 * Cross-platform sensor source abstraction.
 *
 * Apple Health, Health Connect, manual entry, and mock streams all implement
 * this interface. The orchestrator and Alert ML depend only on SensorSource,
 * never on HealthKit directly.
 */

import type { HealthSampleType } from '../types';

export type SensorSampleSource = 'apple-health' | 'health-connect' | 'manual' | 'mock';

export type SensorScalarValue = number;
export type BloodPressureValue = { systolic: number; diastolic: number };
export type SleepValue = 'in_bed' | 'asleep' | 'awake';

export type SensorSample = {
  source: SensorSampleSource;
  type: HealthSampleType;
  value: SensorScalarValue | BloodPressureValue | SleepValue;
  unit: string;
  recordedAt: string; // ISO-8601
  receivedAt: string; // ISO-8601
  patientId: string;
  sampleId: string;
  metadataJson?: string;
};

export type PermissionResult = {
  granted: boolean;
  deniedTypes?: HealthSampleType[];
};

export interface SensorSource {
  /** Returns true if this source is available on the current platform/build. */
  isAvailable(): boolean;
  /** Request permission for the given types. */
  requestPermissions(types: HealthSampleType[]): Promise<PermissionResult>;
  /** Read samples since `since` for the given types. */
  query(types: HealthSampleType[], since: Date): Promise<SensorSample[]>;
  /** Subscribe to new samples (where supported). Returns an unsubscribe function. */
  subscribe?(types: HealthSampleType[], cb: (s: SensorSample) => void): () => void;
  /** Track A convenience: start publishing samples to the orchestration event bus. */
  startPublishingToEventBus?(): () => void;
}

export function isScalarValue(value: SensorSample['value']): value is SensorScalarValue {
  return typeof value === 'number';
}

export function scalarFromSample(sample: SensorSample): number | null {
  return isScalarValue(sample.value) ? sample.value : null;
}

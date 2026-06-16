/**
 * Sensor source public API.
 */

import { MockSensorSource } from './mock-sensor-source';
import type { SensorSource } from './sensor-source';

export * from './sensor-source';
export * from './mock-sensor-source';

export type SensorSourceFactoryOptions = {
  patientId: string;
  forceMock?: boolean;
};

export function createSensorSource(options: SensorSourceFactoryOptions): SensorSource {
  // In v1 Apple Health / Health Connect are not implemented. When they are,
  // this factory will probe AppleHealthSource.isAvailable() and
  // HealthConnectSource.isAvailable() before falling back to the mock.
  if (options.forceMock ?? true) {
    return new MockSensorSource({ patientId: options.patientId, persona: 'copd-tbi' });
  }
  return new MockSensorSource({ patientId: options.patientId, persona: 'copd-tbi' });
}

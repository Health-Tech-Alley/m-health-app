import { Platform } from 'react-native';

import { MockSensorSource } from './mock-sensor-source';
import type { MockPersona } from './mock-sensor-source';
import { AppleHealthSource } from './apple-health-source';
import type { SensorSource } from './sensor-source';

export * from './sensor-source';
export * from './mock-sensor-source';
export * from './apple-health-source';
export * from './healthkit-type-map';

export type SensorSourceFactoryOptions = {
  patientId: string;
  forceMock?: boolean;
};

export function createSensorSource(options: SensorSourceFactoryOptions): SensorSource {
  if (options.forceMock) {
    return new MockSensorSource({
      patientId: options.patientId,
      persona: inferPersonaFromPatient(options.patientId),
    });
  }

  if (Platform.OS === 'ios') {
    return new AppleHealthSource({ patientId: options.patientId });
  }

  return new MockSensorSource({
    patientId: options.patientId,
    persona: inferPersonaFromPatient(options.patientId),
  });
}

function inferPersonaFromPatient(patientId: string): MockPersona {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getPatient } = require('../repositories/patientRepository');
    const patient = getPatient(patientId);
    if (!patient?.conditions) return 'copd-tbi';
    const conditions = JSON.parse(patient.conditions) as {
      icd10?: string;
      name?: string;
      isPrimary?: boolean;
    }[];
    const primary = conditions.find((c) => c.isPrimary) ?? conditions[0];
    return inferPersonaFromCondition(primary?.icd10, primary?.name);
  } catch {
    return 'copd-tbi';
  }
}

function inferPersonaFromCondition(icd10?: string, name?: string): MockPersona {
  if (!icd10 && !name) return 'copd-tbi';
  const code = icd10?.toUpperCase() ?? '';
  const label = name?.toLowerCase() ?? '';
  if (code.startsWith('G80') || label.includes('cerebral palsy')) return 'copd-tbi';
  if (code.startsWith('J44') || label.includes('copd')) return 'copd-tbi';
  if (code.startsWith('I63') || label.includes('stroke')) return 'post-stroke';
  if (code.startsWith('Q05') || label.includes('spina bifida')) return 'spina-bifida';
  return 'normal';
}

/**
 * MockSensorSource — Track A / Expo Go sensor bridge.
 *
 * Generates synthetic vital streams for the three steel-thread personas so the
 * orchestrator and Alert ML can be exercised without real HealthKit data.
 */

import { getEventBus } from '@/orchestration/event-bus';
import type { OrchestrationEvent } from '@/orchestration/events';

import { insertHealthSample } from '../repositories/healthSampleRepository';
import type { HealthSampleType } from '../types';
import type { PermissionResult, SensorSample, SensorSource } from './sensor-source';

export type MockPersona = 'spina-bifida' | 'post-stroke' | 'copd-tbi' | 'normal';

export type MockSensorOptions = {
  patientId: string;
  persona?: MockPersona;
  cadenceMs?: number;
  types?: HealthSampleType[];
};

const PERSONA_BASELINES: Record<MockPersona, Record<string, { value: number; unit: string; variance: number }>> = {
  normal: {
    spo2: { value: 0.97, unit: 'fraction', variance: 0.01 },
    heart_rate: { value: 72, unit: 'bpm', variance: 4 },
    respiratory_rate: { value: 16, unit: 'rpm', variance: 1 },
    temperature: { value: 37.0, unit: 'C', variance: 0.2 },
    steps: { value: 4000, unit: 'count', variance: 500 },
  },
  'spina-bifida': {
    spo2: { value: 0.96, unit: 'fraction', variance: 0.015 },
    heart_rate: { value: 70, unit: 'bpm', variance: 5 },
    respiratory_rate: { value: 18, unit: 'rpm', variance: 2 },
    blood_pressure_systolic: { value: 125, unit: 'mmHg', variance: 8 },
    blood_pressure_diastolic: { value: 80, unit: 'mmHg', variance: 5 },
    temperature: { value: 37.0, unit: 'C', variance: 0.3 },
    steps: { value: 800, unit: 'count', variance: 200 },
  },
  'post-stroke': {
    spo2: { value: 0.96, unit: 'fraction', variance: 0.015 },
    heart_rate: { value: 78, unit: 'bpm', variance: 6 },
    respiratory_rate: { value: 18, unit: 'rpm', variance: 2 },
    blood_pressure_systolic: { value: 140, unit: 'mmHg', variance: 10 },
    blood_pressure_diastolic: { value: 88, unit: 'mmHg', variance: 6 },
    temperature: { value: 37.1, unit: 'C', variance: 0.2 },
    steps: { value: 1500, unit: 'count', variance: 400 },
  },
  'copd-tbi': {
    spo2: { value: 0.91, unit: 'fraction', variance: 0.02 },
    heart_rate: { value: 88, unit: 'bpm', variance: 7 },
    respiratory_rate: { value: 24, unit: 'rpm', variance: 3 },
    temperature: { value: 37.2, unit: 'C', variance: 0.3 },
    steps: { value: 1200, unit: 'count', variance: 300 },
  },
};

function jitter(base: number, variance: number): number {
  return base + (Math.random() * 2 - 1) * variance;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class MockSensorSource implements SensorSource {
  private patientId: string;
  private persona: MockPersona;
  private cadenceMs: number;
  private types: HealthSampleType[];
  private timer?: ReturnType<typeof setInterval>;

  constructor(options: MockSensorOptions) {
    this.patientId = options.patientId;
    this.persona = options.persona ?? 'normal';
    this.cadenceMs = options.cadenceMs ?? 60_000;
    this.types = options.types ?? ['spo2', 'heart_rate', 'respiratory_rate', 'temperature'];
  }

  isAvailable(): boolean {
    return true;
  }

  async requestPermissions(_types: HealthSampleType[]): Promise<PermissionResult> {
    // Track A: permissions are always granted in the mock.
    return { granted: true };
  }

  async query(types: HealthSampleType[], _since: Date): Promise<SensorSample[]> {
    // Return one synthetic sample per requested type.
    const now = new Date();
    return types.map((type) => this.generateSample(type, now));
  }

  subscribe(types: HealthSampleType[], cb: (s: SensorSample) => void): () => void {
    this.timer = setInterval(() => {
      const now = new Date();
      for (const type of types) {
        const sample = this.generateSample(type, now);
        cb(sample);
      }
    }, this.cadenceMs);
    return () => {
      if (this.timer) clearInterval(this.timer);
    };
  }

  startPublishingToEventBus(): () => void {
    const bus = getEventBus();
    return this.subscribe(this.types, (sample) => {
      // Persist the sample to the local SQLite cache.
      const healthSample = {
        sampleId: sample.sampleId,
        patientId: sample.patientId,
        source: sample.source as 'mock',
        type: sample.type,
        value: typeof sample.value === 'number' ? sample.value : 0,
        valueJson: typeof sample.value === 'number' ? undefined : JSON.stringify(sample.value),
        unit: sample.unit,
        recordedAt: sample.recordedAt,
        receivedAt: sample.receivedAt,
        metadataJson: sample.metadataJson,
      };
      insertHealthSample(healthSample);

      // Publish to the orchestration event bus.
      const scalar = typeof sample.value === 'number' ? sample.value : 0;
      const event: Extract<OrchestrationEvent, { type: 'vitals_sample' }> = {
        type: 'vitals_sample',
        patientId: sample.patientId,
        sampleId: sample.sampleId,
        sampleType: sample.type,
        value: scalar,
        unit: sample.unit,
        recordedAt: sample.recordedAt,
      };
      bus.publish(event);
    });
  }

  private generateSample(type: HealthSampleType, now: Date): SensorSample {
    const baseline = PERSONA_BASELINES[this.persona][type];
    const base = baseline?.value ?? 0;
    const variance = baseline?.variance ?? 0;
    const unit = baseline?.unit ?? '';

    let value: number;
    switch (type) {
      case 'spo2':
        value = clamp(jitter(base, variance), 0.75, 1.0);
        break;
      case 'heart_rate':
        value = clamp(Math.round(jitter(base, variance)), 45, 160);
        break;
      case 'respiratory_rate':
        value = clamp(Math.round(jitter(base, variance)), 8, 40);
        break;
      case 'temperature':
        value = clamp(jitter(base, variance), 35.0, 40.0);
        break;
      case 'blood_pressure_systolic':
        value = clamp(Math.round(jitter(base, variance)), 90, 200);
        break;
      case 'blood_pressure_diastolic':
        value = clamp(Math.round(jitter(base, variance)), 60, 130);
        break;
      case 'steps':
        value = clamp(Math.round(jitter(base, variance)), 0, 20000);
        break;
      default:
        value = jitter(base, variance);
    }

    return {
      sampleId: `mock-${type}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 5)}`,
      patientId: this.patientId,
      source: 'mock',
      type,
      value,
      unit,
      recordedAt: now.toISOString(),
      receivedAt: now.toISOString(),
    };
  }
}

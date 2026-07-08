import { Platform } from 'react-native';

import { getEventBus } from '@/orchestration/event-bus';
import type { OrchestrationEvent } from '@/orchestration/events';

import {
  getSyncCursor,
  setSyncCursor,
  insertHealthSample,
} from '../repositories/healthSampleRepository';
import {
  getPrimaryWearableForPatient,
  setWearableHealthKitSource,
} from '../repositories/wearableDeviceRepository';
import type { HealthSample, HealthSampleType } from '../types';
import type { PermissionResult, SensorSample, SensorSource } from './sensor-source';
import {
  HK_TYPE_BY_SAMPLE_TYPE,
  UNIT_BY_SAMPLE_TYPE,
  ALL_HEALTHKIT_READ_TYPES,
} from './healthkit-type-map';

export type AppleHealthSourceOptions = {
  patientId: string;
  types?: HealthSampleType[];
};

type HealthKitModule = typeof import('@kingstinct/react-native-healthkit');
let _hkModule: HealthKitModule | null | undefined;

async function getHealthKitModule(): Promise<HealthKitModule | null> {
  if (_hkModule !== undefined) return _hkModule;
  if (Platform.OS !== 'ios') {
    _hkModule = null;
    return null;
  }
  try {
    _hkModule = await import('@kingstinct/react-native-healthkit');
    return _hkModule;
  } catch {
    _hkModule = null;
    return null;
  }
}

export class AppleHealthSource implements SensorSource {
  private patientId: string;
  private types: HealthSampleType[];
  private watchSourceId: string | null = null;
  private watchSourceName: string | null = null;
  private subscriptions: (() => void)[] = [];

  constructor(options: AppleHealthSourceOptions) {
    this.patientId = options.patientId;
    this.types = options.types ?? ALL_HEALTHKIT_READ_TYPES;
    const wearable = getPrimaryWearableForPatient(this.patientId);
    if (wearable?.healthkitSourceId) {
      this.watchSourceId = wearable.healthkitSourceId;
      this.watchSourceName = wearable.healthkitSourceName ?? null;
    }
  }

  isAvailable(): boolean {
    return Platform.OS === 'ios';
  }

  async isHealthDataAvailable(): Promise<boolean> {
    const hk = await getHealthKitModule();
    if (!hk) return false;
    try {
      return await hk.isHealthDataAvailable();
    } catch {
      return false;
    }
  }

  async requestPermissions(types: HealthSampleType[]): Promise<PermissionResult> {
    const hk = await getHealthKitModule();
    if (!hk) {
      return { granted: false, deniedTypes: types };
    }
    const hkTypes = types
      .map((t) => HK_TYPE_BY_SAMPLE_TYPE[t])
      .filter((t): t is string => t !== null);

    try {
      await hk.requestAuthorization({
        toRead: hkTypes as unknown as Parameters<typeof hk.requestAuthorization>[0]['toRead'],
      });
      return { granted: true };
    } catch {
      return { granted: false, deniedTypes: types };
    }
  }

  async query(types: HealthSampleType[], since: Date): Promise<SensorSample[]> {
    const hk = await getHealthKitModule();
    if (!hk) return [];

    const results: SensorSample[] = [];
    for (const type of types) {
      const hkType = HK_TYPE_BY_SAMPLE_TYPE[type];
      if (!hkType) continue;

      try {
        const samples = await hk.queryQuantitySamples(
          hkType as Parameters<typeof hk.queryQuantitySamples>[0],
          { filter: { date: { startDate: since } }, limit: -1 } as Parameters<typeof hk.queryQuantitySamples>[1],
        );
        for (const s of samples) {
          const sensorSample = this.convertToSensorSample(s, type);
          if (sensorSample) results.push(sensorSample);
        }
      } catch (err) {
        console.warn(`[AppleHealthSource] query failed for ${type}:`, err);
      }
    }
    return results;
  }

  subscribe(types: HealthSampleType[], cb: (s: SensorSample) => void): () => void {
    const unsubscribers: (() => void)[] = [];

    (async () => {
      const hk = await getHealthKitModule();
      if (!hk) return;

      for (const type of types) {
        const hkType = HK_TYPE_BY_SAMPLE_TYPE[type];
        if (!hkType) continue;

        try {
          const sub = hk.subscribeToChanges(
            hkType as Parameters<typeof hk.subscribeToChanges>[0],
            () => {
              this.incrementalSync(type).then((samples) => {
                for (const s of samples) cb(s);
              });
            },
          );
          unsubscribers.push(() => sub.remove());
        } catch (err) {
          console.warn(`[AppleHealthSource] subscribe failed for ${type}:`, err);
        }
      }
    })();

    return () => {
      for (const unsub of unsubscribers) unsub();
    };
  }

  startPublishingToEventBus(): () => void {
    const bus = getEventBus();

    const unsubscribe = this.subscribe(this.types, (sample) => {
      this.persistAndPublish(sample, bus);
    });

    this.initialCatchUpSync();

    return () => {
      unsubscribe();
      for (const sub of this.subscriptions) sub();
      this.subscriptions = [];
    };
  }

  async incrementalSync(type: HealthSampleType): Promise<SensorSample[]> {
    const hk = await getHealthKitModule();
    if (!hk) return [];

    const hkType = HK_TYPE_BY_SAMPLE_TYPE[type];
    if (!hkType) return [];

    const cursorKey = 'apple-health';
    const lastAnchor = getSyncCursor(cursorKey, type);

    try {
      const response = await hk.queryQuantitySamplesWithAnchor(
        hkType as Parameters<typeof hk.queryQuantitySamplesWithAnchor>[0],
        {
          limit: 500,
          anchor: lastAnchor ?? undefined,
        } as Parameters<typeof hk.queryQuantitySamplesWithAnchor>[1],
      );

      if (response.newAnchor) {
        setSyncCursor(cursorKey, type, response.newAnchor);
      }

      const sensorSamples: SensorSample[] = [];
      for (const s of response.samples) {
        const sensorSample = this.convertToSensorSample(s, type);
        if (sensorSample) {
          this.persistAndPublish(sensorSample, getEventBus());
          sensorSamples.push(sensorSample);
        }
      }
      return sensorSamples;
    } catch (err) {
      console.warn(`[AppleHealthSource] incremental sync failed for ${type}:`, err);
      return [];
    }
  }

  async initialCatchUpSync(daysBack = 14): Promise<void> {
    const since = new Date();
    since.setDate(since.getDate() - daysBack);

    for (const type of this.types) {
      const cursorKey = 'apple-health';
      const lastAnchor = getSyncCursor(cursorKey, type);
      if (lastAnchor) {
        await this.incrementalSync(type);
      } else {
        const samples = await this.query([type], since);
        const bus = getEventBus();
        for (const s of samples) {
          this.persistAndPublish(s, bus);
        }
        const hk = await getHealthKitModule();
        if (!hk) continue;
        const hkType = HK_TYPE_BY_SAMPLE_TYPE[type];
        if (!hkType) continue;
        try {
          const response = await hk.queryQuantitySamplesWithAnchor(
            hkType as Parameters<typeof hk.queryQuantitySamplesWithAnchor>[0],
            { limit: 0 } as Parameters<typeof hk.queryQuantitySamplesWithAnchor>[1],
          );
          if (response.newAnchor) {
            setSyncCursor(cursorKey, type, response.newAnchor);
          }
        } catch (err) {
          console.warn(`[AppleHealthSource] anchor init failed for ${type}:`, err);
        }
      }
    }

    if (!this.watchSourceId) {
      await this.captureWatchDeviceId();
    }
  }

  async checkSpO2Availability(): Promise<boolean> {
    const hk = await getHealthKitModule();
    if (!hk) return false;
    try {
      const sample = await hk.getMostRecentQuantitySample(
        'HKQuantityTypeIdentifierOxygenSaturation' as Parameters<typeof hk.getMostRecentQuantitySample>[0],
      );
      return sample !== null && sample !== undefined;
    } catch {
      return false;
    }
  }

  private async captureWatchDeviceId(): Promise<void> {
    const hk = await getHealthKitModule();
    if (!hk) return;

    try {
      const samples = await hk.queryQuantitySamples(
        'HKQuantityTypeIdentifierHeartRate' as Parameters<typeof hk.queryQuantitySamples>[0],
        { limit: 10 } as Parameters<typeof hk.queryQuantitySamples>[1],
      );
      for (const s of samples) {
        const sourceName = s.sourceRevision?.source?.name ?? '';
        const deviceName = s.device?.name ?? '';
        const localId = s.device?.localIdentifier ?? '';
        if (
          sourceName.toLowerCase().includes('apple watch') ||
          deviceName.toLowerCase().includes('apple watch') ||
          (sourceName && !sourceName.toLowerCase().includes('iphone'))
        ) {
          this.watchSourceId = localId || s.uuid;
          this.watchSourceName = deviceName || sourceName;
          const wearable = getPrimaryWearableForPatient(this.patientId);
          if (wearable) {
            setWearableHealthKitSource(wearable.deviceId, this.watchSourceId, this.watchSourceName);
          }
          console.log(`[AppleHealthSource] Captured watch device: ${this.watchSourceName} (${this.watchSourceId})`);
          return;
        }
      }
      console.warn('[AppleHealthSource] Could not identify Apple Watch device from samples');
    } catch (err) {
      console.warn('[AppleHealthSource] captureWatchDeviceId failed:', err);
    }
  }

  private convertToSensorSample(
    hkSample: { quantity: number; unit: string; startDate: Date; endDate: Date; uuid: string; sourceRevision?: { source?: { name: string; bundleIdentifier: string } }; device?: { name?: string; localIdentifier?: string } },
    type: HealthSampleType,
  ): SensorSample | null {
    const quantity = hkSample.quantity;
    if (quantity == null) return null;

    let value = quantity;
    let unit = hkSample.unit ?? UNIT_BY_SAMPLE_TYPE[type];

    if (type === 'spo2' && value <= 1.0) {
      value = value * 100;
      unit = '%';
    }

    const startDate = hkSample.startDate.toISOString();
    const sourceName = hkSample.sourceRevision?.source?.name ?? 'unknown';
    const sampleId = `apple-health-${type}-${startDate}-${sourceName}`;

    return {
      source: 'apple-health',
      type,
      value,
      unit,
      recordedAt: startDate,
      receivedAt: new Date().toISOString(),
      patientId: this.patientId,
      sampleId,
      metadataJson: JSON.stringify({
        hkSource: sourceName,
        hkDevice: hkSample.device?.localIdentifier,
        hkUuid: hkSample.uuid,
      }),
    };
  }

  private persistAndPublish(
    sample: SensorSample,
    bus: ReturnType<typeof getEventBus>,
  ): void {
    const healthSample: HealthSample = {
      sampleId: sample.sampleId,
      patientId: sample.patientId,
      source: 'apple-health',
      type: sample.type,
      value: typeof sample.value === 'number' ? sample.value : 0,
      valueJson: typeof sample.value === 'number' ? undefined : JSON.stringify(sample.value),
      unit: sample.unit,
      recordedAt: sample.recordedAt,
      receivedAt: sample.receivedAt,
      metadataJson: sample.metadataJson,
    };
    insertHealthSample(healthSample);

    const scalar = typeof sample.value === 'number' ? sample.value : 0;
    const event: Extract<OrchestrationEvent, { type: 'vitals_sample' }> = {
      type: 'vitals_sample',
      patientId: sample.patientId,
      sampleId: sample.sampleId,
      sampleType: sample.type,
      value: scalar,
      unit: sample.unit,
      recordedAt: sample.recordedAt,
      source: 'apple-health',
      receivedAt: sample.receivedAt,
    };
    bus.publish(event);
  }
}

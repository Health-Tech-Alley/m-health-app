import { Platform } from 'react-native';

import { getEventBus } from '@/orchestration/event-bus';
import type { OrchestrationEvent } from '@/orchestration/events';
import { dispatchInChunks, runInBackground } from '@/utils/commonFunctions';

import {
  getSyncCursor,
  insertHealthSample,
  setSyncCursor,
} from '../repositories/healthSampleRepository';
import {
  getPrimaryWearableForPatient,
  setWearableHealthKitSource,
} from '../repositories/wearableDeviceRepository';
import type { HealthSample, HealthSampleType } from '../types';
import {
  ALL_HEALTHKIT_READ_TYPES,
  HK_TYPE_BY_SAMPLE_TYPE,
  UNIT_BY_SAMPLE_TYPE,
} from './healthkit-type-map';
import type { PermissionResult, SensorSample, SensorSource } from './sensor-source';

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

  /**
 * Primes the sync anchor to "now" for each type, without pulling any
 * historical samples. After this, incrementalSync only sees samples
 * recorded from this point forward — no backfill, no crawling through
 * years of history.
 */
async primeAnchorsToNow(): Promise<void> {
  const hk = await getHealthKitModule();
  if (!hk) return;

  for (const type of this.types) {
    const cursorKey = 'apple-health';
    const existingAnchor = getSyncCursor(cursorKey, type);
    if (existingAnchor) continue; // already primed, don't reset

    const hkType = HK_TYPE_BY_SAMPLE_TYPE[type];
    if (!hkType) continue;

    try {
      const response = await hk.queryQuantitySamplesWithAnchor(
        hkType as Parameters<typeof hk.queryQuantitySamplesWithAnchor>[0],
        { limit: 0 } as Parameters<typeof hk.queryQuantitySamplesWithAnchor>[1], // limit 0 = anchor only, no data pulled
      );
      if (response.newAnchor) {
        setSyncCursor(cursorKey, type, response.newAnchor);
        console.log(`[AppleHealthSource] Primed anchor to now for ${type}`);
      }
    } catch (err) {
      console.warn(`[AppleHealthSource] anchor priming failed for ${type}:`, err);
    }
  }
}

  startPublishingToEventBus(): () => void {
    const bus = getEventBus();
    let unsubscribe: () => void = () => {};

    // Prime anchors to "now" BEFORE subscribing, so no incrementalSync call
    // can fire against an unprimed (null) anchor and crawl from history.
    void this.primeAnchorsToNow().then(() => {
      unsubscribe = this.subscribe(this.types, (sample) => {
        this.persistAndPublish(sample, bus);
      });
    });

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
        { limit: 10, anchor: lastAnchor ?? undefined } as Parameters<typeof hk.queryQuantitySamplesWithAnchor>[1],
      );

      if (response.newAnchor) {
        setSyncCursor(cursorKey, type, response.newAnchor);
      }

      const sensorSamples: SensorSample[] = [];
      for (const s of response.samples) {
        const sensorSample = this.convertToSensorSample(s, type);
        if (sensorSample) sensorSamples.push(sensorSample);
      }

      console.log(`[AppleHealthSource] incremental sync for ${type} returned ${sensorSamples.length} samples`);

      if (sensorSamples.length > 0) {
        const readings = sensorSamples.map((sample) => ({
          patientId: sample.patientId,
          sampleId: sample.sampleId,
          type: sample.type,
          value: typeof sample.value === 'number' ? sample.value : 0,
          unit: sample.unit,
          source: sample.source,
          recordedAt: sample.recordedAt,
          receivedAt: sample.receivedAt,
        }));

        // Defer the Redux dispatch + bus publish so they don't block the
        // current frame/interaction. Chunked so even a full 500-sample
        // batch doesn't lock up the JS thread in one go.
        runInBackground(async () => {
          await dispatchInChunks(readings);

          const bus = getEventBus();
          for (const sample of sensorSamples) {
            this.publishVitalsEvent(sample, bus);
          }
        });
      }

      return sensorSamples;
    } catch (err) {
      console.warn(`[AppleHealthSource] incremental sync failed for ${type}:`, err);
      return [];
    }
  }

  private publishVitalsEvent(
    sample: SensorSample,
    bus: ReturnType<typeof getEventBus>,
  ): void {
    console.log('[AppleHealthSource] Publishing to bus instance:', bus);
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

  async initialCatchUpSync(daysBack = 1): Promise<void> {
    const since = new Date();
    since.setDate(since.getDate() - daysBack);
    console.log(`[AppleHealthSource] Performing initial catch-up sync for ${daysBack} days back since ${since.toISOString()}`);

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
    console.log(`[AppleHealthSource] Persisting sample: ${JSON.stringify(healthSample)}`);
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

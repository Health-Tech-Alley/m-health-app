import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { usePatientRecord } from '@/contexts/patient-record-context';
import { useSettings } from '@/contexts/settings-context';
import type { SensorSource } from '@/data/sensors';
import { ALL_HEALTHKIT_READ_TYPES, createSensorSource } from '@/data/sensors';

export type SensorConnectionStatus =
  | 'available'
  | 'checking'
  | 'disconnected'
  | 'unavailable'
  | 'unsupported';

interface SensorContextValue {
  sensor: SensorSource | null;
  isRealHealth: boolean;
  status: SensorConnectionStatus;
  unavailableReason: string | null;
}

const SensorContext = createContext<SensorContextValue | null>(null);

type SensorAvailabilityResolution = {
  sensor: SensorSource;
  status: 'available' | 'unavailable';
  unavailableReason: string | null;
};

export function SensorProvider({ children }: { children: ReactNode }) {
  const { patientId } = usePatientRecord();
  const { settings } = useSettings();
  const healthKitEnabled = settings.healthKitIntegrationEnabled !== false;
  const stopPublishingRef = useRef<(() => void) | null>(null);
  const [availabilityResolution, setAvailabilityResolution] =
    useState<SensorAvailabilityResolution | null>(null);

  const sensor = useMemo<SensorSource | null>(() => {
    if (!patientId) return null;
    // When HealthKit integration is off, do not open the native bridge or poll.
    if (!healthKitEnabled) return null;
    return createSensorSource({ patientId });
  }, [patientId, healthKitEnabled]);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const baseAvailability = useMemo((): Pick<SensorContextValue, 'status' | 'unavailableReason'> => {
    if (!patientId) {
      return {
        status: 'disconnected',
        unavailableReason: 'No active patient selected.',
      };
    }

    if (!healthKitEnabled) {
      return {
        status: 'unavailable',
        unavailableReason: 'Apple Health integration is turned off in Preferences.',
      };
    }

    if (!sensor) {
      return {
        status: 'unsupported',
        unavailableReason: 'No supported sensor source is available on this platform.',
      };
    }

    if (!sensor.isAvailable()) {
      return {
        status: 'unavailable',
        unavailableReason: 'The configured sensor source is unavailable.',
      };
    }

    return {
      status: 'checking',
      unavailableReason: null,
    };
  }, [patientId, sensor, healthKitEnabled]);

  const resolvedAvailability =
    baseAvailability.status === 'checking' && availabilityResolution?.sensor === sensor
      ? availabilityResolution
      : baseAvailability;
  const status = resolvedAvailability.status;
  const unavailableReason = resolvedAvailability.unavailableReason;
  const isRealHealth = status === 'available' && sensor?.constructor.name === 'AppleHealthSource';

  useEffect(() => {
    let cancelled = false;

    if (!patientId || !sensor || !sensor.isAvailable()) {
      return () => {
        cancelled = true;
      };
    }

    const resolveAvailability = (
      healthDataAvailable: boolean,
      unavailableReasonOverride?: string,
    ) => {
      if (cancelled) return;
      setAvailabilityResolution({
        sensor,
        status: healthDataAvailable ? 'available' : 'unavailable',
        unavailableReason: healthDataAvailable
          ? null
          : unavailableReasonOverride ?? 'The configured sensor source is unavailable.',
      });
    };

    if (hasHealthDataAvailabilityCheck(sensor)) {
      void sensor
        .isHealthDataAvailable()
        .then((healthDataAvailable) => {
          resolveAvailability(
            healthDataAvailable,
            'Apple Health data is unavailable in this build or on this device.',
          );
        })
        .catch(() => {
          resolveAvailability(
            false,
            'Apple Health data is unavailable in this build or on this device.',
          );
        });
    } else {
      void Promise.resolve().then(() => resolveAvailability(true));
    }

    return () => {
      cancelled = true;
    };
  }, [patientId, sensor]);

  useEffect(() => {
    if (!sensor || status !== 'available') return;

    // if (sensor.constructor.name === 'AppleHealthSource') {
    //   for (const type of ALL_HEALTHKIT_READ_TYPES) {
    //     clearSyncCursor('apple-health', type);
    //   }
    //   console.log('[DEBUG] Cleared all apple-health sync cursors');
    // }

    const startIfForeground = (state: AppStateStatus) => {
      if (state === 'active') {
        if (sensor.startPublishingToEventBus && !stopPublishingRef.current) {
          stopPublishingRef.current = sensor.startPublishingToEventBus();
        }
        if (!pollIntervalRef.current && sensor.constructor.name === 'AppleHealthSource') {
          pollIntervalRef.current = setInterval(() => {
            console.log('[DEBUG] == Polling Apple Health for incremental sync every minute ===');
            for (const type of ALL_HEALTHKIT_READ_TYPES) {
              void (sensor as any).incrementalSync?.(type);
            }
          }, 1 * 60 * 1000); // poll every minute while foregrounded
        }
      } else {
        if (stopPublishingRef.current) {
          stopPublishingRef.current();
          stopPublishingRef.current = null;
        }
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      }
    };

    startIfForeground(AppState.currentState);

    const subscription = AppState.addEventListener('change', startIfForeground);

    return () => {
      subscription.remove();
      if (stopPublishingRef.current) {
        stopPublishingRef.current();
        stopPublishingRef.current = null;
      }
    };
  }, [sensor, status]);

  return (
    <SensorContext.Provider value={{ sensor, isRealHealth, status, unavailableReason }}>
      {children}
    </SensorContext.Provider>
  );
}

export function useSensor(): SensorContextValue {
  const ctx = useContext(SensorContext);
  if (!ctx) {
    throw new Error('useSensor must be used within a SensorProvider');
  }
  return ctx;
}

function hasHealthDataAvailabilityCheck(
  sensor: SensorSource,
): sensor is SensorSource & { isHealthDataAvailable(): Promise<boolean> } {
  return (
    'isHealthDataAvailable' in sensor &&
    typeof sensor.isHealthDataAvailable === 'function'
  );
}

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { usePatientRecord } from '@/contexts/patient-record-context';
import type { SensorSource } from '@/data/sensors';
import { ALL_HEALTHKIT_READ_TYPES, createSensorSource } from '@/data/sensors';

interface SensorContextValue {
  sensor: SensorSource | null;
  isRealHealth: boolean;
}

const SensorContext = createContext<SensorContextValue | null>(null);

export function SensorProvider({ children }: { children: ReactNode }) {
  const { patientId } = usePatientRecord();
  const stopPublishingRef = useRef<(() => void) | null>(null);

  const sensor = useMemo<SensorSource | null>(() => {
    if (!patientId) return null;
    return createSensorSource({ patientId });
  }, [patientId]);

  const isRealHealth = sensor?.constructor.name === 'AppleHealthSource';
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!sensor) return;

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
          console.log('[DEBUG] == Polling Apple Health for incremental sync of 5 minutes ===');
          for (const type of ALL_HEALTHKIT_READ_TYPES ?? []) {
            void (sensor as any).incrementalSync?.(type);
          }
        }, 1 * 60 * 1000); // poll every 5 minute while foregrounded
      }
    } else {
      stopPublishingRef.current?.();
      stopPublishingRef.current = null;
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
  }, [sensor]);

  return (
    <SensorContext.Provider value={{ sensor, isRealHealth }}>
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

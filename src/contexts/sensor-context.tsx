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
import { createSensorSource } from '@/data/sensors';
import type { SensorSource } from '@/data/sensors';

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

  useEffect(() => {
    if (!sensor) return;

    const startIfForeground = (state: AppStateStatus) => {
      if (state === 'active') {
        if (sensor.startPublishingToEventBus && !stopPublishingRef.current) {
          stopPublishingRef.current = sensor.startPublishingToEventBus();
        }
      } else {
        if (stopPublishingRef.current) {
          stopPublishingRef.current();
          stopPublishingRef.current = null;
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

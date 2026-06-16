/**
 * Orchestrator provider.
 *
 * Creates a single Orchestrator instance at app start and seeds the local
 * database from the onboarding profile. The orchestrator is the only
 * component that should call L4–L7 on behalf of the UI.
 */

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';

import { useSLM } from '@/contexts/slm-context';
import type { FusedRetriever } from '@/knowledge';
import { TrackAFusedRetriever } from '@/knowledge';
import { Orchestrator, TOOL_SCHEMAS } from '@/orchestration';
import { MockAlertAutoencoder } from '@/ml-models/alert-autoencoder';
import { getOnboardingProfile } from '@/services/onboarding/onboardingService';
import { seedDatabaseFromProfile } from '@/data/seed/seedFromProfile';

interface OrchestratorContextValue {
  orchestrator: Orchestrator | null;
  patientId: string;
  ready: boolean;
}

const OrchestratorContext = createContext<OrchestratorContextValue | null>(null);

export function OrchestratorProvider({ children }: { children: ReactNode }) {
  const slm = useSLM();
  const sensorStopRef = useRef<(() => void) | null>(null);
  const { orchestrator, patientId } = useMemo(() => {
    const profile = getOnboardingProfile();
    const seededPatientId = seedDatabaseFromProfile(profile);

    const retriever: FusedRetriever = new TrackAFusedRetriever({
      tools: TOOL_SCHEMAS.map((t) => ({
        name: t.name,
        description: t.description,
        params: Object.fromEntries(
          Object.entries(t.params).map(([name, p]) => [name, { type: p.type, required: p.required ?? false }]),
        ),
      })),
      patientName: profile.patient.name,
      patientConditions: profile.patient.conditions.split(',').map((c) => c.trim()).filter(Boolean),
      activeMeds: (profile.patient.currentMedications ?? '')
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean),
      spo2Cutoff: profile.patient.spo2Cutoff,
    });

    const alertMl = new MockAlertAutoencoder();
    const orchestrator = new Orchestrator({ slm: slm.provider, retriever, alertMl });
    return { orchestrator, patientId: seededPatientId };
  }, [slm]);

  useEffect(() => {
    // Mock sensor is disabled by default to avoid creating noise.
    // Use the Acute Anomaly screen's "Send vitals" button to manually trigger events.
    // To enable automatic mock sensor, uncomment the lines below:
    // const sensor = createSensorSource({ patientId, forceMock: true });
    // const stopFn = sensor.startPublishingToEventBus?.() ?? null;
    // sensorStopRef.current = stopFn;

    return () => {
      const stopFn = sensorStopRef.current;
      stopFn?.();
      orchestrator.dispose();
    };
  }, [orchestrator, patientId]);

  return (
    <OrchestratorContext.Provider value={{ orchestrator, patientId, ready: true }}>
      {children}
    </OrchestratorContext.Provider>
  );
}

export function useOrchestrator(): Orchestrator {
  const ctx = useContext(OrchestratorContext);
  if (!ctx || !ctx.orchestrator) {
    throw new Error('useOrchestrator must be used within an OrchestratorProvider');
  }
  return ctx.orchestrator;
}

export function useOrchestratorPatientId(): string {
  const ctx = useContext(OrchestratorContext);
  if (!ctx) {
    throw new Error('useOrchestratorPatientId must be used within an OrchestratorProvider');
  }
  return ctx.patientId;
}

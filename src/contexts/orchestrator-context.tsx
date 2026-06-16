/**
 * Orchestrator provider.
 *
 * Creates a single Orchestrator instance at app start and seeds the local
 * database from the onboarding profile. The orchestrator is the only
 * component that should call L4–L7 on behalf of the UI.
 */

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';

import { useSLM } from '@/contexts/slm-context';
import type { FusedRetriever } from '@/knowledge';
import { TrackAFusedRetriever } from '@/knowledge';
import { Orchestrator } from '@/orchestration';
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
  const { orchestrator, patientId } = useMemo(() => {
    const profile = getOnboardingProfile();
    const seededPatientId = seedDatabaseFromProfile(profile);

    const retriever: FusedRetriever = new TrackAFusedRetriever({
      tools: [
        {
          name: 'get_patient_profile',
          description: 'Read the patient profile including conditions, meds, and baseline vitals.',
          params: { patientId: { type: 'string', required: true } },
        },
        {
          name: 'get_recent_vitals',
          description: 'Read recent vital samples for a patient and vital type.',
          params: {
            patientId: { type: 'string', required: true },
            vitalType: { type: 'string', required: true },
            hours: { type: 'number', required: true },
          },
        },
        {
          name: 'get_active_thresholds',
          description: 'Read active alert thresholds for a patient.',
          params: { patientId: { type: 'string', required: true } },
        },
        {
          name: 'log_observation',
          description: 'Record a caregiver observation tied to an alert.',
          params: {
            alertId: { type: 'string', required: true },
            observation: { type: 'string', required: true },
          },
        },
      ],
      patientName: profile.patient.name,
      patientConditions: profile.patient.conditions.split(',').map((c) => c.trim()).filter(Boolean),
      activeMeds: (profile.patient.currentMedications ?? '')
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean),
      spo2Cutoff: profile.patient.spo2Cutoff,
    });

    const orchestrator = new Orchestrator({ slm: slm.provider, retriever });
    return { orchestrator, patientId: seededPatientId };
  }, [slm]);

  useEffect(() => {
    return () => {
      orchestrator.dispose();
    };
  }, [orchestrator]);

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

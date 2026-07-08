/**
 * Orchestrator provider.
 *
 * Creates a single Orchestrator instance at app start. The patient record is
 * seeded by PatientRecordProvider (a parent), which also exposes the
 * denormalized snapshot used here to build the retriever's condition list.
 * The orchestrator is the only component that should call L4–L7 on behalf
 * of the UI.
 *
 * Per planning/32 §9 (D8), wires the priorDecisionsProvider from the live
 * Redux store so the orchestrator's SLM prompts include the last few
 * caregiver actions + the current non-emergency decision.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useStore } from 'react-redux';

import { useSLM } from '@/contexts/slm-context';
import { usePatientRecord, getCurrentPatientSnapshot } from '@/contexts/patient-record-context';
import type { FusedRetriever } from '@/knowledge';
import { CachedFusedRetriever } from '@/knowledge';
import { Orchestrator, TOOL_SCHEMAS } from '@/orchestration';
import { MockAlertAutoencoder } from '@/ml-models/alert-autoencoder';
import { makePriorDecisionsProvider } from '@/store/selectors/priorDecisionsSelector';
import type { RootState } from '@/store';

interface OrchestratorContextValue {
  orchestrator: Orchestrator | null;
  retriever: FusedRetriever | null;
  patientId: string;
  ready: boolean;
}

const OrchestratorContext = createContext<OrchestratorContextValue | null>(null);

export function OrchestratorProvider({ children }: { children: ReactNode }) {
  const slm = useSLM();
  const { snapshot, patientId } = usePatientRecord();
  const sensorStopRef = useRef<(() => void) | null>(null);
  // useStore() is stable across renders. Build the priorDecisionsProvider
  // inline — the orchestrator calls it on each `explainAlert` so the closure
  // always reads the freshest Redux state without us having to recreate the
  // orchestrator on every dispatch.
  const store = useStore<RootState>();
  const priorDecisionsProvider = useCallback(
    (args: { patientId: string; alertId?: string }) => {
      // Reading `store` here is safe: useStore() returns the same store
      // reference across renders, and this callback only fires on user
      // interaction (Explain button), not during render.
      return makePriorDecisionsProvider(() => store.getState())(args);
    },
    [store],
  );

  const retriever = useMemo<FusedRetriever | null>(() => {
    if (!snapshot || !patientId) return null;
    const conditionNames = snapshot.conditions
      .filter((c) => !c.needsReview)
      .map((c) => c.name);
    const activeMeds = snapshot.medications.map((m) => m.name);
    return new CachedFusedRetriever({
      tools: TOOL_SCHEMAS.map((t) => ({
        name: t.name,
        description: t.description,
        params: Object.fromEntries(
          Object.entries(t.params).map(([name, p]) => [name, { type: p.type, required: p.required ?? false }]),
        ),
      })),
      patientName: snapshot.patient?.name ?? 'Unknown',
      patientConditions: conditionNames,
      activeMeds,
      spo2Cutoff: snapshot.patient?.spo2Cutoff,
      patientId,
    });
  }, [snapshot, patientId]);

  const orchestrator = useMemo(() => {
    if (!retriever) {
      return null;
    }

    const alertMl = new MockAlertAutoencoder();
    return new Orchestrator({
      slm: slm.provider,
      slmTasks: slm.taskQueue,
      retriever,
      alertMl,
      snapshotProvider: getCurrentPatientSnapshot,
      priorDecisionsProvider,
    });
  }, [slm, retriever, priorDecisionsProvider]);

  useEffect(() => {
    if (!orchestrator) return;
    return () => {
      const stopFn = sensorStopRef.current;
      stopFn?.();
      orchestrator.dispose();
    };
  }, [orchestrator]);

  return (
    <OrchestratorContext.Provider value={{ orchestrator, retriever, patientId: patientId ?? '', ready: orchestrator !== null }}>
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

export function useOrchestratorRetriever(): FusedRetriever | null {
  const ctx = useContext(OrchestratorContext);
  if (!ctx) {
    throw new Error('useOrchestratorRetriever must be used within an OrchestratorProvider');
  }
  return ctx.retriever;
}

export function useOrchestratorSafe(): Orchestrator | null {
  const ctx = useContext(OrchestratorContext);
  return ctx?.orchestrator ?? null;
}

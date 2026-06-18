/**
 * Orchestrator provider.
 *
 * Creates a single Orchestrator instance at app start. The patient record is
 * seeded by PatientRecordProvider (a parent), which also exposes the
 * denormalized snapshot used here to build the retriever's condition list.
 * The orchestrator is the only component that should call L4–L7 on behalf
 * of the UI.
 */

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';

import { useSLM } from '@/contexts/slm-context';
import { usePatientRecord, getCurrentPatientSnapshot } from '@/contexts/patient-record-context';
import type { FusedRetriever } from '@/knowledge';
import { CachedFusedRetriever } from '@/knowledge';
import { Orchestrator, TOOL_SCHEMAS } from '@/orchestration';
import { MockAlertAutoencoder } from '@/ml-models/alert-autoencoder';

interface OrchestratorContextValue {
  orchestrator: Orchestrator | null;
  patientId: string;
  ready: boolean;
}

const OrchestratorContext = createContext<OrchestratorContextValue | null>(null);

export function OrchestratorProvider({ children }: { children: ReactNode }) {
  const slm = useSLM();
  const { snapshot, patientId } = usePatientRecord();
  const sensorStopRef = useRef<(() => void) | null>(null);

  const orchestrator = useMemo(() => {
    if (!snapshot || !patientId) {
      return null;
    }

    // Build condition list from structured conditions (ICD-10 codes preferred).
    const conditionNames = snapshot.conditions
      .filter((c) => !c.needsReview)
      .map((c) => c.name);

    const activeMeds = snapshot.medications.map((m) => m.name);

    const retriever: FusedRetriever = new CachedFusedRetriever({
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
      patientId, // enables live supplement queries
    });

    const alertMl = new MockAlertAutoencoder();
    // The orchestrator reads the latest snapshot on-demand via the module-level
    // accessor, so it isn't recreated on every store update (e.g. confirming a
    // pending condition). The retriever's condition list is built from the
    // initial snapshot; Phase 3's CachedFusedRetriever will rebuild dynamically.
    return new Orchestrator({
      slm: slm.provider,
      slmTasks: slm.taskQueue,
      retriever,
      alertMl,
      snapshotProvider: getCurrentPatientSnapshot,
    });
  }, [slm, snapshot, patientId]);

  useEffect(() => {
    if (!orchestrator) return;
    return () => {
      const stopFn = sensorStopRef.current;
      stopFn?.();
      orchestrator.dispose();
    };
  }, [orchestrator]);

  return (
    <OrchestratorContext.Provider value={{ orchestrator, patientId: patientId ?? '', ready: orchestrator !== null }}>
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

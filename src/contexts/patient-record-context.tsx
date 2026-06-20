/**
 * PatientRecordStore — the single source of truth for the patient's EHR.
 *
 * Sits above OrchestratorProvider in _layout.tsx. Reads a denormalized
 * snapshot of the patient record (patient, caregiver, structured conditions
 * with ICD codes + comorbidity flags, symptoms, wearable, medications,
 * thresholds, care plan goals, knowledge-cache stats, enrichment stats) from
 * SQLite via `getPatientRecordSnapshot`.
 *
 * UI screens consume `usePatientRecord()` — they never call repositories
 * directly. The orchestrator's `buildAggregatedContext` and the SLM's
 * `buildCaregiverSystemContext` both read from this store so the SLM and the
 * UI always see the same point-in-time view.
 *
 * Writes go through store mutators → repositories → SQLite → store
 * broadcasts a new snapshot. The event bus still carries transient events
 * (vitals, alerts); persistent state lives here.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import {
  seedDatabaseFromProfile,
  getPatientRecordSnapshot,
  setBundlePending,
  type PatientRecordSnapshot,
} from '@/data';
import { getOnboardingProfile } from '@/services/onboarding/onboardingService';

// ---------------------------------------------------------------------------
// Module-level store — useSyncExternalStore reads from here.
// ---------------------------------------------------------------------------

let currentSnapshot: PatientRecordSnapshot | null = null;
let currentPatientId: string | null = null;
let activeProviderToken: symbol | null = null;
const listeners = new Set<() => void>();

function loadSnapshot(patientId: string): PatientRecordSnapshot {
  return getPatientRecordSnapshot(patientId);
}

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): PatientRecordSnapshot | null {
  return currentSnapshot;
}

/**
 * Read the current patient record snapshot without subscribing to updates.
 * Used by the orchestrator's `snapshotProvider` so it can read the latest
 * structured conditions on-demand without being recreated on every store
 * update.
 */
export function getCurrentPatientSnapshot(): PatientRecordSnapshot | null {
  return currentSnapshot;
}

/** Internal: set the patientId and load the initial snapshot. */
function setPatientId(patientId: string): void {
  const nextSnapshot = loadSnapshot(patientId);
  currentPatientId = patientId;
  currentSnapshot = nextSnapshot;
  emitChange();
}

/** Re-read the snapshot from SQLite and broadcast. Called after any write. */
export function refreshPatientRecord(): void {
  if (!currentPatientId) return;
  currentSnapshot = loadSnapshot(currentPatientId);
  emitChange();
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface PatientRecordContextValue {
  /** The denormalized patient record snapshot. Null until seeding completes. */
  snapshot: PatientRecordSnapshot | null;
  patientId: string | null;
  ready: boolean;
  error: Error | null;
  /** Re-read the snapshot from SQLite. Call after any repository write. */
  refresh: () => void;
  /** Mark the clinical-condition bundle as pending / completed. */
  setBundlePending: (pending: boolean) => void;
}

const PatientRecordContext = createContext<PatientRecordContextValue | null>(null);

interface PatientRecordInitState {
  patientId: string | null;
  error: Error | null;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function initializePatientRecord(): PatientRecordInitState {
  try {
    const profile = getOnboardingProfile();
    const seededId = seedDatabaseFromProfile(profile);
    setPatientId(seededId);
    return { patientId: seededId, error: null };
  } catch (error) {
    currentSnapshot = null;
    currentPatientId = null;
    emitChange();
    return { patientId: null, error: toError(error) };
  }
}

export function PatientRecordProvider({ children }: { children: ReactNode }) {
  const [providerToken] = useState(() => Symbol('PatientRecordProvider'));

  // Seed the DB from the onboarding profile synchronously on first render so
  // that OrchestratorProvider (a child) can read the snapshot during its own
  // render. seedDatabaseFromProfile is fully synchronous (expo-sqlite sync API).
  const [initState, setInitState] = useState<PatientRecordInitState>(() => {
    activeProviderToken = providerToken;
    return initializePatientRecord();
  });
  const { patientId, error } = initState;

  useEffect(() => {
    activeProviderToken = providerToken;
    if (patientId && (!currentPatientId || currentPatientId !== patientId || !currentSnapshot)) {
      try {
        setPatientId(patientId);
      } catch {
        currentSnapshot = null;
        currentPatientId = null;
        emitChange();
      }
    }

    return () => {
      if (activeProviderToken !== providerToken) return;
      // Reset module store on unmount (mainly for tests / hot reloads).
      currentSnapshot = null;
      currentPatientId = null;
      activeProviderToken = null;
      listeners.clear();
    };
  }, [patientId, providerToken]);

  const refresh = useCallback(() => {
    try {
      if (!patientId) {
        setInitState(initializePatientRecord());
        return;
      }
      refreshPatientRecord();
      setInitState({ patientId, error: null });
    } catch (nextError) {
      setInitState({ patientId, error: toError(nextError) });
    }
  }, [patientId]);

  const setBundlePendingFlag = useCallback((pending: boolean) => {
    if (!patientId) return;
    setBundlePending(patientId, pending);
    refresh();
  }, [patientId, refresh]);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Retry the condition bundle on launch only when the previous run FAILED
  // (e.g. no connectivity at onboarding). The initial in-flight state is set
  // by seedFromProfile, which already kicks off the first run — we must not
  // duplicate it. Retry at most once per mount. See plan §13.7.
  const retryAttemptedRef = useRef(false);
  useEffect(() => {
    if (!patientId || retryAttemptedRef.current) return;
    if (snapshot?.bundleStatus?.state !== 'failed') return;
    retryAttemptedRef.current = true;
    void import('@/clinical-evidence/condition-bundler').then(({ bundleConditionPack }) => {
      void bundleConditionPack(patientId).catch((err) => {
        console.error('[PatientRecordProvider] Bundle retry failed:', err);
      });
    }).catch(() => {
      // clinical-evidence module not available — graceful.
    });
  }, [patientId, snapshot?.bundleStatus?.state]);

  const value = useMemo<PatientRecordContextValue>(
    () => ({
      snapshot,
      patientId,
      ready: true,
      error,
      refresh,
      setBundlePending: setBundlePendingFlag,
    }),
    [snapshot, patientId, error, refresh, setBundlePendingFlag],
  );

  return (
    <PatientRecordContext.Provider value={value}>
      {children}
    </PatientRecordContext.Provider>
  );
}

export function usePatientRecord(): PatientRecordContextValue {
  const ctx = useContext(PatientRecordContext);
  if (!ctx) {
    throw new Error('usePatientRecord must be used within a PatientRecordProvider');
  }
  return ctx;
}

/**
 * Convenience hook for components that only need the snapshot.
 * Throws if the store is not ready yet — guard with `ready` from
 * `usePatientRecord()` if you need a loading state.
 */
export function usePatientRecordSnapshot(): PatientRecordSnapshot {
  const { snapshot, ready } = usePatientRecord();
  if (!ready || !snapshot) {
    throw new Error('PatientRecordStore is not ready yet — guard with ready flag');
  }
  return snapshot;
}

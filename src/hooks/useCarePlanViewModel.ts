/**
 * React hook for the Care tab view-model (planning/41 §7).
 *
 * The snapshot is the source of truth (per AGENTS.md state authority). The
 * view-model is a service-layer read-only assembly that augments the
 * snapshot with repo-level reads (active ADCP revision, decision log) and
 * the current `carePlanMode`.
 *
 * The settings dependency is captured by `useAppSettingsVersion` so the
 * caller re-derives the VM when the user toggles the read-only switch.
 */

import { useMemo } from 'react';

import { buildCarePlanViewModel, type CarePlanViewModel } from '@/services/carePlan/carePlanViewModel';
import { useSettings } from '@/contexts/settings-context';
import { usePatientRecord } from '@/contexts/patient-record-context';

export function useCarePlanViewModel(): {
  vm: CarePlanViewModel;
  patientId: string | null;
  refresh: () => void;
} {
  const { snapshot, patientId, refresh } = usePatientRecord();
  // The settings object is the React-side dep for the read-only toggle;
  // settings-context already memoizes the object so a stable object
  // means no re-render.
  const { settings } = useSettings();
  const mode = settings.carePlanMode;
  const vm = useMemo(
    () => buildCarePlanViewModel(snapshot),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot + mode
    [snapshot, patientId, mode],
  );
  return { vm, patientId, refresh };
}

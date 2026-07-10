/**
 * Reactive active-alert hook.
 *
 * Returns the highest-severity open alert for the patient and re-queries
 * whenever an alert-affecting event flows on the bus (`ml_alert_created`,
 * `vitals_sample`, `caregiver_override`), so the Dashboard / Care cards
 * live-refresh when alerts are created, acknowledged, or resolved — without
 * a manual pull-to-refresh.
 *
 * This is the single source of truth for "the active alert"; the old demo
 * fallback in `active-alert-context.tsx` is superseded by it.
 */
import { useEffect, useState } from 'react';

import { getActiveCareAlerts, type CareAlert } from '@/services/care/careService';
import { getEventBus } from '@/orchestration/event-bus';

export function useActiveAlert(patientId: string | null | undefined): CareAlert | null {
  const [alert, setAlert] = useState<CareAlert | null>(null);

  useEffect(() => {
    if (!patientId) {
      // Defer so setState happens outside the effect body.
      const clear = setTimeout(() => setAlert(null), 0);
      return () => clearTimeout(clear);
    }

    // Initial read (deferred so setState happens outside the effect body).
    const initial = setTimeout(() => {
      try {
        setAlert(getActiveCareAlerts(patientId)[0] ?? null);
      } catch {
        setAlert(null);
      }
    }, 0);

    const refresh = () => {
      try {
        setAlert(getActiveCareAlerts(patientId as string)[0] ?? null);
      } catch {
        // keep last known
      }
    };

    const bus = getEventBus();
    const unsubMl = bus.subscribe('ml_alert_created', refresh);
    const unsubVitals = bus.subscribe('vitals_sample', refresh);
    const unsubOverride = bus.subscribe('caregiver_override', refresh);

    return () => {
      clearTimeout(initial);
      unsubMl();
      unsubVitals();
      unsubOverride();
    };
  }, [patientId]);

  return alert;
}

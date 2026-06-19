/**
 * Critical-alert popup controller.
 *
 * Owns the severity-3 "active alert" popup lifecycle so it behaves as a
 * transient dialogue rather than a persistent card:
 *
 *   - Shows immediately as an overlay when a NEW severity-3 open alert
 *     appears (e.g. the ML care-analysis demo judges a scenario critical),
 *     regardless of which screen is mounted.
 *   - Re-shows whenever the Care tab gains focus, until the alert is
 *     Dismissed (permanently suppressed) or resolved/removed.
 *   - "Close" hides the popup for the current session; it reappears the next
 *     time the Care tab is opened.
 *   - "Dismiss" permanently suppresses the popup (status `dismissed`); the
 *     alert remains in the Dashboard alerts log as inactive and is retained
 *     for the audit trail.
 *
 * The popup is rendered by `CriticalAlertDialog` (mounted once at the root),
 * which consumes `useCriticalAlert()`. The Care tab calls
 * `reopenOnCareFocus()` from a `useFocusEffect` so the popup resurfaces.
 *
 * This replaces the old persistent `ActiveAlertCard` approach on the Care /
 * Dashboard tabs.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useOrchestratorPatientId } from '@/contexts/orchestrator-context';
import { getEventBus } from '@/orchestration/event-bus';
import { audit } from '@/services/audit/auditService';
import {
  dismissCareAlert,
  getActiveCareAlerts,
  type CareAlert,
} from '@/services/care/careService';

// Bus events can fire before the orchestrator finishes its async insertAlert
// (the orchestrator's vitals_sample handler is async). A short delay lets the
// alert row land in SQLite before we re-query.
const REFRESH_DELAY_MS = 250;

interface CriticalAlertContextValue {
  alert: CareAlert | null;
  visible: boolean;
  closeForSession: () => void;
  dismiss: (alertId: string) => void;
  reopenOnCareFocus: () => void;
}

const CriticalAlertContext = createContext<CriticalAlertContextValue | null>(null);

function pickCriticalAlert(patientId: string): CareAlert | null {
  try {
    const open = getActiveCareAlerts(patientId);
    return open.find((a) => a.severity === 3) ?? null;
  } catch {
    return null;
  }
}

export function CriticalAlertProvider({ children }: { children: ReactNode }) {
  const patientId = useOrchestratorPatientId();

  const [alert, setAlert] = useState<CareAlert | null>(null);
  const [visible, setVisible] = useState(false);

  // Alert ids the caregiver closed this session (popup hidden until the Care
  // tab is re-opened, which clears this set).
  const closedForSessionRef = useRef<Set<string>>(new Set());
  // The alert id we last observed, so we only auto-show on a *new* critical
  // alert (not on app launch with a pre-existing one).
  const knownIdRef = useRef<string | null>(null);

  const refresh = useCallback(() => {
    if (!patientId) {
      setAlert(null);
      return;
    }
    const next = pickCriticalAlert(patientId);
    setAlert(next);
  }, [patientId]);

  // Initial read + bus subscriptions. Deferred so setState happens outside
  // the effect body and so the orchestrator's async insert lands first.
  useEffect(() => {
    if (!patientId) {
      const clear = setTimeout(() => {
        setAlert(null);
        setVisible(false);
        knownIdRef.current = null;
      }, 0);
      return () => clearTimeout(clear);
    }

    const initial = setTimeout(() => {
      const next = pickCriticalAlert(patientId);
      setAlert(next);
      // Record the pre-existing id without showing the popup on app launch.
      knownIdRef.current = next?.alertId ?? null;
    }, 0);

    const deferredRefresh = () => {
      setTimeout(refresh, REFRESH_DELAY_MS);
    };

    const bus = getEventBus();
    const unsubMl = bus.subscribe('ml_alert_created', deferredRefresh);
    const unsubVitals = bus.subscribe('vitals_sample', deferredRefresh);
    const unsubOverride = bus.subscribe('caregiver_override', deferredRefresh);

    return () => {
      clearTimeout(initial);
      unsubMl();
      unsubVitals();
      unsubOverride();
    };
  }, [patientId, refresh]);

  // Show the popup when a NEW (not session-closed) critical alert arrives.
  // Deferred so setState happens outside the effect body.
  useEffect(() => {
    const t = setTimeout(() => {
      if (!alert) {
        setVisible(false);
        return;
      }
      if (closedForSessionRef.current.has(alert.alertId)) {
        setVisible(false);
        return;
      }
      if (alert.alertId !== knownIdRef.current) {
        knownIdRef.current = alert.alertId;
        setVisible(true);
      }
      // Same id as before: leave visibility as-is (e.g. stays hidden after
      // Close until the Care tab re-opens it).
    }, 0);
    return () => clearTimeout(t);
  }, [alert?.alertId]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeForSession = useCallback(() => {
    if (!alert) return;
    closedForSessionRef.current.add(alert.alertId);
    setVisible(false);
  }, [alert]);

  const dismiss = useCallback(
    (alertId: string) => {
      dismissCareAlert(alertId);
      audit({
        actor: 'caregiver',
        action: 'dismissed',
        resourceType: 'alert',
        resourceId: alertId,
        patientId: patientId || undefined,
        payload: { severity: alert?.severity ?? 3 },
      });
      closedForSessionRef.current.add(alertId);
      setVisible(false);
      // Re-read so the alert (now `dismissed`) drops out of the open set.
      refresh();
    },
    [alert, patientId, refresh],
  );

  const reopenOnCareFocus = useCallback(() => {
    closedForSessionRef.current.clear();
    if (!patientId) return;
    const current = pickCriticalAlert(patientId);
    setAlert(current);
    knownIdRef.current = current?.alertId ?? null;
    if (current) {
      setVisible(true);
    }
  }, [patientId]);

  return (
    <CriticalAlertContext.Provider
      value={{ alert, visible, closeForSession, dismiss, reopenOnCareFocus }}
    >
      {children}
    </CriticalAlertContext.Provider>
  );
}

export function useCriticalAlert(): CriticalAlertContextValue {
  const ctx = useContext(CriticalAlertContext);
  if (!ctx) {
    throw new Error('useCriticalAlert must be used within a CriticalAlertProvider');
  }
  return ctx;
}

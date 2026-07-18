/**
 * ActiveAlertStore — session-scoped controller for the severity-3 active alert.
 *
 * The active alert is presented as a modal pop-up once per app cold-start on
 * the Home and Care screens (see planning/UX feedback). The caregiver can:
 *   - Close (temp dismiss): hides the modal for the rest of the session; it
 *     reappears on the next cold start.
 *   - Clear without rectifying (not recommended): persistently marks the alert
 *     cleared in app_settings + audit-logs it, so it won't reappear.
 *
 * "Clear" is persistent across launches; "Close" is session-only.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Linking, Platform } from 'react-native';

import { usePatientRecord } from '@/contexts/patient-record-context';
import { getOnboardingProfile } from '@/services/onboarding/onboardingService';
import { audit } from '@/services/audit/auditService';
import { getDatabase } from '@/data';

// ---------------------------------------------------------------------------
// Active alert payload (demo). In a real flow this would come from the alert
// pipeline (getOpenAlerts); for the prototype we surface a single severity-3
// alert unless the caregiver has cleared it.
// ---------------------------------------------------------------------------

export interface ActiveAlertPayload {
  alertId: string;
  title: string;
  subtitle: string;
  severity: 3;
  category: string;
  metrics: { label: string; value: string; detail?: string }[];
  body: string;
  createdAt: string;
}

function buildDemoAlert(): ActiveAlertPayload {
  const profile = getOnboardingProfile();
  const patientName = profile.patient.name;
  return {
    alertId: 'demo-active-alert-001',
    title: 'Red Breath Alert',
    subtitle: 'Severity 3 · Respiratory · Just now',
    severity: 3,
    category: 'Respiratory',
    metrics: [
      { label: 'SpO₂', value: '84%', detail: 'cutoff 88%' },
      { label: 'Heart Rate', value: '118', detail: 'BPM' },
      { label: 'Resp. Rate', value: '32', detail: 'br/min' },
    ],
    body: `${patientName}'s oxygen is below the safe threshold with elevated respiratory and heart rate. No movement detected for 25 min. You decide — the app never acts for you.`,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// app_settings persistence for the "cleared" flag
// ---------------------------------------------------------------------------

function clearedKey(patientId: string): string {
  return `active_alert_cleared:${patientId}`;
}

function readCleared(patientId: string): boolean {
  try {
    const db = getDatabase();
    const row = db.getFirstSync<{ value_json: string }>(
      'SELECT value_json FROM app_settings WHERE key = ?;',
      clearedKey(patientId),
    );
    if (!row?.value_json) return false;
    return JSON.parse(row.value_json) === true;
  } catch {
    return false;
  }
}

function writeCleared(patientId: string, cleared: boolean): void {
  try {
    const db = getDatabase();
    const now = new Date().toISOString();
    db.runSync(
      'INSERT OR REPLACE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?);',
      clearedKey(patientId),
      JSON.stringify(cleared),
      now,
    );
  } catch {
    // app_settings unavailable — degrade to session-only.
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ActiveAlertContextValue {
  alert: ActiveAlertPayload | null;
  visible: boolean;
  tempDismiss: () => void;
  reopen: () => void;
  clearAlert: () => void;
  call911: () => Promise<void>;
  acknowledge: () => void;
  addNote: (text: string) => void;
}

const ActiveAlertContext = createContext<ActiveAlertContextValue | null>(null);

export function ActiveAlertProvider({ children }: { children: ReactNode }) {
  const { patientId } = usePatientRecord();

  const [alert, setAlert] = useState<ActiveAlertPayload | null>(() => {
    if (!patientId) return null;
    return readCleared(patientId) ? null : buildDemoAlert();
  });
  const [visible, setVisible] = useState<boolean>(() => alert !== null);

  const tempDismiss = useCallback(() => setVisible(false), []);

  const reopen = useCallback(() => setVisible(true), []);

  const clearAlert = useCallback(() => {
    if (!patientId) return;
    writeCleared(patientId, true);
    audit({
      actor: 'caregiver',
      action: 'clear_without_rectifying',
      resourceType: 'alert',
      resourceId: alert?.alertId,
      patientId,
      payload: { severity: 3, category: alert?.category },
    });
    setAlert(null);
    setVisible(false);
  }, [patientId, alert]);

  const call911 = useCallback(async () => {
    if (!patientId) return;
    audit({
      actor: 'caregiver',
      action: 'initiated_911',
      resourceType: 'alert',
      resourceId: alert?.alertId,
      patientId,
    });
    try {
      const url = Platform.OS === 'ios' ? 'tel:911' : 'tel:911';
      await Linking.openURL(url);
    } catch (err) {
      console.error('[ActiveAlert] Could not open dialer:', err);
    }
  }, [patientId, alert]);

  const acknowledge = useCallback(() => {
    if (!patientId) return;
    audit({
      actor: 'caregiver',
      action: 'acknowledged',
      resourceType: 'alert',
      resourceId: alert?.alertId,
      patientId,
      payload: { severity: 3 },
    });
  }, [patientId, alert]);

  const addNote = useCallback(
    (text: string) => {
      if (!patientId || !text.trim()) return;
      audit({
        actor: 'caregiver',
        action: 'add_note',
        resourceType: 'alert',
        resourceId: alert?.alertId,
        patientId,
        payload: { note: text.trim() },
      });
    },
    [patientId, alert],
  );

  const value = useMemo<ActiveAlertContextValue>(
    () => ({ alert, visible, tempDismiss, reopen, clearAlert, call911, acknowledge, addNote }),
    [alert, visible, tempDismiss, reopen, clearAlert, call911, acknowledge, addNote],
  );

  return (
    <ActiveAlertContext.Provider value={value}>{children}</ActiveAlertContext.Provider>
  );
}

export function useActiveAlert(): ActiveAlertContextValue {
  const ctx = useContext(ActiveAlertContext);
  if (!ctx) {
    throw new Error('useActiveAlert must be used within an ActiveAlertProvider');
  }
  return ctx;
}

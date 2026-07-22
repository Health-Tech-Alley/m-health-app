/**
 * Default consent grants that should be on without caregiver action.
 * Care plan backup consent is enabled by default for demo ergonomics;
 * caregivers can still revoke it in Preferences.
 */

import { hasActiveConsent } from '@/data';
import { grantConsent } from '@/services/consent/consentGate';

const grantedOnce = new Set<string>();

/** Ensure adcp_backup is granted once per patient (idempotent). */
export function ensureDefaultAdcpBackupConsent(patientId: string): boolean {
  if (!patientId.trim()) return false;
  const key = `adcp_backup:${patientId}`;
  if (grantedOnce.has(key)) {
    return hasActiveConsent(patientId, 'adcp_backup');
  }
  try {
    if (hasActiveConsent(patientId, 'adcp_backup')) {
      grantedOnce.add(key);
      return true;
    }
    grantConsent(patientId, 'adcp_backup');
    grantedOnce.add(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Next-step executor.
 *
 * Takes a selected next-step action and executes it: native deep-link (dialer,
 * maps), in-app flow (schedule appointment, share record, set reminder), or
 * consent-gated action. The caregiver always confirms; nothing auto-executes
 * without an explicit tap.
 */

import { Platform, Linking } from 'react-native';

import type { NextStepActionId } from '@/data/types';
import { insertCaregiverAction, insertAppointment, getDatabase, type CaregiverAction } from '@/data';
import { audit } from '@/services/audit/auditService';
import { checkEgressConsent } from '@/services/consent/consentGate';
import { hasActiveConsent } from '@/data';
import { exportCcd } from '@/services/export/ccdaExportService';
import { scheduleLocalNotification } from '@/services/notifications';

import { getNextStepMeta } from './next-step-taxonomy';

export type NextStepExecutionResult = {
  actionId: NextStepActionId;
  success: boolean;
  message: string;
  deepLinked?: boolean;
  consentDenied?: boolean;
};

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
}

async function openDialer(phoneNumber: string): Promise<boolean> {
  try {
    const cleaned = phoneNumber.replace(/[^\d+]/g, '');
    const url = Platform.OS === 'ios' ? `tel:${cleaned}` : `tel:${cleaned}`;
    return await Linking.openURL(url);
  } catch {
    return false;
  }
}

async function openMaps(query: string): Promise<boolean> {
  try {
    const encoded = encodeURIComponent(query);
    const url =
      Platform.OS === 'ios'
        ? `https://maps.apple.com/?q=${encoded}`
        : `geo:0,0?q=${encoded}`;
    return await Linking.openURL(url);
  } catch {
    return false;
  }
}

function getProviderPhone(patientId: string): string | null {
  try {
    const db = getDatabase();
    const row = db.getFirstSync<{ phone: string }>(
      `SELECT phone FROM providers WHERE patient_id = ? AND role LIKE '%primary%' LIMIT 1;`,
      patientId,
    );
    return row?.phone ?? null;
  } catch {
    return null;
  }
}

export async function executeNextStep(
  actionId: NextStepActionId,
  ctx: { patientId: string; alertId?: string; caregiverId: string },
): Promise<NextStepExecutionResult> {
  const meta = getNextStepMeta(actionId);
  if (!meta) {
    return { actionId, success: false, message: `Unknown action: ${actionId}` };
  }

  // Consent gate
  if (meta.requiresConsent && meta.consentScope) {
    const consent = checkEgressConsent(ctx.patientId, meta.consentScope);
    if (!consent.allowed) {
      return {
        actionId,
        success: false,
        message: consent.reason,
        consentDenied: true,
      };
    }
  }

  let success = false;
  let message = '';
  let deepLinked = false;

  switch (actionId) {
    case 'call_911': {
      deepLinked = true;
      success = await openDialer('911');
      message = success ? 'Opening dialer to 911' : 'Could not open dialer';
      break;
    }

    case 'go_to_er': {
      deepLinked = true;
      const query = meta.requiresLocation && hasActiveConsent(ctx.patientId, 'location_access')
        ? 'emergency room near me'
        : 'emergency room';
      success = await openMaps(query);
      message = success ? 'Opening maps to nearest ER' : 'Could not open maps';
      break;
    }

    case 'contact_pcp': {
      deepLinked = true;
      const phone = getProviderPhone(ctx.patientId);
      if (phone) {
        success = await openDialer(phone);
        message = success ? `Calling PCP: ${phone}` : 'Could not open dialer';
      } else {
        success = await openMaps('primary care provider');
        message = 'No PCP phone on file; opening maps to find a provider';
      }
      break;
    }

    case 'geofence_service': {
      deepLinked = true;
      const hasLocation = hasActiveConsent(ctx.patientId, 'location_access');
      const query = hasLocation
        ? 'pharmacy or urgent care near me'
        : 'pharmacy or urgent care';
      success = await openMaps(query);
      message = success ? 'Opening maps to nearby services' : 'Could not open maps';
      break;
    }

    case 'schedule_urgent_appt': {
      // Create a draft appointment the caregiver can review/confirm in the
      // Schedule screen. Marked scheduled so it shows in the Upcoming list;
      // the caregiver edits the date/time/provider from there (HITL).
      try {
        const today = new Date();
        const inTwoDays = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000);
        const dateStr = inTwoDays.toISOString().slice(0, 10);
        const appt = insertAppointment({
          patientId: ctx.patientId,
          type: 'Urgent follow-up',
          reason: `Follow-up for alert ${ctx.alertId ?? '(no alert id)'}`,
          date: dateStr,
          status: 'scheduled',
        });
        message = `Appointment draft created for ${dateStr}. Review in Schedule.`;
        success = true;
        audit({
          actor: 'caregiver',
          action: 'schedule_urgent_appt',
          resourceType: 'appointment',
          resourceId: appt.appointmentId,
          patientId: ctx.patientId,
          payload: { alertId: ctx.alertId, date: dateStr },
        });
      } catch (err) {
        message = `Could not create appointment draft: ${err instanceof Error ? err.message : String(err)}`;
        success = false;
      }
      break;
    }

    case 'share_record': {
      try {
        const result = exportCcd(ctx.patientId);
        message = result.queued
          ? 'Record exported and queued for sync.'
          : 'Record exported.';
        success = true;
      } catch (err) {
        message = `Export failed: ${err instanceof Error ? err.message : String(err)}`;
        success = false;
      }
      break;
    }

    case 'monitor_home': {
      // Set a follow-up reminder (default 2h, clamped to 30min–24h) so the
      // caregiver is nudged to re-check. The reminder is a scheduled local
      // notification (or in-app banner on Track A) + an audit entry.
      const reminderMinutes = Math.min(24 * 60, Math.max(30, 120));
      const fireAt = new Date(Date.now() + reminderMinutes * 60 * 1000);
      try {
        await scheduleLocalNotification({
          patientId: ctx.patientId,
          scope: 'care_task',
          triggerRef: ctx.alertId,
          title: 'Follow-up check',
          body: `Time to re-check on the patient (from the "${ctx.alertId ?? 'alert'}" monitor-at-home plan).`,
          triggerWhen: fireAt,
        });
        message = `Follow-up reminder set for ${reminderMinutes} min. Continue monitoring at home.`;
        success = true;
      } catch (err) {
        message = `Could not set follow-up reminder: ${err instanceof Error ? err.message : String(err)}`;
        success = false;
      }
      break;
    }

    case 'log_note': {
      message = 'Note added.';
      success = true;
      break;
    }

    default:
      message = `Action ${actionId} not implemented`;
      success = false;
  }

  // Log the caregiver action + audit
  const action: CaregiverAction = {
    actionId: makeId('act'),
    alertId: ctx.alertId,
    patientId: ctx.patientId,
    caregiverId: ctx.caregiverId,
    type: 'answer_clarifying_question',
    payloadJson: JSON.stringify({ nextStep: actionId, label: meta.label }),
    createdAt: new Date().toISOString(),
  };
  insertCaregiverAction(action);
  audit({
    actor: 'caregiver',
    action: 'select_next_step',
    resourceType: 'alert',
    resourceId: ctx.alertId,
    patientId: ctx.patientId,
    payload: { actionId, label: meta.label, success, deepLinked },
  });

  return { actionId, success, message, deepLinked };
}

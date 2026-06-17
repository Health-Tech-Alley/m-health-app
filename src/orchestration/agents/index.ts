/**
 * The four orchestration agents.
 *
 * Each agent exposes a set of tools that are registered with the MCP server.
 * Agents do not call each other directly; the orchestrator coordinates them
 * through the MCP client.
 */

import {
  getActiveAlerts,
  getActiveThresholds,
  getActiveThresholdsForVital,
  getAlertById,
  getConditionsForPatient,
  getLatestHealthSample,
  getPatient,
  getRecentHealthSamples,
  insertCaregiverAction,
  updateAlertStatus,
  type CaregiverAction,
  type HealthSample,
} from '@/data';
import { dispatchImmediate, scheduleLocalNotification } from '@/services/notifications';

import type { RegisteredTool, ToolResult } from '../mcp/tool-registry';

export * from './agent-types';
export { PatientStateAgent } from './patient-state-agent';
export { CaregiverAgent } from './caregiver-agent';
export { CoordinatorAgent } from './coordinator-agent';
export { SafetyReviewerAgent, type SafetyVerdict } from './safety-reviewer-agent';

function now(): string {
  return new Date().toISOString();
}

export function createPatientStateAgent(): RegisteredTool[] {
  return [
    {
      name: 'get_patient_profile',
      description: 'Read the patient profile including conditions, meds, and baseline vitals.',
      params: {
        patientId: { type: 'string', description: 'Patient identifier', required: true },
      },
      handler: async (args): Promise<ToolResult> => {
        const patient = getPatient(String(args.patientId));
        if (!patient) return { ok: false, error: 'Patient not found' };
        const conditions = getConditionsForPatient(patient.patientId);
        return { ok: true, data: { patient, conditions } };
      },
    },
    {
      name: 'get_recent_vitals',
      description: 'Read recent vital samples for a patient and vital type.',
      params: {
        patientId: { type: 'string', description: 'Patient identifier', required: true },
        vitalType: { type: 'string', description: 'e.g. spo2, heart_rate', required: true },
        hours: { type: 'number', description: 'How many hours back to look', required: true },
      },
      handler: async (args): Promise<ToolResult> => {
        const patientId = String(args.patientId);
        const vitalType = String(args.vitalType);
        const hours = Number(args.hours) || 24;
        const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
        const samples = getRecentHealthSamples(patientId, vitalType as HealthSample['type'], since);
        const latest = getLatestHealthSample(patientId, vitalType as HealthSample['type']);
        return { ok: true, data: { samples, latest } };
      },
    },
    {
      name: 'get_active_thresholds',
      description: 'Read active alert thresholds for a patient.',
      params: {
        patientId: { type: 'string', description: 'Patient identifier', required: true },
      },
      handler: async (args): Promise<ToolResult> => {
        const thresholds = getActiveThresholds(String(args.patientId));
        return { ok: true, data: { thresholds } };
      },
    },
    {
      name: 'get_active_alerts',
      description: 'Read open alerts for a patient.',
      params: {
        patientId: { type: 'string', description: 'Patient identifier', required: true },
      },
      handler: async (args): Promise<ToolResult> => {
        const alerts = getActiveAlerts(String(args.patientId));
        return { ok: true, data: { alerts } };
      },
    },
  ];
}

export function createCaregiverAgent(): RegisteredTool[] {
  return [
    {
      name: 'log_observation',
      description: 'Record a caregiver observation tied to an alert.',
      params: {
        alertId: { type: 'string', description: 'Alert identifier', required: true },
        observation: { type: 'string', description: 'Free-text observation', required: true },
        caregiverId: { type: 'string', description: 'Caregiver identifier', required: true },
        patientId: { type: 'string', description: 'Patient identifier', required: true },
      },
      handler: async (args): Promise<ToolResult> => {
        const action: CaregiverAction = {
          actionId: `act-${Date.now()}`,
          alertId: String(args.alertId),
          patientId: String(args.patientId),
          caregiverId: String(args.caregiverId),
          type: 'log_observation',
          payloadJson: JSON.stringify({ observation: String(args.observation) }),
          createdAt: now(),
        };
        insertCaregiverAction(action);
        return { ok: true, data: { actionId: action.actionId } };
      },
    },
    {
      name: 'ack_alert',
      description: 'Mark an alert as acknowledged by the caregiver.',
      params: {
        alertId: { type: 'string', description: 'Alert identifier', required: true },
      },
      handler: async (args): Promise<ToolResult> => {
        updateAlertStatus(String(args.alertId), 'acknowledged');
        return { ok: true };
      },
    },
    {
      name: 'resolve_alert',
      description: 'Mark an alert as resolved.',
      params: {
        alertId: { type: 'string', description: 'Alert identifier', required: true },
      },
      handler: async (args): Promise<ToolResult> => {
        updateAlertStatus(String(args.alertId), 'resolved');
        return { ok: true };
      },
    },
  ];
}

export function createCoordinatorAgent(): RegisteredTool[] {
  return [
    {
      name: 'dispatch_alert_notification',
      description: 'Send an urgent alert notification (severity 3 fast path).',
      params: {
        alertId: { type: 'string', description: 'Alert identifier', required: true },
        bypassDnd: { type: 'boolean', description: 'Whether to bypass Do Not Disturb', required: true },
      },
      handler: async (args): Promise<ToolResult> => {
        const alertId = String(args.alertId);
        const bypassDnd = Boolean(args.bypassDnd);
        const alert = getAlertById(alertId);
        if (!alert) return { ok: false, error: `Alert not found: ${alertId}` };
        try {
          const notifId = await dispatchImmediate({
            patientId: alert.patientId,
            scope: 'anomaly',
            triggerRef: alertId,
            title: alert.title,
            body: alert.body,
            severity: alert.severity,
            bypassDnd,
          });
          if (!notifId) {
            return { ok: true, data: { dispatched: false, reason: 'deduped' } };
          }
          return { ok: true, data: { dispatched: true, notificationId: notifId } };
        } catch (err: any) {
          return { ok: false, error: err?.message ?? 'Failed to dispatch notification' };
        }
      },
    },
    {
      name: 'schedule_appointment',
      description: 'Schedule an appointment for the patient.',
      params: {
        patientId: { type: 'string', description: 'Patient identifier', required: true },
        providerName: { type: 'string', description: 'Provider name', required: false },
        reason: { type: 'string', description: 'Reason for visit', required: true },
        preferredDate: { type: 'string', description: 'ISO date', required: false },
      },
      handler: async (args): Promise<ToolResult> => {
        return {
          ok: true,
          data: {
            patientId: String(args.patientId),
            providerName: args.providerName ? String(args.providerName) : undefined,
            reason: String(args.reason),
            preferredDate: args.preferredDate ? String(args.preferredDate) : undefined,
            status: 'draft',
          },
        };
      },
    },
    {
      name: 'set_follow_up_reminder',
      description: 'Set a follow-up reminder for the caregiver.',
      params: {
        patientId: { type: 'string', description: 'Patient identifier', required: true },
        alertId: { type: 'string', description: 'Alert identifier', required: false },
        message: { type: 'string', description: 'Reminder message', required: true },
        delayMinutes: { type: 'number', description: 'Minutes from now', required: true },
      },
      handler: async (args): Promise<ToolResult> => {
        try {
          const delayMin = Math.max(1, Math.min(1440, Number(args.delayMinutes) || 120));
          const triggerWhen = new Date(Date.now() + delayMin * 60_000);
          const id = await scheduleLocalNotification({
            patientId: String(args.patientId),
            scope: 'care_task',
            triggerRef: args.alertId ? String(args.alertId) : undefined,
            title: 'Follow-up reminder',
            body: String(args.message),
            triggerWhen,
          });
          return { ok: true, data: { notificationId: id } };
        } catch (err: any) {
          return { ok: false, error: err?.message ?? 'Failed to set reminder' };
        }
      },
    },
  ];
}

export function createSafetyReviewerAgent(): RegisteredTool[] {
  return [
    {
      name: 'check_threshold_violation',
      description: 'Check whether a vital sample violates active thresholds.',
      params: {
        patientId: { type: 'string', description: 'Patient identifier', required: true },
        vitalType: { type: 'string', description: 'e.g. spo2, heart_rate', required: true },
        value: { type: 'number', description: 'Observed value', required: true },
      },
      handler: async (args): Promise<ToolResult> => {
        const patientId = String(args.patientId);
        const vitalType = String(args.vitalType);
        const value = Number(args.value);
        const thresholds = getActiveThresholdsForVital(patientId, vitalType);
        const violations = thresholds.filter((t) => {
          if (t.direction === 'below') return value < t.value;
          if (t.direction === 'above') return value > t.value;
          return Math.abs(value - t.value) < 0.001;
        });
        const maxSeverity = violations.length
          ? (Math.max(...violations.map((v) => v.severity)) as 1 | 2 | 3)
          : 0;
        return {
          ok: true,
          data: {
            violations,
            maxSeverity,
            isEmergency: maxSeverity === 3,
          },
        };
      },
    },
  ];
}

export function createAllAgents(): RegisteredTool[] {
  return [
    ...createPatientStateAgent(),
    ...createCaregiverAgent(),
    ...createCoordinatorAgent(),
    ...createSafetyReviewerAgent(),
  ];
}

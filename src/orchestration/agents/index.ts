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
  deleteAppointment,
  deleteMedication,
  getMedicationById,
  getUpcomingAppointments,
  insertAppointment,
  updateAppointment,
  upsertMedication,
  upsertMedicationSchedule,
  type CaregiverAction,
  type HealthSample,
} from '@/data';
import { audit } from '@/services/audit/auditService';
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
          const patient = getPatient(alert.patientId);
          const patientFirst = (patient?.name ?? 'Your loved one').trim().split(/\s+/)[0] || 'Your loved one';
          // Caregiver-facing HITL framing per planning/29: the notification
          // asks for a review, not a clinical reaction.
          const notifTitle = alert.severity === 3
            ? `Urgent: ${alert.title}`
            : `${patientFirst} needs your review`;
          const notifBody = alert.severity === 3
            ? `${patientFirst} may need help right now. Tap to review and act.`
            : `${alert.title}. Tap to review what the Health Monitor noticed.`;
          const notifId = await dispatchImmediate({
            patientId: alert.patientId,
            scope: 'anomaly',
            triggerRef: alertId,
            title: notifTitle,
            body: notifBody,
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
      description: 'Schedule an appointment for the patient. Persists to the appointments table and audit-logs. Requires confirmation.',
      params: {
        patientId: { type: 'string', description: 'Patient identifier', required: true },
        providerName: { type: 'string', description: 'Provider name', required: false },
        reason: { type: 'string', description: 'Reason for visit', required: true },
        preferredDate: { type: 'string', description: 'ISO date (yyyy-mm-dd)', required: false },
        time: { type: 'string', description: 'Time label e.g. 10:30 AM', required: false },
        type: { type: 'string', description: 'Appointment type e.g. Primary care', required: false },
      },
      handler: async (args): Promise<ToolResult> => {
        const patientId = String(args.patientId);
        const type = args.type ? String(args.type) : 'Primary care';
        const appt = insertAppointment({
          patientId,
          type,
          provider: args.providerName ? String(args.providerName) : undefined,
          date: args.preferredDate ? String(args.preferredDate) : new Date().toISOString().slice(0, 10),
          time: args.time ? String(args.time) : undefined,
          reason: String(args.reason),
          status: 'scheduled',
        });
        audit({
          actor: 'orchestrator',
          action: 'schedule_appointment',
          resourceType: 'appointment',
          resourceId: appt.appointmentId,
          patientId,
          payload: { type: appt.type, date: appt.date },
        });
        return {
          ok: true,
          data: { appointmentId: appt.appointmentId, status: 'scheduled', requiresConfirmation: true },
        };
      },
    },
    {
      name: 'update_appointment',
      description: 'Modify an existing appointment (date, time, provider, reason, etc.).',
      params: {
        appointmentId: { type: 'string', description: 'Appointment identifier', required: true },
        patientId: { type: 'string', description: 'Patient identifier', required: true },
        type: { type: 'string', description: 'New appointment type', required: false },
        providerName: { type: 'string', description: 'New provider name', required: false },
        date: { type: 'string', description: 'New ISO date', required: false },
        time: { type: 'string', description: 'New time label', required: false },
        reason: { type: 'string', description: 'New reason', required: false },
      },
      handler: async (args): Promise<ToolResult> => {
        const patientId = String(args.patientId);
        const upcoming = getUpcomingAppointments(patientId);
        const existing = upcoming.find((a) => a.appointmentId === String(args.appointmentId));
        if (!existing) return { ok: false, error: 'Appointment not found' };
        const updated = updateAppointment({
          ...existing,
          type: args.type ? String(args.type) : existing.type,
          provider: args.providerName !== undefined ? String(args.providerName) : existing.provider,
          date: args.date ? String(args.date) : existing.date,
          time: args.time !== undefined ? String(args.time) : existing.time,
          reason: args.reason !== undefined ? String(args.reason) : existing.reason,
        });
        audit({
          actor: 'orchestrator',
          action: 'update_appointment',
          resourceType: 'appointment',
          resourceId: updated.appointmentId,
          patientId,
        });
        return { ok: true, data: { appointmentId: updated.appointmentId }, requiresConfirmation: true };
      },
    },
    {
      name: 'delete_appointment',
      description: 'Cancel and delete an appointment. Requires confirmation.',
      params: {
        appointmentId: { type: 'string', description: 'Appointment identifier', required: true },
        patientId: { type: 'string', description: 'Patient identifier', required: true },
      },
      handler: async (args): Promise<ToolResult> => {
        const patientId = String(args.patientId);
        const appointmentId = String(args.appointmentId);
        deleteAppointment(appointmentId);
        audit({
          actor: 'orchestrator',
          action: 'delete_appointment',
          resourceType: 'appointment',
          resourceId: appointmentId,
          patientId,
        });
        return { ok: true, requiresConfirmation: true };
      },
    },
    {
      name: 'list_upcoming_appointments',
      description: 'List the patient\'s upcoming (scheduled) appointments.',
      params: {
        patientId: { type: 'string', description: 'Patient identifier', required: true },
      },
      handler: async (args): Promise<ToolResult> => {
        const upcoming = getUpcomingAppointments(String(args.patientId));
        return { ok: true, data: { appointments: upcoming } };
      },
    },
    {
      name: 'add_medication',
      description: 'Add a custom medication to the patient\'s regimen. Requires confirmation.',
      params: {
        patientId: { type: 'string', description: 'Patient identifier', required: true },
        name: { type: 'string', description: 'Medication name', required: true },
        dosage: { type: 'string', description: 'Dose e.g. 2 puffs', required: false },
        frequency: { type: 'string', description: 'Instructions / frequency', required: false },
        timeOfDay: { type: 'string', description: 'Administration time (HH:mm)', required: false },
      },
      handler: async (args): Promise<ToolResult> => {
        const patientId = String(args.patientId);
        const medId = `med-${Date.now().toString(36)}`;
        upsertMedication({
          medicationId: medId,
          patientId,
          name: String(args.name),
          dosage: args.dosage ? String(args.dosage) : undefined,
          frequency: args.frequency ? String(args.frequency) : undefined,
          active: true,
          source: 'custom',
        });
        if (args.timeOfDay) {
          upsertMedicationSchedule({
            scheduleId: `sched-${Date.now().toString(36)}`,
            medicationId: medId,
            patientId,
            timeOfDay: String(args.timeOfDay),
            active: true,
            createdAt: new Date().toISOString(),
          });
        }
        audit({
          actor: 'orchestrator',
          action: 'add_medication',
          resourceType: 'medication',
          resourceId: medId,
          patientId,
          payload: { name: String(args.name), source: 'custom' },
        });
        return { ok: true, data: { medicationId: medId }, requiresConfirmation: true };
      },
    },
    {
      name: 'update_medication',
      description: 'Edit a medication\'s name, dose, frequency, or administration time. Requires confirmation.',
      params: {
        medicationId: { type: 'string', description: 'Medication identifier', required: true },
        patientId: { type: 'string', description: 'Patient identifier', required: true },
        name: { type: 'string', description: 'New name', required: false },
        dosage: { type: 'string', description: 'New dose', required: false },
        frequency: { type: 'string', description: 'New instructions / frequency', required: false },
      },
      handler: async (args): Promise<ToolResult> => {
        const existing = getMedicationById(String(args.medicationId));
        if (!existing) return { ok: false, error: 'Medication not found' };
        const updated = {
          ...existing,
          name: args.name ? String(args.name) : existing.name,
          dosage: args.dosage !== undefined ? String(args.dosage) : existing.dosage,
          frequency: args.frequency !== undefined ? String(args.frequency) : existing.frequency,
        };
        upsertMedication(updated);
        audit({
          actor: 'orchestrator',
          action: 'edit_medication',
          resourceType: 'medication',
          resourceId: updated.medicationId,
          patientId: String(args.patientId),
        });
        return { ok: true, requiresConfirmation: true };
      },
    },
    {
      name: 'delete_medication',
      description: 'Remove a medication (hard-delete for custom meds, deactivate for care-plan meds). Requires confirmation.',
      params: {
        medicationId: { type: 'string', description: 'Medication identifier', required: true },
        patientId: { type: 'string', description: 'Patient identifier', required: true },
      },
      handler: async (args): Promise<ToolResult> => {
        const medId = String(args.medicationId);
        const patientId = String(args.patientId);
        const existing = getMedicationById(medId);
        if (!existing) return { ok: false, error: 'Medication not found' };
        deleteMedication(medId, existing.source === 'custom');
        audit({
          actor: 'orchestrator',
          action: 'delete_medication',
          resourceType: 'medication',
          resourceId: medId,
          patientId,
          payload: { name: existing.name },
        });
        return { ok: true, requiresConfirmation: true };
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

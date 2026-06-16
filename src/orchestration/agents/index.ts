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
  getConditionsForPatient,
  getLatestHealthSample,
  getPatient,
  getRecentHealthSamples,
  insertCaregiverAction,
  updateAlertStatus,
  type CaregiverAction,
  type HealthSample,
} from '@/data';

import type { RegisteredTool, ToolResult } from '../mcp/tool-registry';

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
        // In v1 this is a stub. Later it wires to the L2 Notification Manager.
        console.log(
          '[CoordinatorAgent] dispatch_alert_notification',
          args.alertId,
          'bypassDnd:',
          args.bypassDnd,
        );
        return { ok: true, data: { dispatched: true } };
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

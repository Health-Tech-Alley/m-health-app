/**
 * Audit service.
 *
 * High-level helper used by orchestration, consent gate, and UI to record
 * clinically significant events. Wraps the audit repository with convenience
 * builders so callers do not have to construct IDs or timestamps.
 */

import { insertAuditEntry, type AuditLogEntry } from '@/data';

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
}

export type AuditActor = AuditLogEntry['actor'];

export function audit(params: {
  actor: AuditActor;
  action: string;
  resourceType: string;
  resourceId?: string;
  patientId?: string;
  payload?: Record<string, unknown>;
}): AuditLogEntry {
  return insertAuditEntry({
    auditId: makeId('audit'),
    patientId: params.patientId,
    actor: params.actor,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    payloadJson: params.payload ? JSON.stringify(params.payload) : undefined,
    createdAt: new Date().toISOString(),
  });
}

export function auditSampleRead(patientId: string, sampleId: string, by: AuditActor): AuditLogEntry {
  return audit({ actor: by, action: 'read', resourceType: 'sample', resourceId: sampleId, patientId });
}

export function auditAlertCreated(patientId: string, alertId: string, payload?: Record<string, unknown>): AuditLogEntry {
  return audit({ actor: 'orchestrator', action: 'create', resourceType: 'alert', resourceId: alertId, patientId, payload });
}

export function auditSlmTurn(patientId: string, turnId: string, payload?: Record<string, unknown>): AuditLogEntry {
  return audit({ actor: 'slm', action: 'generate', resourceType: 'slm_turn', resourceId: turnId, patientId, payload });
}

export function auditCaregiverAction(
  patientId: string,
  actionId: string,
  actionType: string,
  alertId?: string,
): AuditLogEntry {
  return audit({
    actor: 'caregiver',
    action: actionType,
    resourceType: 'caregiver_action',
    resourceId: actionId,
    patientId,
    payload: alertId ? { alertId } : undefined,
  });
}

export function auditConsentDecision(
  patientId: string,
  scope: string,
  granted: boolean,
): AuditLogEntry {
  return audit({
    actor: 'caregiver',
    action: granted ? 'grant' : 'revoke',
    resourceType: 'consent',
    resourceId: scope,
    patientId,
    payload: { scope, granted },
  });
}

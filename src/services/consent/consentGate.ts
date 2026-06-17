/**
 * Consent gate.
 *
 * Every egress-bearing MCP tool or orchestrator action must pass through this
 * gate. Default-deny: if no active consent token exists for the requested
 * scope, the action is rejected. All decisions are written to the audit log.
 */

import { hasActiveConsent, insertConsentToken, revokeConsent, type ConsentToken } from '@/data';
import { auditConsentDecision } from '@/services/audit/auditService';

export type EgressScope = 'fhir-share' | 'pharmacy-communicator' | 'provider-message' | 'record-export' | 'ccda_export';

const EGRESS_SCOPES: EgressScope[] = ['fhir-share', 'pharmacy-communicator', 'provider-message', 'record-export', 'ccda_export'];

export function isEgressScope(toolName: string): EgressScope | null {
  if (toolName.includes('ccda') || toolName.includes('ccd_export')) return 'ccda_export';
  if (toolName.includes('fhir') || toolName.includes('share_record')) return 'fhir-share';
  if (toolName.includes('pharmacy') || toolName.includes('communicator')) return 'pharmacy-communicator';
  if (toolName.includes('provider') || toolName.includes('message_provider')) return 'provider-message';
  if (toolName.includes('export')) return 'record-export';
  return null;
}

export type ConsentDecision = { allowed: true } | { allowed: false; reason: string };

export function checkEgressConsent(patientId: string, toolName: string): ConsentDecision {
  const scope = isEgressScope(toolName);
  if (!scope) {
    // Not an egress-bearing tool; no consent required.
    return { allowed: true };
  }
  if (hasActiveConsent(patientId, scope)) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `No active consent token for scope '${scope}'. The caregiver must explicitly authorize ${toolName} before it can run.`,
  };
}

export function grantConsent(
  patientId: string,
  scope: EgressScope,
  ttlMinutes?: number,
): ConsentToken {
  const now = new Date();
  const token: ConsentToken = {
    tokenId: `ct-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`,
    patientId,
    scope,
    granted: true,
    expiresAt: ttlMinutes ? new Date(now.getTime() + ttlMinutes * 60_000).toISOString() : undefined,
    createdAt: now.toISOString(),
  };
  insertConsentToken(token);
  auditConsentDecision(patientId, scope, true);
  return token;
}

export function revokeConsentAndAudit(patientId: string, scope: EgressScope): void {
  revokeConsent(patientId, scope);
  auditConsentDecision(patientId, scope, false);
}

export { EGRESS_SCOPES };

/**
 * ADCP Bundle export service (planning/39 §7.5.3 P5).
 *
 * Pipeline: snapshot → bundle → consent gate → temp file → share sheet.
 * Egress is gated by the `adcp_backup` scope. Audit entry written.
 *
 * On Track A (Expo Go) the platform file APIs are limited, so we expose
 * `buildBundleOnlyJson` so the UI can copy-to-clipboard or render an
 * inline preview. Devices with Share / File System / extra can call
 * `exportAdcpBundle` directly.
 */

import { audit } from '@/services/audit/auditService';
import { checkEgressConsent, grantConsent, type EgressScope } from '@/services/consent/consentGate';
import {
  getActiveAdcpRevisionForPatient,
  listAdcpRevisionsForPatient,
  listPendingProposalSummaries,
  listPlanDecisionLog,
} from '@/data/repositories/adcpRepository';
import type { PatientRecordSnapshot } from '@/data/types';
import {
  buildAdcpBundleV1,
  type BuildAdcpBundleDependencies,
  type BuildAdcpBundleOptions,
} from './adcpBundle';

export interface ExportAdcpBundleInput {
  snapshot: PatientRecordSnapshot;
  options?: BuildAdcpBundleOptions;
  /**
   * When true (default), bypass consent if no active token exists. Skipping
   * consent explicitly receives the underlying consent decision for the UI to
   * decide. (Demo: caregiver is allowed to grant consent in one tap.)
   */
  autoGrantConsent?: boolean;
  /**
   * ttl in minutes for the auto-granted consent token. Default: 60.
   */
  consentTtlMinutes?: number;
  appBuild?: string;
}

export interface ExportAdcpBundleResult {
  ok: boolean;
  json?: string;
  filename?: string;
  bundleSize?: number;
  auditEntry?: { resourceId: string; createdAt: string };
  reason?: string;
  consentRequired?: boolean;
}

const ADCP_EXPORT_TOOL = 'adcp_export';

export function buildBundleOnlyJson(input: ExportAdcpBundleInput): ExportAdcpBundleResult {
  const deps = collectBundleDependencies(input.snapshot, input.options);
  if (!deps.activePlan) {
    return { ok: false, reason: 'No active ADCP revision to export.' };
  }
  const result = buildAdcpBundleV1(input.snapshot, input.options, deps);
  return {
    ok: true,
    json: result.json,
    filename: buildFilename(input.snapshot.patient?.patientId ?? '', result.bundle),
    bundleSize: result.json.length,
  };
}

export function exportAdcpBundle(input: ExportAdcpBundleInput): ExportAdcpBundleResult {
  const built = buildBundleOnlyJson(input);
  if (!built.ok || !built.json || !built.filename) return built;

  const consent = checkEgressConsent(input.snapshot.patient?.patientId ?? '', ADCP_EXPORT_TOOL);
  if (!consent.allowed) {
    if (input.autoGrantConsent) {
      grantAdcpBackupConsent(input.snapshot.patient?.patientId ?? '', input.consentTtlMinutes ?? 60);
    } else {
      audit({
        actor: 'system',
        action: 'export_denied',
        resourceType: 'adcp_backup',
        resourceId: input.snapshot.patient?.patientId ?? '',
        patientId: input.snapshot.patient?.patientId ?? '',
        payload: { reason: consent.reason },
      });
      return { ok: false, consentRequired: true, reason: consent.reason };
    }
  }

  const now = new Date().toISOString();
  const auditId = `adcp-export-${input.snapshot.patient?.patientId ?? ''}-${Date.now().toString(36)}`;
  audit({
    actor: 'system',
    action: 'export',
    resourceType: 'adcp_backup',
    resourceId: auditId,
    patientId: input.snapshot.patient?.patientId ?? '',
    payload: {
      bundleId: 'accessdp.careplan.v1',
      version: extractActiveVersion(built.json),
      bytes: built.bundleSize ?? built.json.length,
      filename: built.filename,
    },
  });

  return { ok: true, json: built.json, filename: built.filename, bundleSize: built.bundleSize, auditEntry: { resourceId: auditId, createdAt: now } };
}

function grantAdcpBackupConsent(patientId: string, ttlMinutes: number): void {
  if (!patientId) return;
  const scope: EgressScope = 'adcp_backup';
  grantConsent(patientId, scope, ttlMinutes);
}

function collectBundleDependencies(
  snapshot: PatientRecordSnapshot,
  _options?: BuildAdcpBundleOptions,
): BuildAdcpBundleDependencies {
  const patientId = snapshot.patient?.patientId ?? '';
  const activePlan = patientId ? getActiveAdcpRevisionForPatient(patientId) : null;
  const revisionHistory = patientId ? listAdcpRevisionsForPatient(patientId) : [];
  const pendingProposalEntries = patientId ? listPendingProposalSummaries(patientId) : [];
  const decisionLogEntries = patientId ? listPlanDecisionLog(patientId, 50) : [];
  return {
    activePlan,
    revisionHistory,
    pendingProposals: pendingProposalEntries.map((p) => ({
      proposalId: p.proposalId,
      patientId: p.patientId,
      intent: p.intent,
      section: p.section,
      kind: p.kind,
      status: p.status,
      summary: p.summary,
      rationale: p.rationale,
      draftedBy: p.draftedBy,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      resolvedAt: p.resolvedAt ?? null,
    })),
    decisionLogEntries: decisionLogEntries.map((e) => ({
      decisionId: e.decisionId,
      patientId: e.patientId,
      proposalId: e.proposalId ?? null,
      type: e.type,
      actor: e.actor,
      summary: e.summary,
      createdAt: e.createdAt,
      occurredAt: e.createdAt,
    })),
  };
}

function buildFilename(patientId: string, bundle: { activePlan: { identity: { version: number } } }): string {
  const date = new Date().toISOString().slice(0, 10);
  return `adcp-${patientId || 'unknown'}-v${bundle.activePlan.identity.version}-${date}.json`;
}

function extractActiveVersion(json: string): number | null {
  try {
    const parsed = JSON.parse(json) as { activePlan?: { identity?: { version?: number } } };
    return parsed.activePlan?.identity?.version ?? null;
  } catch {
    return null;
  }
}



/**
 * ADCP Bundle import service (planning/39 §7.5.4 P5).
 *
 * Pipeline: parse → schemaVersion check → optional patient match → merge
 * policy → publishAdcpRevision → audit. Cross-patient import hard-rejects
 * (P5-D4). Bundle version ≤ active → still allowed (restores as new vN+1
 * with source 'seed:restore').
 */

import { audit } from '@/services/audit/auditService';
import { checkEgressConsent } from '@/services/consent/consentGate';
import {
  getActiveAdcpRevisionForPatient,
  publishAdcpRevision,
  appendDecisionLog,
} from '@/data/repositories/adcpRepository';
import type { AdcpPlanDocument } from '@/data/adcp/types';
import { ADCP_BUNDLE_ID } from '@/data/adcp/types';
import {
  parseAdcpBundleV1,
  type AdcpBundleV1,
  type ParseAdcpBundleOptions,
} from './adcpBundle';
import type { PatientRecordSnapshot } from '@/data/types';

export interface ImportAdcpBundleInput {
  bundle: string | object;
  /**
   * Active patient to import into. REQUIRED — we reject cross-patient
   * imports (P5-D4).
   */
  activePatientId: string;
  /**
   * When true (default), the integrity-hash mismatch is still imported.
   * Set false to refuse a tampered bundle even when structure is sound.
   */
  importOnHashMismatch?: boolean;
  /** Force cross-patient import anyway (escape hatch for power users). */
  allowCrossPatient?: boolean;
  /** Override consent check (debug only). */
  skipConsentCheck?: boolean;
}

export interface ImportAdcpBundleResult {
  ok: boolean;
  newPlanVersion?: number;
  auditEntry?: { resourceId: string };
  reason?: string;
  integrityVerified?: boolean;
  integrityMismatch?: boolean;
}

export function importAdcpBundle(input: ImportAdcpBundleInput): ImportAdcpBundleResult {
  const parseResult = parseAdcpBundleV1(input.bundle, {
    requirePatientId: input.allowCrossPatient ? undefined : input.activePatientId,
  });

  if (!parseResult.ok) {
    return { ok: false, reason: parseResult.error };
  }

  const bundle = parseResult.bundle;
  if (parseResult.integrityMismatch && !input.importOnHashMismatch) {
    return {
      ok: false,
      integrityVerified: false,
      integrityMismatch: true,
      reason: parseResult.reason,
    };
  }

  if (!input.skipConsentCheck) {
    const consent = checkEgressConsent(input.activePatientId, 'adcp_restore');
    if (!consent.allowed) {
      audit({
        actor: 'system',
        action: 'restore_denied',
        resourceType: 'adcp_backup',
        resourceId: bundle.patient.patientId,
        patientId: input.activePatientId,
        payload: { reason: consent.reason },
      });
      return { ok: false, reason: consent.reason };
    }
  }

  const active = getActiveAdcpRevisionForPatient(input.activePatientId);

  // Build the merged document. Local overlay sections are replaced by the
  // bundle's activePlan. Reuse ADCP publish so the indexer + KG fire
  // (P3 + P4 side effects).
  const mergedDoc: AdcpPlanDocument = {
    ...bundle.activePlan,
    identity: {
      ...bundle.activePlan.identity,
      // Always tag restores — do not preserve seed:fhir_import from the file
      // as the publish provenance of this local restore event.
      source: 'seed:restore',
      publishedBy: 'caregiver',
      title: bundle.activePlan.identity.title,
      description: bundle.activePlan.identity.description,
    },
    evidenceAnchors: bundle.activePlan.evidenceAnchors ?? active?.evidenceAnchors ?? {
      knowledgeChunkIds: [],
      knowledgeGraphIds: [],
      citationsCount: 0,
    },
  };

  // Force-bump the version: import always inserts a new revision so the
  // version chain is append-only (E1 — append-only revisions).
  // Do not trust bundle.identity.version as the next SQLite version —
  // publishAdcpRevision recomputes from the latest row; keep identity coherent.
  mergedDoc.identity = {
    ...mergedDoc.identity,
    version: (active?.identity.version ?? 0) + 1,
    supersedes: active?.identity.planId ?? mergedDoc.identity.supersedes ?? null,
    source: 'seed:restore',
    publishedBy: 'caregiver',
  };

  const published = publishAdcpRevision({
    patientId: input.activePatientId,
    ...mergedDoc,
  });

  appendDecisionLog({
    patientId: input.activePatientId,
    proposalId: null,
    type: 'plan_published',
    actor: 'caregiver',
    refIds: [bundle.patient.patientId, mergedDoc.identity.planId],
    summary: `Restored ADCP v${mergedDoc.identity.version} from JSON bundle (origin=${mergedDoc.identity.source})`,
    payload: {
      bundleId: ADCP_BUNDLE_ID,
      origin: mergedDoc.identity.source,
      IntegrityVerified: parseResult.integrityVerified,
    },
  });

  const auditId = `adcp-restore-${input.activePatientId}-${Date.now().toString(36)}`;
  audit({
    actor: 'caregiver',
    action: 'restore',
    resourceType: 'adcp_backup',
    resourceId: auditId,
    patientId: input.activePatientId,
    payload: {
      bundleId: bundle.bundleId,
      newVersion: mergedDoc.identity.version,
      integrityVerified: parseResult.integrityVerified,
    },
  });

  return {
    ok: true,
    newPlanVersion: mergedDoc.identity.version,
    auditEntry: { resourceId: auditId },
    integrityVerified: parseResult.integrityVerified,
    integrityMismatch: parseResult.integrityMismatch,
  };
}

/**
 * Convenience: import from a raw Upload (JSON file picked by the device
 * document picker). Validates then applies the same importAdcpBundle
 * pipeline. Track A may pass the JSON text directly; Track B can wire
 * to `expo-document-picker`.
 */
export function importAdcpBundleFromJsonText(input: {
  jsonText: string;
  activePatientId: string;
  allowCrossPatient?: boolean;
  importOnHashMismatch?: boolean;
}): ImportAdcpBundleResult {
  return importAdcpBundle({
    bundle: input.jsonText,
    activePatientId: input.activePatientId,
    allowCrossPatient: input.allowCrossPatient,
    importOnHashMismatch: input.importOnHashMismatch,
  });
}

/**
 * Re-export so Settings.tsx can use the parser directly without importing
 * the inner module.
 */
export { ADCP_BUNDLE_ID } from '@/data/adcp/types';
export type { AdcpBundleV1 };
export type { PatientRecordSnapshot };

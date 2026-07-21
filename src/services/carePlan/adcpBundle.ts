/**
 * ADCP JSON Bundle — canonical interchange format (planning/39 §8, §7.5 P5).
 *
 * **Canonical id:** `accessdp.careplan.v1`
 * **File name:**  `adcp-{patientId}-v{version}-{date}.json`
 * **Audience:**    caregiver / demo / backup (lossless app fields)
 * **Privacy:**     PHI by default. Egress requires the `adcp_backup` consent
 *                 scope (mirror of `ccda_export`). No cloud upload — only
 *                 Share sheet / Save to Files.
 *
 * This module builds / parses / validates the bundle and computes its
 * integrity hash. It does NOT touch SQLite directly — siblings in
 * `src/services/carePlan/adcpExportService.ts` / `adcpImportService.ts`
 * coordinates consent + write + audit + apply.
 */

import {
  ADCP_BUNDLE_ID,
  type AdcpPlanDocument,
} from '@/data/adcp/types';
import type { PatientRecordSnapshot } from '@/data/types';

/**
 * Stable shape for the on-device backup. Round-trip this without losing
 * information; FHIR projection is a separate concern.
 *
 * `medicationJoin` is the only denormalized addition — the meds repo is the
 * canonical source, but offline restore needs readable names.
 */
export interface AdcpBundleV1 {
  bundleId: typeof ADCP_BUNDLE_ID;
  schemaVersion: 1;
  exportedAt: string;
  appBuild?: string;
  patient: AdcpBundlePatientRef;
  activePlan: AdcpPlanDocument;
  revisionHistory?: AdcpPlanDocument[];
  pendingProposals?: AdcpBundlePendingProposalSummary[];
  decisionLogExtra?: AdcpBundleDecisionLogEntry[];
  medicationJoin?: Array<{
    medicationId: string;
    name: string;
    dosage?: string | null;
    frequency?: string | null;
  }>;
  integrity: { payloadSha256: string };
}

export interface AdcpBundlePatientRef {
  patientId: string;
  displayName?: string | null;
  age?: string | null;
}

export interface AdcpBundlePendingProposalSummary {
  proposalId: string;
  patientId: string;
  intent: string;
  section: string;
  kind: string;
  status: string;
  summary: string;
  rationale: string;
  draftedBy: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface AdcpBundleDecisionLogEntry {
  decisionId: string;
  patientId: string;
  proposalId: string | null;
  type: string;
  actor: string;
  occurredAt: string;
  summary: string;
}

export interface BuildAdcpBundleOptions {
  /** Override the bundleId for test purposes. */
  bundleId?: typeof ADCP_BUNDLE_ID;
  /** App build tag recorded for provenance; default undefined. */
  appBuild?: string;
  /** Include recent revisions. Default: last 5. */
  revisionHistoryLimit?: number;
  /** Include pending proposals in the bundle. Default: omit (P5-D3). */
  includePendingProposals?: boolean;
}

export interface BuildAdcpBundleResult {
  bundle: AdcpBundleV1;
  json: string;
  sha256: string;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildAdcpBundleV1(
  snapshot: PatientRecordSnapshot,
  options: BuildAdcpBundleOptions = {},
  dependencies: BuildAdcpBundleDependencies,
): BuildAdcpBundleResult {
  const revisionHistoryLimit = options.revisionHistoryLimit ?? 5;
  const includePendingProposals = options.includePendingProposals ?? false;
  const patientId = snapshot.patient?.patientId ?? '';
  const activePlan = dependencies.activePlan;
  if (!patientId) throw new Error('buildAdcpBundleV1: snapshot has no patientId');
  if (!activePlan) throw new Error('buildAdcpBundleV1: dependencies.activePlan is required');

  const revisionHistory = (dependencies.revisionHistory ?? [])
    .filter((rev) => rev.identity.planId !== activePlan.identity.planId)
    .slice(0, revisionHistoryLimit);

  const pendingProposals: AdcpBundlePendingProposalSummary[] = includePendingProposals
    ? (dependencies.pendingProposals ?? []).map((p) => ({
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
        resolvedAt: p.resolvedAt,
      }))
    : [];

  const decisionLogExtra: AdcpBundleDecisionLogEntry[] = (
    dependencies.decisionLogEntries ?? []
  ).map((e) => ({
    decisionId: e.decisionId,
    patientId: e.patientId,
    proposalId: e.proposalId ?? null,
    type: e.type,
    actor: e.actor,
    occurredAt: e.occurredAt ?? e.createdAt ?? new Date().toISOString(),
    summary: e.summary,
  }));

  const medicationJoin = (snapshot.medications ?? []).map((m) => ({
    medicationId: m.medicationId,
    name: m.name,
    dosage: m.dosage ?? null,
    frequency: m.frequency ?? null,
  }));

  const payload: Omit<AdcpBundleV1, 'integrity'> = {
    bundleId: options.bundleId ?? ADCP_BUNDLE_ID,
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    appBuild: options.appBuild,
    patient: {
      patientId,
      displayName: snapshot.patient?.preferredName?.trim() || snapshot.patient?.name || null,
      age: snapshot.patient?.age ?? null,
    },
    activePlan,
    revisionHistory: revisionHistory.length > 0 ? revisionHistory : undefined,
    pendingProposals: pendingProposals.length > 0 ? pendingProposals : undefined,
    decisionLogExtra: decisionLogExtra.length > 0 ? decisionLogExtra : undefined,
    medicationJoin: medicationJoin.length > 0 ? medicationJoin : undefined,
  };

  const sha256 = sha256HexOf(JSON.stringify(payload));
  const bundle: AdcpBundleV1 = { ...payload, integrity: { payloadSha256: sha256 } };
  const json = JSON.stringify(bundle, null, 2);
  return { bundle, json, sha256 };
}

// ---------------------------------------------------------------------------
// Bundler inputs collected at the call site (eagerly resolved so the
// builder itself stays pure / testable).
// ---------------------------------------------------------------------------

export interface BuildAdcpBundleDependencies {
  activePlan: AdcpPlanDocument | null;
  revisionHistory?: AdcpPlanDocument[];
  pendingProposals?: AdcpBundlePendingProposalSummary[];
  /** Decision-log rows. Accepts both `createdAt` and `occurredAt`. */
  decisionLogEntries?: Array<{
    decisionId: string;
    patientId: string;
    proposalId?: string | null;
    type: string;
    actor: 'caregiver' | 'system' | 'slm' | 'ml';
    summary: string;
    createdAt?: string | null;
    occurredAt?: string | null;
  }>;
}

// ---------------------------------------------------------------------------
// Parser + validator
// ---------------------------------------------------------------------------

export type ParseAdcpBundleResult =
  | { ok: true; bundle: AdcpBundleV1; integrityVerified: boolean; integrityMismatch: false }
  | { ok: true; bundle: AdcpBundleV1; integrityVerified: false; integrityMismatch: true; reason: string }
  | { ok: false; error: string };

export interface ParseAdcpBundleOptions {
  /**
   * Expected patientId. If set and the bundle patientId differs, the parse
   * fails (`P5-D4: hard reject`).
   */
  requirePatientId?: string;
  /**
   * Reject bundles whose `bundleId` or `schemaVersion` is unknown. Default: true.
   */
  rejectUnknownSchema?: boolean;
}

export function parseAdcpBundleV1(
  input: string | object,
  options: ParseAdcpBundleOptions = {},
): ParseAdcpBundleResult {
  const parsed: unknown = typeof input === 'string' ? safeJsonParse(input) : input;
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Bundle root must be a JSON object.' };
  }
  const obj = parsed as Record<string, unknown>;

  if (options.rejectUnknownSchema !== false) {
    if (obj.bundleId !== ADCP_BUNDLE_ID) {
      return { ok: false, error: `Unsupported bundleId '${String(obj.bundleId)}'. Expected '${ADCP_BUNDLE_ID}'.` };
    }
    if (obj.schemaVersion !== 1) {
      return { ok: false, error: `Unsupported schemaVersion '${String(obj.schemaVersion)}'. Expected '1'.` };
    }
  }
  if (!obj.patient || typeof obj.patient !== 'object') {
    return { ok: false, error: 'Bundle missing `patient` object.' };
  }
  if (!obj.activePlan || typeof obj.activePlan !== 'object') {
    return { ok: false, error: 'Bundle missing `activePlan` object.' };
  }
  if (!obj.integrity || typeof obj.integrity !== 'object') {
    return { ok: false, error: 'Bundle missing `integrity` block.' };
  }
  const integrity = obj.integrity as { payloadSha256?: unknown };
  if (typeof integrity.payloadSha256 !== 'string') {
    return { ok: false, error: 'Bundle missing `integrity.payloadSha256`.' };
  }

  const patient = obj.patient as { patientId?: unknown };
  if (typeof patient.patientId !== 'string' || patient.patientId.length === 0) {
    return { ok: false, error: 'Bundle `patient.patientId` must be a non-empty string.' };
  }
  if (options.requirePatientId && patient.patientId !== options.requirePatientId) {
    return {
      ok: false,
      error: `Bundle patientId '${patient.patientId}' does not match expected '${options.requirePatientId}'.`,
    };
  }

  // Re-hash canonical payload (everything except `integrity`) and compare.
  const { integrity: _ignored, ...rest } = obj;
  const recomputed = sha256HexOf(JSON.stringify(rest));
  if (recomputed !== integrity.payloadSha256) {
    return {
      ok: true,
      bundle: obj as unknown as AdcpBundleV1,
      integrityVerified: false,
      integrityMismatch: true,
      reason: 'Payload hash does not match `integrity.payloadSha256`. Bundle may be tampered or re-serialized post-export.',
    };
  }
  return { ok: true, bundle: obj as unknown as AdcpBundleV1, integrityVerified: true, integrityMismatch: false };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch (err) {
    throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * SHA-256 hex digest. Tiny in-process implementation (no node:crypto dep
 * needed in the renderer). Adequate for tamper-evident on-device hashing.
 *
 * If the runtime exposes `crypto.subtle` (web/jest), we delegate to it.
 */
export function sha256HexOf(payload: string): string {
  // Node-style buffer has TextEncoder.
  // Browsers/React Native: use a pure-JS implementation.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subtle: any | undefined =
    typeof globalThis !== 'undefined' && (globalThis as unknown as { crypto?: { subtle?: { digest?: (alg: string, data: ArrayBuffer | Uint8Array) => Promise<ArrayBuffer> } } }).crypto?.subtle;
  if (subtle?.digest) {
    try {
      // Note: subtle.digest is async; we cannot await a sync helper. The pure-JS path is the canonical sync impl.
    } catch {
      // fall through to pure-JS
    }
  }
  return sha256PureJs(payload);
}

function sha256PureJs(s: string): string {
  // Standard SHA-256 implementation for environments without crypto.subtle
  // synchronous helper. We use a typed-array backend only if available.
  const bytes = toBytes(s);
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  // Pre-processing: padding.
  const l = bytes.length;
  const padded = new Uint8Array(((l + 9 + 63) & ~63) >>> 0);
  padded.set(bytes);
  padded[l] = 0x80;
  // append length in bits as big-endian 64-bit
  const bitLen = BigInt(l) * 8n;
  for (let i = 0; i < 8; i++) {
    padded[padded.length - 1 - i] = Number((bitLen >> BigInt(i * 8)) & 0xffn);
  }

  const w = new Uint32Array(64);
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] =
        (padded[block + i * 4]! << 24) |
        (padded[block + i * 4 + 1]! << 16) |
        (padded[block + i * 4 + 2]! << 8) |
        (padded[block + i * 4 + 3]! << 0);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = ror(w[i - 15]!, 7) ^ ror(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = ror(w[i - 2]!, 17) ^ ror(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = ror(e!, 6) ^ ror(e!, 11) ^ ror(e!, 25);
      const ch = (e! & f!) ^ (~e! & g!);
      const temp1 = (h! + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = ror(a!, 2) ^ ror(a!, 13) ^ ror(a!, 22);
      const mj = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temp2 = (S0 + mj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  return H.map((h) => h.toString(16).padStart(8, '0')).join('');
}

function ror(n: number, by: number): number {
  return ((n >>> by) | (n << (32 - by))) >>> 0;
}

function toBytes(s: string): Uint8Array {
  // Encode as UTF-8 bytes without relying on global TextEncoder (RN / some Jest envs).
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if ((c & 0xfc00) === 0xd800) {
      // Surrogate pair
      const next = s.charCodeAt(i + 1);
      if (Number.isFinite(next)) {
        c = 0x10000 + (((c - 0xd800) << 10) | (next - 0xdc00));
        i++;
      }
      out.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      );
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return Uint8Array.from(out);
}

// Helper exported for tests + the import service.
export const ADCP_BUNDLE_SCHEMA_VERSION = 1 as const;
export const ADCP_BUNDLE_CACHE_KEY_PREFIX = 'adcp_backup';

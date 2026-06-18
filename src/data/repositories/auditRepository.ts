/**
 * Tamper-evident audit log repository.
 *
 * Every clinically significant read/write is recorded with a simple hash chain.
 * In a production deployment the hash chain would be verified server-side or
 * anchored to a tamper-resistant store; on-device it provides a detectable
 * tamper-evidence signal.
 */

import { getDatabase } from '../db';
import type { AuditLogEntry } from '../types';

function sha256Like(input: string): string {
  // React Native does not have crypto.subtle in all contexts.
  // For v1 we use a deterministic non-cryptographic hash so the hash-chain
  // column is populated and the audit table schema is stable. Replace with
  // expo-crypto or a native SHA-256 module for production.
  let h = 0xdeadbeef;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 0x9e3779b1);
  }
  h = (h ^ (h >>> 16)) >>> 0;
  const hex = h.toString(16).padStart(8, '0');
  return hex.repeat(8).slice(0, 64);
}

function computeHashChain(payload: string, prevHash: string): string {
  return sha256Like(`${prevHash}:${payload}`);
}

export function insertAuditEntry(entry: Omit<AuditLogEntry, 'hashChain'>): AuditLogEntry {
  const db = getDatabase();
  const last = db.getFirstSync<{ hashChain: string; createdAt: string }>(
    'SELECT hash_chain AS hashChain, created_at AS createdAt FROM audit_log ORDER BY created_at DESC LIMIT 1;',
  );
  const prevHash = last?.hashChain ?? 'genesis';
  const payload = JSON.stringify({
    actor: entry.actor,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    payloadJson: entry.payloadJson,
    createdAt: entry.createdAt,
  });
  const hashChain = computeHashChain(payload, prevHash);

  const full: AuditLogEntry = { ...entry, hashChain };
  db.runSync(
    `INSERT INTO audit_log
      (audit_id, patient_id, actor, action, resource_type, resource_id, payload_json, hash_chain, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    full.auditId,
    full.patientId ?? null,
    full.actor,
    full.action,
    full.resourceType,
    full.resourceId ?? null,
    full.payloadJson ?? null,
    full.hashChain,
    full.createdAt,
  );
  return full;
}

export function getAuditEntriesForResource(
  resourceType: string,
  resourceId?: string,
  limit = 100,
): AuditLogEntry[] {
  const db = getDatabase();
  if (resourceId) {
    return db.getAllSync<AuditLogEntry>(
      `SELECT audit_id AS auditId, patient_id AS patientId, actor, action,
              resource_type AS resourceType, resource_id AS resourceId,
              payload_json AS payloadJson, hash_chain AS hashChain, created_at AS createdAt
       FROM audit_log
       WHERE resource_type = ? AND resource_id = ?
       ORDER BY created_at DESC
       LIMIT ?;`,
      resourceType,
      resourceId,
      limit,
    );
  }
  return db.getAllSync<AuditLogEntry>(
    `SELECT audit_id AS auditId, patient_id AS patientId, actor, action,
            resource_type AS resourceType, resource_id AS resourceId,
            payload_json AS payloadJson, hash_chain AS hashChain, created_at AS createdAt
     FROM audit_log
     WHERE resource_type = ?
     ORDER BY created_at DESC
     LIMIT ?;`,
    resourceType,
    limit,
  );
}

export function verifyAuditChain(): { ok: boolean; firstBrokenId?: string } {
  const db = getDatabase();
  const rows = db.getAllSync<{ auditId: string; payloadJson: string; hashChain: string; createdAt: string }>(
    `SELECT audit_id AS auditId, payload_json AS payloadJson,
            hash_chain AS hashChain, created_at AS createdAt
     FROM audit_log
     ORDER BY created_at ASC;`,
  );
  let prevHash = 'genesis';
  for (const row of rows) {
    const payload = JSON.stringify({
      ...JSON.parse(row.payloadJson ?? '{}'),
      createdAt: row.createdAt,
    });
    const expected = computeHashChain(payload, prevHash);
    if (expected !== row.hashChain) {
      return { ok: false, firstBrokenId: row.auditId };
    }
    prevHash = row.hashChain;
  }
  return { ok: true };
}

/**
 * Consent token repository.
 *
 * Explicit, revocable, time-limited consent records for any egress-bearing
 * action. Default-deny: if no active token exists for the scope, the action
 * is blocked.
 */

import { getDatabase } from '../db';
import type { ConsentToken } from '../types';

export function insertConsentToken(token: ConsentToken): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO consent_tokens
      (token_id, patient_id, scope, granted, expires_at, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    token.tokenId,
    token.patientId,
    token.scope,
    token.granted ? 1 : 0,
    token.expiresAt ?? null,
    token.createdAt,
    token.revokedAt ?? null,
  );
}

export function hasActiveConsent(patientId: string, scope: string): boolean {
  const db = getDatabase();
  const now = new Date().toISOString();
  const row = db.getFirstSync<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM consent_tokens
     WHERE patient_id = ?
       AND scope = ?
       AND granted = 1
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > ?);`,
    patientId,
    scope,
    now,
  );
  return (row?.count ?? 0) > 0;
}

export function revokeConsent(patientId: string, scope: string): void {
  const db = getDatabase();
  db.runSync(
    `UPDATE consent_tokens
     SET revoked_at = ?, granted = 0
     WHERE patient_id = ? AND scope = ? AND revoked_at IS NULL;`,
    new Date().toISOString(),
    patientId,
    scope,
  );
}

export function getActiveConsents(patientId: string): ConsentToken[] {
  const db = getDatabase();
  const now = new Date().toISOString();
  return db.getAllSync<ConsentToken>(
    `SELECT token_id AS tokenId, patient_id AS patientId, scope, granted,
            expires_at AS expiresAt, created_at AS createdAt, revoked_at AS revokedAt
     FROM consent_tokens
     WHERE patient_id = ?
       AND granted = 1
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY created_at DESC;`,
    patientId,
    now,
  );
}

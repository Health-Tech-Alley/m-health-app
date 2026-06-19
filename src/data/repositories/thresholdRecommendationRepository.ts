/**
 * Repository for the `threshold_recommendations` table.
 *
 * Stores queued personalization suggestions from the anomaly pipeline. They
 * are never auto-applied — the caregiver reviews them in Settings and
 * confirms (apply) or rejects (dismiss), each of which is audited.
 */
import { getDatabase } from '../db';
import type { ThresholdRecommendation, ThresholdRecommendationStatus } from '../types';

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
}

export function insertThresholdRecommendation(
  rec: Omit<ThresholdRecommendation, 'recommendationId' | 'status' | 'createdAt' | 'resolvedAt'> & {
    recommendationId?: string;
    status?: ThresholdRecommendationStatus;
    createdAt?: string;
  },
): ThresholdRecommendation {
  const db = getDatabase();
  const now = new Date().toISOString();
  const record: ThresholdRecommendation = {
    recommendationId: rec.recommendationId ?? makeId('thr'),
    patientId: rec.patientId,
    recommendedThreshold: rec.recommendedThreshold,
    adjustmentPct: rec.adjustmentPct,
    reason: rec.reason,
    status: rec.status ?? 'pending',
    createdAt: rec.createdAt ?? now,
  };

  db.runSync(
    `INSERT OR REPLACE INTO threshold_recommendations
      (recommendation_id, patient_id, recommended_threshold, adjustment_pct,
       reason, status, created_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    record.recommendationId,
    record.patientId,
    record.recommendedThreshold,
    record.adjustmentPct ?? null,
    record.reason ?? null,
    record.status,
    record.createdAt,
    record.resolvedAt ?? null,
  );

  return record;
}

const SELECT_COLUMNS = `
  recommendation_id AS recommendationId, patient_id AS patientId,
  recommended_threshold AS recommendedThreshold, adjustment_pct AS adjustmentPct,
  reason, status, created_at AS createdAt, resolved_at AS resolvedAt
`;

export function getPendingThresholdRecommendations(patientId: string): ThresholdRecommendation[] {
  const db = getDatabase();
  return db.getAllSync<ThresholdRecommendation>(
    `SELECT ${SELECT_COLUMNS}
     FROM threshold_recommendations
     WHERE patient_id = ? AND status = 'pending'
     ORDER BY created_at DESC;`,
    patientId,
  );
}

export function updateThresholdRecommendationStatus(
  recommendationId: string,
  status: ThresholdRecommendationStatus,
): void {
  const db = getDatabase();
  const resolvedAt = status === 'applied' || status === 'dismissed' ? new Date().toISOString() : null;
  db.runSync(
    `UPDATE threshold_recommendations
     SET status = ?, resolved_at = ?
     WHERE recommendation_id = ?;`,
    status,
    resolvedAt,
    recommendationId,
  );
}

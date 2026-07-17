import { getDatabase } from '@/data/db';
import type { PreviousUC4Priority } from '@/ml-models/uc4-micro-priorities';

export function insertUc4PreviousPriority(priority: PreviousUC4Priority): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.runSync(
    `INSERT OR REPLACE INTO uc4_previous_priorities (
      id, patient_id, template_id, shown_at_iso, caregiver_response, created_at
    ) VALUES (?, ?, ?, ?, ?, ?);`,
    `uc4-prev-${priority.patientId}-${priority.templateId}-${priority.shownAtIso}`,
    priority.patientId, priority.templateId, priority.shownAtIso,
    priority.caregiverResponse ?? null, now,
  );
}

export function getPreviousUc4Priorities(patientId: string): PreviousUC4Priority[] {
  try {
    const db = getDatabase();
    return db.getAllSync<{ patient_id: string; template_id: string; shown_at_iso: string; caregiver_response: string | null }>(
      `SELECT patient_id, template_id, shown_at_iso, caregiver_response
       FROM uc4_previous_priorities
       WHERE patient_id = ?
       ORDER BY shown_at_iso DESC
       LIMIT 20;`,
      patientId,
    ).map((row) => ({
      patientId: row.patient_id,
      templateId: row.template_id as PreviousUC4Priority['templateId'],
      shownAtIso: row.shown_at_iso,
      caregiverResponse: (row.caregiver_response as PreviousUC4Priority['caregiverResponse']) ?? undefined,
    }));
  } catch {
    return [];
  }
}

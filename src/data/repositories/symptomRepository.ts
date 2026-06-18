/**
 * Repository for the `symptoms` table.
 *
 * Structured symptom selections from the onboarding catalog + future EHR
 * import. Used to enrich the SLM system prompt and the Care tab.
 */

import { getDatabase } from '../db';
import type { Symptom, SymptomCategory } from '../types';

export function upsertSymptom(symptom: Symptom): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO symptoms
      (symptom_id, patient_id, label, category, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?);`,
    symptom.symptomId,
    symptom.patientId,
    symptom.label,
    symptom.category,
    symptom.source ?? 'onboarding',
    symptom.createdAt,
  );
}

export function replaceSymptomsForPatient(
  patientId: string,
  symptoms: Symptom[],
): void {
  const db = getDatabase();
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM symptoms WHERE patient_id = ?;', patientId);
    for (const s of symptoms) {
      db.runSync(
        `INSERT INTO symptoms
          (symptom_id, patient_id, label, category, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?);`,
        s.symptomId,
        s.patientId,
        s.label,
        s.category,
        s.source ?? 'onboarding',
        s.createdAt,
      );
    }
  });
}

export function getSymptomsForPatient(patientId: string): Symptom[] {
  const db = getDatabase();
  return db.getAllSync<Symptom>(
    `SELECT symptom_id AS symptomId, patient_id AS patientId, label, category,
            source, created_at AS createdAt
     FROM symptoms
     WHERE patient_id = ?
     ORDER BY category, label;`,
    patientId,
  );
}

export function getSymptomsByCategory(
  patientId: string,
  category: SymptomCategory,
): Symptom[] {
  const db = getDatabase();
  return db.getAllSync<Symptom>(
    `SELECT symptom_id AS symptomId, patient_id AS patientId, label, category,
            source, created_at AS createdAt
     FROM symptoms
     WHERE patient_id = ? AND category = ?
     ORDER BY label;`,
    patientId,
    category,
  );
}

export function deleteSymptomsForPatient(patientId: string): void {
  const db = getDatabase();
  db.runSync('DELETE FROM symptoms WHERE patient_id = ?;', patientId);
}

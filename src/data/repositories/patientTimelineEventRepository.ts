import { getDatabase } from '../db';
import type { PatientTimelineEvent } from '../types';

export function upsertPatientTimelineEvent(event: PatientTimelineEvent): void {
  const db = getDatabase();
  db.runSync(
    `INSERT INTO patient_timeline_events (
       event_id, patient_id, event_type, title, summary, visit_index,
       days_from_first_visit, days_before_latest_visit, source_file,
       source_section, confidence, transition_planning_relevance, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id) DO UPDATE SET
       patient_id = excluded.patient_id,
       event_type = excluded.event_type,
       title = excluded.title,
       summary = excluded.summary,
       visit_index = excluded.visit_index,
       days_from_first_visit = excluded.days_from_first_visit,
       days_before_latest_visit = excluded.days_before_latest_visit,
       source_file = excluded.source_file,
       source_section = excluded.source_section,
       confidence = excluded.confidence,
       transition_planning_relevance = excluded.transition_planning_relevance;`,
    event.eventId,
    event.patientId,
    event.eventType,
    event.title,
    event.summary,
    event.visitIndex,
    event.daysFromFirstVisit,
    event.daysBeforeLatestVisit,
    event.sourceFile,
    event.sourceSection,
    event.confidence,
    event.clinicalRelevance,
    event.createdAt,
  );
}

export function getPatientTimelineEvents(patientId: string): PatientTimelineEvent[] {
  const db = getDatabase();
  return db.getAllSync<PatientTimelineEvent>(
    `SELECT event_id AS eventId,
            patient_id AS patientId,
            event_type AS eventType,
            title,
            summary,
            visit_index AS visitIndex,
            days_from_first_visit AS daysFromFirstVisit,
            days_before_latest_visit AS daysBeforeLatestVisit,
            source_file AS sourceFile,
            source_section AS sourceSection,
            confidence,
            transition_planning_relevance AS clinicalRelevance,
            created_at AS createdAt
     FROM patient_timeline_events
     WHERE patient_id = ?
     ORDER BY days_from_first_visit DESC, visit_index DESC;`,
    patientId,
  );
}

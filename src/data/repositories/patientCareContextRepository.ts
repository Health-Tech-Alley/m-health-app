import { getDatabase } from '../db';
import type { PatientCareContextItem } from '../types';

type DatabaseLike = ReturnType<typeof getDatabase>;

export function upsertPatientCareContextItem(
  item: PatientCareContextItem,
  db: DatabaseLike = getDatabase(),
): void {
  db.runSync(
    `INSERT INTO patient_care_context_items (
       item_id, patient_id, context_category, plain_title, factual_summary,
       source_excerpt, source_document, source_section, visit_index,
       days_from_first_visit, source_path, related_timeline_event, handling_json,
       confidence, limitations, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET
       patient_id = excluded.patient_id,
       context_category = excluded.context_category,
       plain_title = excluded.plain_title,
       factual_summary = excluded.factual_summary,
       source_excerpt = excluded.source_excerpt,
       source_document = excluded.source_document,
       source_section = excluded.source_section,
       visit_index = excluded.visit_index,
       days_from_first_visit = excluded.days_from_first_visit,
       source_path = excluded.source_path,
       related_timeline_event = excluded.related_timeline_event,
       handling_json = excluded.handling_json,
       confidence = excluded.confidence,
       limitations = excluded.limitations,
       updated_at = excluded.updated_at;`,
    item.itemId,
    item.patientId,
    item.contextCategory,
    item.plainTitle,
    item.factualSummary,
    item.sourceExcerpt,
    item.sourceDocument,
    item.sourceSection,
    item.visitIndex ?? null,
    item.daysFromFirstVisit ?? null,
    item.sourcePath ?? null,
    item.relatedTimelineEvent ?? null,
    JSON.stringify(item.handling),
    item.confidence ?? null,
    item.limitations ?? null,
    item.createdAt,
    item.updatedAt,
  );
}

export function getPatientCareContextItems(patientId: string): PatientCareContextItem[] {
  const db = getDatabase();
  const rows = db.getAllSync<
    Omit<PatientCareContextItem, 'handling'> & { handlingJson: string }
  >(
    `SELECT item_id AS itemId,
            patient_id AS patientId,
            context_category AS contextCategory,
            plain_title AS plainTitle,
            factual_summary AS factualSummary,
            source_excerpt AS sourceExcerpt,
            source_document AS sourceDocument,
            source_section AS sourceSection,
            visit_index AS visitIndex,
            days_from_first_visit AS daysFromFirstVisit,
            source_path AS sourcePath,
            related_timeline_event AS relatedTimelineEvent,
            handling_json AS handlingJson,
            confidence,
            limitations,
            created_at AS createdAt,
            updated_at AS updatedAt
     FROM patient_care_context_items
     WHERE patient_id = ?
     ORDER BY COALESCE(days_from_first_visit, -1) DESC,
              COALESCE(visit_index, -1) DESC,
              plain_title ASC;`,
    patientId,
  );

  return rows.map(({ handlingJson, ...row }) => ({
    ...row,
    handling: parseHandling(handlingJson),
  }));
}

function parseHandling(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

import { getDatabase } from '@/data/db';

export interface Uc4CaregiverResponseRow {
  event_id: string;
  patient_id: string;
  originating_card_id: string | null;
  originating_template_id: string | null;
  timestamp_iso: string;
  observation_codes_json: string;
  context_codes_json: string;
  caregiver_requested_provider_review: number;
  short_text: string | null;
  free_text_used_for_scoring: number;
  used_for_scoring: number;
  action: string | null;
  created_at: string;
}

export function insertUc4CaregiverResponse(row: {
  eventId: string;
  patientId: string;
  originatingCardId?: string | null;
  originatingTemplateId?: string | null;
  timestampIso: string;
  observationCodesJson: string;
  contextCodesJson: string;
  caregiverRequestedProviderReview?: boolean;
  shortText?: string | null;
  freeTextUsedForScoring?: boolean;
  usedForScoring?: boolean;
  action?: string | null;
}): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.runSync(
    `INSERT INTO uc4_caregiver_responses (
      event_id, patient_id, originating_card_id, originating_template_id,
      timestamp_iso, observation_codes_json, context_codes_json,
      caregiver_requested_provider_review, short_text,
      free_text_used_for_scoring, used_for_scoring, action, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    row.eventId, row.patientId, row.originatingCardId ?? null, row.originatingTemplateId ?? null,
    row.timestampIso, row.observationCodesJson, row.contextCodesJson,
    row.caregiverRequestedProviderReview ? 1 : 0, row.shortText ?? null,
    row.freeTextUsedForScoring ? 1 : 0, row.usedForScoring ? 1 : 0,
    row.action ?? null, now,
  );
}

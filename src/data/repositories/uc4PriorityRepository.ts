import { getDatabase } from '../db';
import type {
  LatestUc4PriorityCardSummary,
  LatestUc4RunSummary,
  Uc4CaregiverResponseSummary,
  Uc4PriorityCardStatus,
  Uc4RunStatus,
  Uc4WhatToLogNextFieldSummary,
} from '../types';
import type {
  UC4AuditRecord,
  UC4Candidate,
  UC4PriorityCard,
  UC4TemplateId,
} from '../../ml-models/uc4-micro-priorities';

export type SaveUc4RunInput = {
  runId: string;
  patientId: string;
  status: Uc4RunStatus;
  pauseReason?: string | null;
  generatedAt: string;
  engineVersion: string;
  schemaVersion: string;
  templateRegistryVersion: string;
  ruleRegistryVersion: string;
  scoringVersion: string;
  candidates: UC4Candidate[];
  auditRecords: UC4AuditRecord[];
  cards: UC4PriorityCard[];
};

export type SaveUc4CaregiverResponseInput = {
  responseId: string;
  patientId: string;
  cardId?: string | null;
  templateId?: string | null;
  action: 'acknowledged' | 'dismissed' | 'completed' | 'caregiver_response_submitted' | 'provider_review_requested';
  observationCodes: string[];
  contextCodes: string[];
  caregiverRequestedProviderReview?: boolean;
  shortText?: string | null;
};

type Uc4RunRow = {
  runId: string;
  patientId: string;
  status: Uc4RunStatus;
  pauseReason?: string | null;
  generatedAt: string;
  engineVersion: string;
  schemaVersion: string;
  templateRegistryVersion: string;
  ruleRegistryVersion: string;
  scoringVersion: string;
  cardCount: number;
};

type Uc4CardRow = {
  cardId: string;
  patientId: string;
  runId: string;
  templateId: string;
  priorityKind: string;
  title: string;
  body: string;
  domain: string;
  score: number;
  firedRuleCodesJson: string;
  evidenceJson: string;
  whatToLogNextSchemaJson: string;
  safetyBoundary: string;
  status: Uc4PriorityCardStatus;
  generatedAt: string;
};

type Uc4ResponseRow = {
  responseId: string;
  patientId: string;
  cardId?: string | null;
  templateId?: string | null;
  action: string;
  observationCodesJson: string;
  contextCodesJson: string;
  caregiverRequestedProviderReview: number;
  shortText?: string | null;
  createdAt: string;
};

function parseStringArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseArray(json: string): unknown[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseSchema(json: string): Uc4WhatToLogNextFieldSummary[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((field): field is Record<string, unknown> => typeof field === 'object' && field !== null)
      .map((field) => ({
        fieldId: typeof field.fieldId === 'string' ? field.fieldId : '',
        label: typeof field.label === 'string' ? field.label : '',
        type: typeof field.type === 'string' ? field.type : '',
        required: field.required === true,
        options: Array.isArray(field.options)
          ? field.options.filter((option): option is string => typeof option === 'string')
          : undefined,
        usedForScoring: field.usedForScoring === true,
      }))
      .filter((field) => field.fieldId && field.label);
  } catch {
    return [];
  }
}

function toCardSummary(row: Uc4CardRow): LatestUc4PriorityCardSummary {
  return {
    cardId: row.cardId,
    patientId: row.patientId,
    runId: row.runId,
    templateId: row.templateId,
    priorityKind: row.priorityKind,
    title: row.title,
    body: row.body,
    domain: row.domain,
    score: row.score,
    firedRuleCodes: parseStringArray(row.firedRuleCodesJson),
    evidence: parseArray(row.evidenceJson),
    whatToLogNextSchema: parseSchema(row.whatToLogNextSchemaJson),
    safetyBoundary: row.safetyBoundary,
    status: row.status,
    generatedAt: row.generatedAt,
  };
}

function cardIdFor(runId: string, card: UC4PriorityCard, index: number): string {
  return `${runId}:${card.templateId}:${index}`;
}

export function saveUc4Run(input: SaveUc4RunInput): void {
  const db = getDatabase();
  const createdAt = new Date().toISOString();
  db.withTransactionSync(() => {
    db.runSync(
      `UPDATE uc4_priority_cards
       SET status = 'superseded', updated_at = ?
       WHERE patient_id = ? AND status = 'active';`,
      createdAt,
      input.patientId,
    );
    db.runSync(
      `INSERT OR REPLACE INTO uc4_runs (
        run_id, patient_id, status, pause_reason, generated_at,
        engine_version, schema_version, template_registry_version,
        rule_registry_version, scoring_version, candidates_json,
        audit_records_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      input.runId,
      input.patientId,
      input.status,
      input.pauseReason ?? null,
      input.generatedAt,
      input.engineVersion,
      input.schemaVersion,
      input.templateRegistryVersion,
      input.ruleRegistryVersion,
      input.scoringVersion,
      JSON.stringify(input.candidates),
      JSON.stringify(input.auditRecords),
      createdAt,
    );
    input.cards.forEach((card, index) => {
      db.runSync(
        `INSERT OR REPLACE INTO uc4_priority_cards (
          card_id, patient_id, run_id, template_id, priority_kind,
          title, body, domain, score, fired_rule_codes_json,
          evidence_json, what_to_log_next_schema_json, safety_boundary,
          free_text_used_for_scoring, status, generated_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        cardIdFor(input.runId, card, index),
        input.patientId,
        input.runId,
        card.templateId,
        card.priorityKind,
        card.title,
        card.body,
        card.domain,
        card.score,
        JSON.stringify(card.firedRuleCodes),
        JSON.stringify(card.evidence),
        JSON.stringify(card.whatToLogNextSchema),
        card.safetyBoundary,
        card.freeTextUsedForScoring ? 1 : 0,
        'active',
        card.generatedAtIso,
        createdAt,
        createdAt,
      );
    });
  });
}

export function getLatestUc4RunSummary(patientId: string): LatestUc4RunSummary | null {
  const row = getDatabase().getFirstSync<Uc4RunRow>(
    `SELECT r.run_id AS runId, r.patient_id AS patientId, r.status,
            r.pause_reason AS pauseReason, r.generated_at AS generatedAt,
            r.engine_version AS engineVersion, r.schema_version AS schemaVersion,
            r.template_registry_version AS templateRegistryVersion,
            r.rule_registry_version AS ruleRegistryVersion,
            r.scoring_version AS scoringVersion,
            COUNT(c.card_id) AS cardCount
     FROM uc4_runs r
     LEFT JOIN uc4_priority_cards c ON c.run_id = r.run_id
     WHERE r.patient_id = ?
     GROUP BY r.run_id
     ORDER BY r.generated_at DESC
     LIMIT 1;`,
    patientId,
  );
  if (!row) return null;
  return {
    runId: row.runId,
    patientId: row.patientId,
    status: row.status,
    paused: row.status === 'paused',
    pauseReason: row.pauseReason ?? null,
    generatedAt: row.generatedAt,
    engineVersion: row.engineVersion,
    schemaVersion: row.schemaVersion,
    templateRegistryVersion: row.templateRegistryVersion,
    ruleRegistryVersion: row.ruleRegistryVersion,
    scoringVersion: row.scoringVersion,
    cardCount: row.cardCount,
  };
}

export function getUc4RunSummaryById(runId: string): LatestUc4RunSummary | null {
  const row = getDatabase().getFirstSync<Uc4RunRow>(
    `SELECT r.run_id AS runId, r.patient_id AS patientId, r.status,
            r.pause_reason AS pauseReason, r.generated_at AS generatedAt,
            r.engine_version AS engineVersion, r.schema_version AS schemaVersion,
            r.template_registry_version AS templateRegistryVersion,
            r.rule_registry_version AS ruleRegistryVersion,
            r.scoring_version AS scoringVersion,
            COUNT(c.card_id) AS cardCount
     FROM uc4_runs r
     LEFT JOIN uc4_priority_cards c ON c.run_id = r.run_id
     WHERE r.run_id = ?
     GROUP BY r.run_id
     LIMIT 1;`,
    runId,
  );
  if (!row) return null;
  return {
    runId: row.runId,
    patientId: row.patientId,
    status: row.status,
    paused: row.status === 'paused',
    pauseReason: row.pauseReason ?? null,
    generatedAt: row.generatedAt,
    engineVersion: row.engineVersion,
    schemaVersion: row.schemaVersion,
    templateRegistryVersion: row.templateRegistryVersion,
    ruleRegistryVersion: row.ruleRegistryVersion,
    scoringVersion: row.scoringVersion,
    cardCount: row.cardCount,
  };
}

export function getActiveUc4PriorityCardSummaries(
  patientId: string,
  limit = 3,
): LatestUc4PriorityCardSummary[] {
  return getDatabase()
    .getAllSync<Uc4CardRow>(
      `SELECT card_id AS cardId, patient_id AS patientId, run_id AS runId,
              template_id AS templateId, priority_kind AS priorityKind,
              title, body, domain, score, fired_rule_codes_json AS firedRuleCodesJson,
              evidence_json AS evidenceJson,
              what_to_log_next_schema_json AS whatToLogNextSchemaJson,
              safety_boundary AS safetyBoundary, status, generated_at AS generatedAt
       FROM uc4_priority_cards
       WHERE patient_id = ? AND status = 'active'
       ORDER BY score DESC, generated_at DESC
       LIMIT ?;`,
      patientId,
      limit,
    )
    .map(toCardSummary);
}

export function getUc4PriorityCardSummaryById(
  cardId: string,
): LatestUc4PriorityCardSummary | null {
  const row = getDatabase().getFirstSync<Uc4CardRow>(
    `SELECT card_id AS cardId, patient_id AS patientId, run_id AS runId,
            template_id AS templateId, priority_kind AS priorityKind,
            title, body, domain, score, fired_rule_codes_json AS firedRuleCodesJson,
            evidence_json AS evidenceJson,
            what_to_log_next_schema_json AS whatToLogNextSchemaJson,
            safety_boundary AS safetyBoundary, status, generated_at AS generatedAt
     FROM uc4_priority_cards
     WHERE card_id = ?
     LIMIT 1;`,
    cardId,
  );
  return row ? toCardSummary(row) : null;
}

export function getUc4PriorityCardSummariesForRun(
  patientId: string,
  runId: string,
  limit = 3,
): LatestUc4PriorityCardSummary[] {
  return getDatabase()
    .getAllSync<Uc4CardRow>(
      `SELECT card_id AS cardId, patient_id AS patientId, run_id AS runId,
              template_id AS templateId, priority_kind AS priorityKind,
              title, body, domain, score, fired_rule_codes_json AS firedRuleCodesJson,
              evidence_json AS evidenceJson,
              what_to_log_next_schema_json AS whatToLogNextSchemaJson,
              safety_boundary AS safetyBoundary, status, generated_at AS generatedAt
       FROM uc4_priority_cards
       WHERE patient_id = ? AND run_id = ?
       ORDER BY score DESC, generated_at DESC
       LIMIT ?;`,
      patientId,
      runId,
      limit,
    )
    .map(toCardSummary);
}

export function getUc4CaregiverResponses(
  patientId: string,
  limit = 20,
): Uc4CaregiverResponseSummary[] {
  return getDatabase()
    .getAllSync<Uc4ResponseRow>(
      `SELECT response_id AS responseId, patient_id AS patientId, card_id AS cardId,
              template_id AS templateId, action,
              observation_codes_json AS observationCodesJson,
              context_codes_json AS contextCodesJson,
              caregiver_requested_provider_review AS caregiverRequestedProviderReview,
              short_text AS shortText, created_at AS createdAt
       FROM uc4_caregiver_responses
       WHERE patient_id = ?
       ORDER BY created_at DESC
       LIMIT ?;`,
      patientId,
      limit,
    )
    .map((row) => ({
      responseId: row.responseId,
      patientId: row.patientId,
      cardId: row.cardId ?? null,
      templateId: row.templateId ?? null,
      action: row.action,
      observationCodes: parseStringArray(row.observationCodesJson),
      contextCodes: parseStringArray(row.contextCodesJson),
      caregiverRequestedProviderReview: row.caregiverRequestedProviderReview === 1,
      shortText: row.shortText ?? null,
      createdAt: row.createdAt,
    }));
}

export function getPreviousUc4Priorities(patientId: string): Array<{
  patientId: string;
  templateId: UC4TemplateId;
  shownAtIso: string;
  caregiverResponse?: 'helpful' | 'dismissed' | 'not_relevant' | 'logged_observation';
}> {
  return getDatabase()
    .getAllSync<{
      patientId: string;
      templateId: UC4TemplateId;
      generatedAt: string;
      status: Uc4PriorityCardStatus;
    }>(
      `SELECT patient_id AS patientId, template_id AS templateId,
              generated_at AS generatedAt, status
       FROM uc4_priority_cards
       WHERE patient_id = ?
       ORDER BY generated_at DESC
       LIMIT 20;`,
      patientId,
    )
    .map((row) => ({
      patientId: row.patientId,
      templateId: row.templateId,
      shownAtIso: row.generatedAt,
      caregiverResponse:
        row.status === 'dismissed'
          ? 'dismissed'
          : row.status === 'completed'
            ? 'logged_observation'
            : undefined,
    }));
}

export function saveUc4CaregiverResponse(input: SaveUc4CaregiverResponseInput): void {
  const db = getDatabase();
  const createdAt = new Date().toISOString();
  const nextStatus: Uc4PriorityCardStatus =
    input.action === 'dismissed'
      ? 'dismissed'
      : input.action === 'caregiver_response_submitted' || input.action === 'completed'
        ? 'completed'
        : 'acknowledged';
  db.withTransactionSync(() => {
    db.runSync(
      `INSERT INTO uc4_caregiver_responses (
        response_id, patient_id, card_id, template_id, action,
        observation_codes_json, context_codes_json,
        caregiver_requested_provider_review, short_text,
        free_text_used_for_scoring, used_for_scoring, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      input.responseId,
      input.patientId,
      input.cardId ?? null,
      input.templateId ?? null,
      input.action,
      JSON.stringify(input.observationCodes),
      JSON.stringify(input.contextCodes),
      input.caregiverRequestedProviderReview ? 1 : 0,
      input.shortText ?? null,
      0,
      0,
      createdAt,
    );
    if (input.cardId) {
      db.runSync(
        `UPDATE uc4_priority_cards
         SET status = ?, updated_at = ?
         WHERE card_id = ? AND patient_id = ?;`,
        nextStatus,
        createdAt,
        input.cardId,
        input.patientId,
      );
    }
  });
}

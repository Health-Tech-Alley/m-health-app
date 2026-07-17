import {
  getActiveUc4PriorityCardSummaries,
  getLatestUc4RunSummary,
  getPreviousUc4Priorities,
  getUc4CaregiverResponses,
  saveUc4CaregiverResponse,
  saveUc4Run,
} from './repositories/uc4PriorityRepository';
import type { SaveUc4RunInput } from './repositories/uc4PriorityRepository';

type RunRow = {
  run_id: string;
  patient_id: string;
  status: 'completed' | 'paused' | 'no_cards' | 'error';
  pause_reason?: string | null;
  generated_at: string;
  engine_version: string;
  schema_version: string;
  template_registry_version: string;
  rule_registry_version: string;
  scoring_version: string;
};

type CardRow = {
  card_id: string;
  patient_id: string;
  run_id: string;
  template_id: string;
  priority_kind: string;
  title: string;
  body: string;
  domain: string;
  score: number;
  fired_rule_codes_json: string;
  evidence_json: string;
  what_to_log_next_schema_json: string;
  safety_boundary: string;
  status: 'active' | 'acknowledged' | 'completed' | 'dismissed' | 'superseded';
  generated_at: string;
};

type ResponseRow = {
  response_id: string;
  patient_id: string;
  card_id?: string | null;
  template_id?: string | null;
  action: string;
  observation_codes_json: string;
  context_codes_json: string;
  caregiver_requested_provider_review: number;
  short_text?: string | null;
  created_at: string;
};

const runs: RunRow[] = [];
const cards: CardRow[] = [];
const responses: ResponseRow[] = [];

const mockDb = {
  withTransactionSync: jest.fn((fn: () => void) => fn()),
  runSync: jest.fn((sql: string, ...args: unknown[]) => {
    if (sql.includes("SET status = 'superseded'")) {
      const [updatedAt, patientId] = args;
      cards.forEach((card) => {
        if (card.patient_id === patientId && card.status === 'active') {
          card.status = 'superseded';
          void updatedAt;
        }
      });
      return;
    }
    if (sql.includes('INSERT OR REPLACE INTO uc4_runs')) {
      const [
        runId, patientId, status, pauseReason, generatedAt, engineVersion,
        schemaVersion, templateRegistryVersion, ruleRegistryVersion, scoringVersion,
      ] = args;
      runs.push({
        run_id: String(runId),
        patient_id: String(patientId),
        status: status as RunRow['status'],
        pause_reason: pauseReason ? String(pauseReason) : null,
        generated_at: String(generatedAt),
        engine_version: String(engineVersion),
        schema_version: String(schemaVersion),
        template_registry_version: String(templateRegistryVersion),
        rule_registry_version: String(ruleRegistryVersion),
        scoring_version: String(scoringVersion),
      });
      return;
    }
    if (sql.includes('INSERT OR REPLACE INTO uc4_priority_cards')) {
      const [
        cardId, patientId, runId, templateId, priorityKind, title, body,
        domain, score, firedRuleCodesJson, evidenceJson, schemaJson,
        safetyBoundary, , status, generatedAt,
      ] = args;
      cards.push({
        card_id: String(cardId),
        patient_id: String(patientId),
        run_id: String(runId),
        template_id: String(templateId),
        priority_kind: String(priorityKind),
        title: String(title),
        body: String(body),
        domain: String(domain),
        score: Number(score),
        fired_rule_codes_json: String(firedRuleCodesJson),
        evidence_json: String(evidenceJson),
        what_to_log_next_schema_json: String(schemaJson),
        safety_boundary: String(safetyBoundary),
        status: status as CardRow['status'],
        generated_at: String(generatedAt),
      });
      return;
    }
    if (sql.includes('INSERT INTO uc4_caregiver_responses')) {
      const [
        responseId, patientId, cardId, templateId, action,
        observationCodesJson, contextCodesJson, requestedReview, shortText,
      ] = args;
      responses.push({
        response_id: String(responseId),
        patient_id: String(patientId),
        card_id: cardId ? String(cardId) : null,
        template_id: templateId ? String(templateId) : null,
        action: String(action),
        observation_codes_json: String(observationCodesJson),
        context_codes_json: String(contextCodesJson),
        caregiver_requested_provider_review: Number(requestedReview),
        short_text: shortText ? String(shortText) : null,
        created_at: '2026-07-17T12:00:00.000Z',
      });
      return;
    }
    if (sql.includes('UPDATE uc4_priority_cards') && sql.includes('SET status = ?')) {
      const [status, , cardId, patientId] = args;
      cards.forEach((card) => {
        if (card.card_id === cardId && card.patient_id === patientId) {
          card.status = status as CardRow['status'];
        }
      });
    }
  }),
  getFirstSync: jest.fn((sql: string, ...args: unknown[]) => {
    if (sql.includes('FROM uc4_runs')) {
      const [patientId] = args;
      const run = runs
        .filter((item) => item.patient_id === patientId)
        .sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0];
      if (!run) return null;
      return {
        runId: run.run_id,
        patientId: run.patient_id,
        status: run.status,
        pauseReason: run.pause_reason,
        generatedAt: run.generated_at,
        engineVersion: run.engine_version,
        schemaVersion: run.schema_version,
        templateRegistryVersion: run.template_registry_version,
        ruleRegistryVersion: run.rule_registry_version,
        scoringVersion: run.scoring_version,
        cardCount: cards.filter((card) => card.run_id === run.run_id).length,
      };
    }
    return null;
  }),
  getAllSync: jest.fn((sql: string, ...args: unknown[]) => {
    if (sql.includes('FROM uc4_priority_cards') && sql.includes("status = 'active'")) {
      const [patientId, limit] = args;
      return cards
        .filter((card) => card.patient_id === patientId && card.status === 'active')
        .sort((a, b) => b.score - a.score)
        .slice(0, Number(limit))
        .map(toCardRepoRow);
    }
    if (sql.includes('FROM uc4_caregiver_responses')) {
      const [patientId] = args;
      return responses
        .filter((response) => response.patient_id === patientId)
        .map((response) => ({
          responseId: response.response_id,
          patientId: response.patient_id,
          cardId: response.card_id,
          templateId: response.template_id,
          action: response.action,
          observationCodesJson: response.observation_codes_json,
          contextCodesJson: response.context_codes_json,
          caregiverRequestedProviderReview: response.caregiver_requested_provider_review,
          shortText: response.short_text,
          createdAt: response.created_at,
        }));
    }
    if (sql.includes('FROM uc4_priority_cards')) {
      const [patientId] = args;
      return cards
        .filter((card) => card.patient_id === patientId)
        .map((card) => ({
          patientId: card.patient_id,
          templateId: card.template_id,
          generatedAt: card.generated_at,
          status: card.status,
        }));
    }
    return [];
  }),
};

jest.mock('./db', () => ({
  getDatabase: () => mockDb,
}));

function toCardRepoRow(row: CardRow) {
  return {
    cardId: row.card_id,
    patientId: row.patient_id,
    runId: row.run_id,
    templateId: row.template_id,
    priorityKind: row.priority_kind,
    title: row.title,
    body: row.body,
    domain: row.domain,
    score: row.score,
    firedRuleCodesJson: row.fired_rule_codes_json,
    evidenceJson: row.evidence_json,
    whatToLogNextSchemaJson: row.what_to_log_next_schema_json,
    safetyBoundary: row.safety_boundary,
    status: row.status,
    generatedAt: row.generated_at,
  };
}

function runInput(overrides: Partial<SaveUc4RunInput> = {}): SaveUc4RunInput {
  return {
    runId: `run-${runs.length + 1}`,
    patientId: 'patient-1',
    status: 'completed',
    generatedAt: `2026-07-17T12:0${runs.length}:00.000Z`,
    engineVersion: 'uc4_structured_micropriority_engine_v0.1.0',
    schemaVersion: 'uc4_schema_v0.1.0',
    templateRegistryVersion: 'uc4_template_registry_v0.1.0',
    ruleRegistryVersion: 'uc4_rule_registry_v0.1.0',
    scoringVersion: 'uc4_scoring_v0.1.0',
    candidates: [],
    auditRecords: [],
    cards: [{
      patientId: 'patient-1',
      templateId: 'THERAPY_REHAB_ROUTINE_DIFFICULTY',
      title: 'Track therapy routine',
      body: 'Track when therapy is difficult.',
      priorityKind: 'recurring_concern',
      domain: 'rehab',
      score: 0.8,
      firedRuleCodes: ['R_THERAPY_ROUTINE_DIFFICULTY'],
      evidence: [{ fieldPath: 'recentEvents', value: true, comparator: 'eq', source: 'structured_events' }],
      whatToLogNextSchema: [{
        fieldId: 'difficulty',
        label: 'Was therapy difficult?',
        type: 'single_select',
        required: true,
        options: ['YES', 'NO'],
        usedForScoring: true,
      }],
      freeTextUsedForScoring: false,
      safetyBoundary: 'Observation support only.',
      generatedAtIso: '2026-07-17T12:00:00.000Z',
      versions: {
        schema: 'uc4_schema_v0.1.0',
        templateRegistry: 'uc4_template_registry_v0.1.0',
        ruleRegistry: 'uc4_rule_registry_v0.1.0',
        scoring: 'uc4_scoring_v0.1.0',
        engine: 'uc4_structured_micropriority_engine_v0.1.0',
      },
    }],
    ...overrides,
  };
}

beforeEach(() => {
  runs.length = 0;
  cards.length = 0;
  responses.length = 0;
  jest.clearAllMocks();
});

describe('uc4PriorityRepository', () => {
  it('hydrates latest run and active card summaries for restart state', () => {
    saveUc4Run(runInput());

    expect(getLatestUc4RunSummary('patient-1')).toMatchObject({
      runId: 'run-1',
      status: 'completed',
      cardCount: 1,
    });
    expect(getActiveUc4PriorityCardSummaries('patient-1')).toMatchObject([
      {
        cardId: 'run-1:THERAPY_REHAB_ROUTINE_DIFFICULTY:0',
        templateId: 'THERAPY_REHAB_ROUTINE_DIFFICULTY',
        whatToLogNextSchema: [{ fieldId: 'difficulty' }],
      },
    ]);
  });

  it('keeps patient cards isolated and clears stale cards on paused runs', () => {
    saveUc4Run(runInput());
    saveUc4Run(runInput({ patientId: 'patient-2', runId: 'other-run' }));
    saveUc4Run(runInput({
      runId: 'paused-run',
      status: 'paused',
      pauseReason: 'active emergency',
      cards: [],
    }));

    expect(getActiveUc4PriorityCardSummaries('patient-1')).toEqual([]);
    expect(getActiveUc4PriorityCardSummaries('patient-2')).toHaveLength(1);
    expect(getLatestUc4RunSummary('patient-1')).toMatchObject({
      runId: 'paused-run',
      status: 'paused',
      paused: true,
    });
  });

  it('persists caregiver responses and previous priority response state', () => {
    saveUc4Run(runInput());
    saveUc4CaregiverResponse({
      responseId: 'response-1',
      patientId: 'patient-1',
      cardId: 'run-1:THERAPY_REHAB_ROUTINE_DIFFICULTY:0',
      templateId: 'THERAPY_REHAB_ROUTINE_DIFFICULTY',
      action: 'caregiver_response_submitted',
      observationCodes: ['THERAPY_ROUTINE_DIFFICULTY'],
      contextCodes: ['AFTER_ACTIVITY_OR_THERAPY'],
      caregiverRequestedProviderReview: false,
      shortText: 'Logged context',
    });

    expect(getUc4CaregiverResponses('patient-1')).toMatchObject([
      {
        responseId: 'response-1',
        observationCodes: ['THERAPY_ROUTINE_DIFFICULTY'],
        contextCodes: ['AFTER_ACTIVITY_OR_THERAPY'],
      },
    ]);
    expect(getPreviousUc4Priorities('patient-1')).toMatchObject([
      {
        templateId: 'THERAPY_REHAB_ROUTINE_DIFFICULTY',
        caregiverResponse: 'logged_observation',
      },
    ]);
  });
});

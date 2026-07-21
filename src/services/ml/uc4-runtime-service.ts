import { getPatientRecordSnapshot } from '@/data/repositories/patientRecordRepository';
import { getOpenAlerts } from '@/data/repositories/alertRepository';
import { getEventBus } from '@/orchestration/event-bus';
import {
  runUC4StructuredMicroPriorities,
  renderUC4ProviderSummary,
} from '@/ml-models/uc4-micro-priorities';
import { buildUc4RunInput } from '@/ml-models/uc4-micro-priorities/uc4SnapshotAdapter';
import {
  insertUc4PriorityCards,
  supersedeActiveUc4Cards,
  acknowledgeUc4Card,
  dismissUc4Card,
  getUc4CardById,
} from '@/data/repositories/uc4PriorityCardRepository';
import {
  getRecentUc4Events,
  insertUc4RecentEvent,
} from '@/data/repositories/uc4RecentEventRepository';
import {
  getPreviousUc4Priorities,
  insertUc4PreviousPriority,
} from '@/data/repositories/uc4PreviousPriorityRepository';
import { insertUc4CaregiverResponse } from '@/data/repositories/uc4CaregiverResponseRepository';
import type {
  UC4SeverityContext,
  UC4PriorityCard,
  ObservationCode,
  ContextCode,
} from '@/ml-models/uc4-micro-priorities';

export interface Uc4PersistResult {
  runId: string;
  paused: boolean;
  pauseReason?: string;
  cardCount: number;
  cards: UC4PriorityCard[];
  providerSummary?: string;
}

function resolveSeverityContext(patientId: string): {
  uc1ActiveEmergency: boolean;
  severityContext: UC4SeverityContext;
} {
  try {
    const open = getOpenAlerts(patientId);
    const hasSev3 = open.some((a) => a.severity === 3);
    if (hasSev3) {
      return {
        uc1ActiveEmergency: true,
        severityContext: 'uc1_or_uc2_severity_3_emergency',
      };
    }
    if (open.some((a) => a.severity === 2)) {
      return {
        uc1ActiveEmergency: false,
        severityContext: 'uc2_severity_2_provider_review',
      };
    }
    if (open.some((a) => a.severity === 1)) {
      return {
        uc1ActiveEmergency: false,
        severityContext: 'uc2_severity_1_monitor',
      };
    }
  } catch {
    /* alerts table may be unavailable in early boot */
  }
  return { uc1ActiveEmergency: false, severityContext: 'routine' };
}

export function evaluateAndPersistUc4(
  patientId: string,
  params?: {
    uc1ActiveEmergency?: boolean;
    severityContext?: UC4SeverityContext;
  },
): Uc4PersistResult {
  const snapshot = getPatientRecordSnapshot(patientId);
  const nowIso = new Date().toISOString();
  const runId = `uc4-run-${patientId}-${Date.now()}`;

  const resolved = resolveSeverityContext(patientId);
  const uc1ActiveEmergency = params?.uc1ActiveEmergency ?? resolved.uc1ActiveEmergency;
  const severityContext = params?.severityContext ?? resolved.severityContext;

  const recentEvents = getRecentUc4Events(patientId, 20);
  const previousPriorities = getPreviousUc4Priorities(patientId);

  const input = buildUc4RunInput({
    snapshot,
    recentEvents,
    previousPriorities,
    uc1ActiveEmergency,
    currentSeverityContext: severityContext,
    nowIso,
    runId,
  });

  const output = runUC4StructuredMicroPriorities(input);

  if (!output.paused && output.selectedCards.length > 0) {
    supersedeActiveUc4Cards(patientId, runId);
    insertUc4PriorityCards(
      patientId,
      runId,
      output.selectedCards.map((card, index) => {
        const cardId = `uc4-card-${patientId}-${Date.now()}-${index}`;
        const whatToLogLabels = card.whatToLogNextSchema.map((f) => f.label);
        return {
          cardId,
          templateId: card.templateId,
          priorityKind: card.priorityKind,
          title: card.title,
          summary: card.body.slice(0, 280),
          body: card.body,
          whyThisMatters: card.safetyBoundary,
          whatToLogNextJson: JSON.stringify(whatToLogLabels),
          whatToLogNextSchemaJson: JSON.stringify(card.whatToLogNextSchema),
          evidenceJson: JSON.stringify(card.evidence),
          score: card.score,
          scoreTraceJson: JSON.stringify({
            ruleScore: card.score,
            blindSpotBonus: 0,
            usefulnessBonus: 0,
            repeatPenalty: 0,
            dismissPenalty: 0,
            normalizedScore: card.score,
            firedRuleCodes: card.firedRuleCodes,
          }),
          safetyTagsJson: JSON.stringify(
            Array.isArray(card.safetyBoundary)
              ? card.safetyBoundary
              : [card.safetyBoundary].filter(Boolean),
          ),
        };
      }),
    );
  }

  try {
    getEventBus().publish({
      type: 'uc4_priorities_evaluated',
      patientId,
      runId,
      paused: output.paused,
      cardCount: output.selectedCards.length,
      at: nowIso,
    });
  } catch {
    /* bus may not be initialized */
  }

  const providerSummary =
    output.selectedCards.length > 0
      ? renderUC4ProviderSummary({
          patientName:
            snapshot.patient?.preferredName ?? snapshot.patient?.name ?? 'Patient',
          patientId,
          cards: output.selectedCards,
          recentEvents,
          generatedAtIso: nowIso,
        })
      : undefined;

  return {
    runId,
    paused: output.paused,
    pauseReason: output.pauseReason,
    cardCount: output.selectedCards.length,
    cards: output.selectedCards,
    providerSummary,
  };
}

export type Uc4CardResponseAction =
  | 'acknowledged'
  | 'dismissed'
  | 'caregiver_response_submitted'
  | 'provider_review_requested';

export function submitUc4CaregiverResponse(params: {
  patientId: string;
  cardId: string;
  action: Uc4CardResponseAction;
  observationCodes?: ObservationCode[];
  contextCodes?: ContextCode[];
  shortText?: string;
  caregiverRequestedProviderReview?: boolean;
}): void {
  const nowIso = new Date().toISOString();
  const card = getUc4CardById(params.cardId);
  const templateId = card?.template_id ?? null;

  insertUc4CaregiverResponse({
    eventId: `uc4-resp-${params.cardId}-${Date.now()}`,
    patientId: params.patientId,
    originatingCardId: params.cardId,
    originatingTemplateId: templateId,
    timestampIso: nowIso,
    observationCodesJson: JSON.stringify(params.observationCodes ?? []),
    contextCodesJson: JSON.stringify(params.contextCodes ?? []),
    caregiverRequestedProviderReview: params.caregiverRequestedProviderReview ?? false,
    shortText: params.shortText ?? null,
    freeTextUsedForScoring: false,
    usedForScoring: false,
    action: params.action,
  });

  insertUc4RecentEvent({
    eventId: `uc4-evt-${params.cardId}-${Date.now()}`,
    patientId: params.patientId,
    timestampIso: nowIso,
    source: 'uc4_response',
    observationCodes: params.observationCodes ?? [],
    contextCodes: params.contextCodes ?? [],
    freeTextUsedForScoring: false,
    freeTextProviderContext: params.shortText,
    metadata: {
      originatingCardId: params.cardId,
      action: params.action,
    },
  });

  if (templateId) {
    insertUc4PreviousPriority({
      patientId: params.patientId,
      templateId: templateId as import('@/ml-models/uc4-micro-priorities').UC4TemplateId,
      shownAtIso: card?.created_at ?? nowIso,
      caregiverResponse:
        params.action === 'dismissed'
          ? 'dismissed'
          : params.action === 'caregiver_response_submitted'
            ? 'logged_observation'
            : 'helpful',
    });
  }

  if (params.action === 'dismissed') {
    dismissUc4Card(params.cardId);
  } else if (
    params.action === 'acknowledged' ||
    params.action === 'caregiver_response_submitted' ||
    params.action === 'provider_review_requested'
  ) {
    acknowledgeUc4Card(params.cardId);
  }

  try {
    getEventBus().publish({
      type: 'uc4_caregiver_response',
      patientId: params.patientId,
      cardId: params.cardId,
      action: params.action,
      at: nowIso,
    });
  } catch {
    /* bus may not be initialized */
  }
}

/**
 * Caregiver SLM chat screen.
 *
 * Combines the PatientRecordSnapshot-backed care context with Ethan's streaming
 * playground UX (model selector, memory bar, markdown rendering,
 * control-token stripping, stop/new-conversation).
 */

import { router, useFocusEffect } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AppState,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItem,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  formatAnswerWithFootnotes,
  selectChatGeneration,
} from '@/clinical-evidence';
import { MainTabHeader } from '@/components/MainTabHeader';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { CitationList, citationsToSources } from '@/components/common/CitationList';
import { OptionalFeaturePrompt } from '@/components/optional-feature-prompt';
import {
  ThinkingIndicator,
  shouldOfferTellMeMore,
  truncateForQuickAnswer,
} from '@/components/concierge/ThinkingIndicator';
import { AppTheme, MaxContentWidth } from '@/constants/theme';
import { getConciergeGeneration } from '@/constants/concierge';
import { usePatientRecord } from '@/contexts/patient-record-context';
import { useSettings } from '@/contexts/settings-context';
import { CHAT_UNLOAD_GRACE_MS, useSLM } from '@/contexts/slm-context';
import { useOptionalFeatureGate } from '@/hooks/useOptionalFeatureGate';
import { useOrchestratorSafe, useOrchestratorRetriever, useOrchestratorPatientId } from '@/contexts/orchestrator-context';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { languagePreferenceLabel, type TranslateFn, type TranslationKey } from '@/localization/i18n';
import type { ChatMessage as ProviderChatMessage } from '@/inference/inference-provider';
import { DEFAULT_SLM_MODEL_ID } from '@/inference/model-catalog';
import {
  buildCaregiverAssistantContextFromSnapshot,
  buildCaregiverSystemContext,
  type CaregiverAssistantContext,
} from '@/services/slm/slmService';
import { prepareSlmTurn } from '@/services/slm/prepareSlmTurn';
import {
  formatVitalsArgsSummary,
  resolveHypotheticalVitalsCandidate,
  stripEvaluateHypotheticalAction,
  type HypotheticalVitalsArgs,
} from '@/services/slm/vitals-tool-nlp';
import {
  publishUc2ResultAsAlert,
  vitalsArgsToAppleWatchInput,
} from '@/services/ml/publish-uc2-alert';
import {
  parseProposeCarePlanUpdate,
  stripProposeCarePlanUpdateAction,
} from '@/services/slm/plan-tool-nlp';
import {
  buildPlanWatchBlock,
  detectPlanOpportunities,
} from '@/services/carePlan/planOpportunities';
import {
  caregiverConfirmProposal,
  caregiverRejectProposal,
} from '@/services/carePlan/mlPlanProposalService';
import { getIntentDefinition, runIntent } from '@/services/carePlan/intentRouter';
import { runSlmCompletion } from '@/services/carePlan/careSlmAdapter';
import type { UC2DecisionResult } from '@/ml-models/uc2-decision-layer';
import { stripControlTokens } from '@/utils/stripControlTokens';
import { getProposalById } from '@/data';
import type { Medication, PatientCondition } from '@/data/types';
import { ObservationPicker } from '@/components/ObservationPicker';
import {
  InChatScheduleAppointmentCard,
  type InChatScheduleResult,
} from '@/components/concierge/InChatScheduleAppointmentCard';
import { ConciergeSuggestionBox } from '@/components/concierge/ConciergeSuggestionBox';
import type { AdcpProposalIntentId, AdcpProposalPayload } from '@/data/adcp/types';
import { DEFAULT_NLU_STAGE_TIMEOUT_MS } from '@/nlu';

/**
 * Shared Pre-SLM NLU stage budget (intent + entity + retrieval). Embedder
 * warm-up is preloaded on tab focus; this cap bounds the race in
 * prepareSlmTurn.
 */
const NLU_TIMEOUT_MS = DEFAULT_NLU_STAGE_TIMEOUT_MS;
/** Max wait for the focus acquire to finish when the first send races it. */
const LOAD_JOIN_TIMEOUT_MS = 15_000;
/** Chat history budget sent to the provider (leave room for system + answer). */
const HISTORY_BUDGET_CHARS = 3600;
const HISTORY_MAX_MESSAGES = 16;

/**
 * Trim the oldest chat turns so the provider never sees an unbounded
 * transcript (Gemma runs on a 4K–8K context window). Keeps the newest
 * messages until the char/message budget is spent.
 */
function trimChatHistory(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  const kept: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (kept.length >= HISTORY_MAX_MESSAGES) break;
    const size = messages[i].content.length;
    if (used + size > HISTORY_BUDGET_CHARS && kept.length > 0) break;
    kept.unshift(messages[i]);
    used += size;
  }
  return kept;
}

/**
 * Plan-write intents that must stay behind an explicit chip tap.
 * Narrative intents (weekly review, explains, logging, handoff) auto-run
 * when they are the only suggestion — chat does not apply those writes.
 */
function isInvasiveCareChatIntent(intent: AdcpProposalIntentId): boolean {
  return (
    intent === 'review_monitoring_contract' ||
    intent === 'propose_therapy_contract_patch' ||
    intent === 'promote_uc4_to_plan_task'
  );
}

/** Turn a Care catalog intent into a normal Concierge chat prompt. */
function chatPromptForCareIntent(
  intent: AdcpProposalIntentId,
  args?: Record<string, unknown>,
): string {
  switch (intent) {
    case 'weekly_care_plan_review':
      return (
        "Walk me through this week's care plan: the main goals, what changed recently, " +
        'and what I should focus on first.'
      );
    case 'suggest_todays_logging':
      return 'Based on the current care plan and recent patterns, what are the most useful things for me to log today?';
    case 'explain_uc4_card':
      return 'Explain my current care focus items: what each one means, why it was raised, and what I should log or watch for next.';
    case 'handoff_summary':
      return 'Help me prepare a short summary for the care team: recent concerns, what I have been logging, and questions to bring up at the next visit.';
    case 'review_monitoring_contract':
      return (
        'Review the active monitoring thresholds on the care plan and tell me what, if anything, I should consider changing. ' +
        'Propose an update only if it clearly fits — nothing applies until I confirm.'
      );
    case 'propose_therapy_contract_patch':
      return (
        'Look at therapy progress and suggest a therapy plan update if progress has stalled. ' +
        'Propose only — nothing applies until I confirm.'
      );
    case 'promote_uc4_to_plan_task': {
      const cardId = typeof args?.cardId === 'string' ? args.cardId : '';
      return cardId
        ? `Add the current care-focus priority (${cardId}) to the care plan as a durable priority. Propose only — nothing applies until I confirm.`
        : 'Add the current top care-focus priority to the care plan. Propose only — nothing applies until I confirm.';
    }
    case 'explain_uc3_result':
      return 'How is therapy going? Explain the latest therapy progress and what I should focus on next.';
    case 'explain_uc2_alert':
      return 'Explain the latest Health Monitor result and what I should do next.';
    default:
      return getIntentDefinition(intent).caregiverLabel;
  }
}

/** Localized caregiver-facing severity label (never the raw integer). */
function chatReviewSeverityKey(severity: number): TranslationKey {
  if (severity === 3) return 'dashboard.alertSeverity.urgent';
  if (severity === 2) return 'dashboard.alertSeverity.needsAttention';
  if (severity === 1) return 'dashboard.alertSeverity.headsUp';
  return 'dashboard.alertSeverity.alert';
}

/** Plain-language one-liner for a proposal payload (chat HITL card). */
function proposalPayloadSummary(payload: AdcpProposalPayload): string {
  switch (payload.kind) {
    case 'threshold_patch':
      return `Monitoring update - ${payload.thresholds.length} cutoff change(s).`;
    case 'therapy_patch':
      return 'Therapy plan update.';
    case 'priority_promote':
      return `Promote: ${payload.priority.title || 'care focus priority'}`;
    case 'goal_patch':
      return `Goals update - ${payload.goalsPatch.length} goal(s).`;
    case 'note_wording':
      return 'Care note wording update.';
  }
}

type MessageStatus = 'streaming' | 'done' | 'stopped' | 'error';

/** After Health Monitor (sev 1–2): caregiver observations before Concierge grounds. */
export type PendingCaregiverReview = {
  vitals: HypotheticalVitalsArgs;
  severity: number;
  evalBlock: string;
  summaryLine: string;
  /** Pre-HITL result — used when caregiver skips observations (final decision unchanged). */
  mlResult: UC2DecisionResult;
};

/**
 * Persist Health Monitor final decision to Dashboard alerts (same bus path as
 * Care Analysis "Publish to Concierge").
 */
function publishChatHealthMonitorAlert(params: {
  patientId: string | null | undefined;
  vitals: HypotheticalVitalsArgs;
  result: UC2DecisionResult;
  observationCodes?: string[];
}): void {
  const pid = params.patientId?.trim();
  if (!pid) return;
  const published = publishUc2ResultAsAlert({
    patientId: pid,
    result: params.result,
    input: vitalsArgsToAppleWatchInput(pid, params.vitals),
    alertIdPrefix: 'chat-hm',
    caregiverBlock:
      params.observationCodes && params.observationCodes.length > 0
        ? {
            action: 'confirm_concern',
            confirmed: true,
            observations: params.observationCodes,
          }
        : {
            action: 'no_additional_observations',
            confirmed: true,
            observations: [],
          },
  });
  if (published) {
    console.log(
      '[SLM Chat] Published Health Monitor result to Dashboard alerts',
      params.result.finalDecision?.final_severity,
    );
  }
}

/** After monitor (and optional HITL): schedule follow-up before final Concierge reply. */
export type PendingScheduleFollowUp = {
  evalBlock: string;
  severity: number;
  summaryLine: string;
  defaultReason: string;
};

/**
 * In-chat care-plan proposal HITL card. Proposals sit at awaiting_hitl until
 * the caregiver confirms (→ awaiting_ml_vet) or declines (→ rejected_by_caregiver)
 * here. Nothing ever applies from this card.
 */
export type PlanProposalReview = {
  proposalIds: string[];
  intentLabel: string;
  summaries: string[];
  status: 'awaiting_hitl' | 'confirmed' | 'rejected' | 'error';
  /** Optional error detail for the error status. */
  errorDetail?: string | null;
};

/** Mid-confidence Care intents surfaced as tappable chips in chat. */
export type CareChipSuggestion = {
  chipId: string;
  label: string;
  intent: AdcpProposalIntentId;
  args: Record<string, unknown>;
};

function needsChatCaregiverReview(ml: {
  emergencyResult?: { emergency?: boolean };
  isAnomaly?: boolean;
  promptShown?: boolean;
  finalDecision?: {
    final_severity?: number;
    suppression_status?: { is_suppressed?: boolean };
  };
  post_hitl_severity?: number;
} | null): boolean {
  if (!ml) return false;
  const severity =
    ml.finalDecision?.final_severity ?? ml.post_hitl_severity ?? 0;
  if (ml.emergencyResult?.emergency || severity === 3) return false;
  // Hysteresis-suppressed results are demoted monitoring advice — no review.
  if (ml.finalDecision?.suppression_status?.is_suppressed) return false;
  return (
    !!ml.promptShown ||
    !!ml.isAnomaly ||
    severity === 1 ||
    severity === 2
  );
}

/** Non-emergency professional follow-up (sev 1–2) → offer in-chat scheduling. */
function shouldOfferScheduleFollowUp(ml: {
  emergencyResult?: { emergency?: boolean };
  isAnomaly?: boolean;
  finalDecision?: {
    final_severity?: number;
    final_notification_type?: string;
    final_notification_level?: string | null;
  };
  post_hitl_severity?: number;
  final_notification_type?: string;
  final_notification_level?: string | null;
} | null): boolean {
  if (!ml) return false;
  const severity =
    ml.finalDecision?.final_severity ?? ml.post_hitl_severity ?? 0;
  if (ml.emergencyResult?.emergency || severity === 3 || severity === 0) {
    return false;
  }
  if (severity !== 1 && severity !== 2) return false;
  const type =
    ml.finalDecision?.final_notification_type ?? ml.final_notification_type;
  const level =
    ml.finalDecision?.final_notification_level ?? ml.final_notification_level;
  return (
    !!ml.isAnomaly ||
    type === 'SLM_SUMMARY_AND_PROVIDER_NOTE' ||
    type === 'MONITORING_ADVICE' ||
    level === 'follow_up' ||
    level === 'monitor'
  );
}

function formatScheduleOutcomeForPrompt(result: InChatScheduleResult): string {
  if (result.action === 'dismissed') {
    return (
      'CAREGIVER SCHEDULING OUTCOME: The caregiver dismissed scheduling for now. ' +
      'Acknowledge that, still explain the monitor result, and remind them they can save a local demo follow-up later.'
    );
  }
  const when = [result.date, result.time].filter(Boolean).join(' ');
  return [
    'CAREGIVER SCHEDULING OUTCOME: The caregiver saved a local demo follow-up appointment.',
    `Type: ${result.type}.`,
    when ? `When: ${when}.` : '',
    result.provider ? `Provider: ${result.provider}.` : '',
    result.location ? `Location: ${result.location}.` : '',
    result.reason ? `Reason: ${result.reason}.` : '',
    result.reminder ? `Reminder: ${result.reminder}.` : '',
    'Acknowledge the local demo appointment briefly in plain language and tie it to the Health Monitor guidance. Do not say a clinic, provider, or Athena confirmed it.',
  ]
    .filter(Boolean)
    .join(' ');
}

const PROMPT_INPUT_MIN_HEIGHT = 44;
const PROMPT_INPUT_MAX_HEIGHT = 180;
const PROMPT_INPUT_LINE_HEIGHT = 20;
const PROMPT_INPUT_VERTICAL_PADDING = 20;
const PROMPT_INPUT_APPROX_CHARS_PER_LINE = 34;

function getPromptInputHeight(text: string): number {
  if (!text) return PROMPT_INPUT_MIN_HEIGHT;

  const approximateLines = text.split('\n').reduce((lines, segment) => {
    return lines + Math.max(1, Math.ceil(segment.length / PROMPT_INPUT_APPROX_CHARS_PER_LINE));
  }, 0);

  const approximateHeight = approximateLines * PROMPT_INPUT_LINE_HEIGHT + PROMPT_INPUT_VERTICAL_PADDING;

  return Math.min(
    PROMPT_INPUT_MAX_HEIGHT,
    Math.max(PROMPT_INPUT_MIN_HEIGHT, approximateHeight),
  );
}

function expandCollapseState(expanded: boolean, t: TranslateFn): string {
  return expanded ? t('common.collapse') : t('common.expand');
}

function formatAssistantMessageForDisplay(text: string, t: TranslateFn): string {
  if (
    text ===
    'This may be an emergency. If someone is in immediate danger, call 911 or go to the ER. Concierge does not replace emergency care.'
  ) {
    return t('assistant.emergencyMessage');
  }
  if (text === 'Running Health Monitor…' || text === 'Running Health Monitor...') {
    return t('assistant.chatDisplay.runningMonitor');
  }
  const healthMonitor = text.match(
    /^Health Monitor result \((.+)\)\.\n\nAdd anything you observed below, then continue [—-] or skip review to use the monitor result only\.$/s,
  );
  if (healthMonitor) {
    return t('assistant.chatDisplay.healthMonitorResult', { summary: healthMonitor[1] });
  }
  const followUp = text.match(
    /^Professional follow-up recommended \((.+)\)\.\n\nSave a local demo follow-up below, or choose Not now [—-] then I.ll wrap up with guidance\.$/s,
  );
  if (followUp) {
    return t('assistant.chatDisplay.professionalFollowup', { summary: followUp[1] });
  }
  return text;
}

function formatAssistantErrorForDisplay(error: string | null, t: TranslateFn): string {
  if (!error) return t('common.unknownError');
  if (error === 'Concierge reasoning is still loading. Please retry once the native model is ready.') {
    return t('assistant.error.reasoningLoading');
  }
  const unavailable = error.match(/^Concierge reasoning is temporarily unavailable: (.+)$/s);
  if (unavailable) {
    return t('assistant.error.reasoningUnavailableWithDetail', { detail: unavailable[1] });
  }
  if (error === 'Concierge reasoning is temporarily unavailable.') {
    return t('assistant.error.reasoningUnavailable');
  }
  if (
    error ===
    'Concierge reasoning is temporarily unavailable because no native model is loaded. Load the Concierge model and retry.'
  ) {
    return t('assistant.error.noNativeModel');
  }
  if (error === 'Something went wrong while streaming the response.') {
    return t('assistant.error.streamingFailed');
  }
  if (error === 'Health Monitor did not return a result. Try again or rephrase the vitals.') {
    return t('assistant.error.healthMonitorNoResult');
  }
  if (error === 'Health Monitor failed. You can still ask Concierge without it.') {
    return t('assistant.error.healthMonitorFailed');
  }
  if (error === 'Failed to finish explanation.') {
    return t('assistant.error.finishExplanationFailed');
  }
  if (error === 'Health Monitor re-run failed after caregiver review.') {
    return t('assistant.error.reviewRerunFailed');
  }
  if (error === 'Caregiver review failed.') {
    return t('assistant.error.caregiverReviewFailed');
  }
  if (error === 'Failed to finish after scheduling.') {
    return t('assistant.error.finishSchedulingFailed');
  }
  if (error === 'Something went wrong.') {
    return t('common.unknownError');
  }
  return error;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  finalText: string | null;
  thinking: string | null;
  status: MessageStatus;
  startedAt: number;
  finishedAt: number | null;
  /** When the first reasoning token was seen (drives phase rotation). */
  reasoningStartedAt: number | null;
  /** Current generation phase (mirrors ThinkingIndicator phase prop). */
  phase: 0 | 1 | 2 | 3;
  /** Whether the answer (not reasoning) channel has started streaming. */
  answerStarted: boolean;
  /** Pending Health Monitor tool args awaiting caregiver confirm (never auto-run). */
  pendingHealthMonitor?: HypotheticalVitalsArgs | null;
  /**
   * After Health Monitor ran with severity 1–2: optional caregiver observations
   * before Concierge writes the grounded answer. Severity 3 skips this.
   */
  pendingCaregiverReview?: PendingCaregiverReview | null;
  /**
   * After monitor (and optional HITL), when professional follow-up is recommended:
   * schedule or dismiss, then final Concierge answer.
   */
  pendingScheduleFollowUp?: PendingScheduleFollowUp | null;
  /** Care-plan proposal HITL card (awaiting caregiver confirm / decline). */
  pendingPlanProposal?: PlanProposalReview | null;
  /** Mid-confidence Care intent chips (single_chip / multi_chip resolutions). */
  pendingCareChips?: CareChipSuggestion[] | null;
  /** User message that triggered this assistant turn (for turn-2 grounding). */
  sourceUserText?: string;
  /** Sources for assistant messages (for display) */
  sources?: { label: string; count?: number }[];
}

interface ChatState {
  runStatus: 'idle' | 'streaming' | 'done' | 'stopped' | 'error';
  messages: ChatMessage[];
}

type ChatAction =
  | { type: 'send-start'; payload: { userMessage: ChatMessage; assistantMessage: ChatMessage } }
  | {
      type: 'send-success';
      payload: {
        assistantId: string;
        finalText: string;
        reasoningContent?: string | null;
        pendingHealthMonitor?: HypotheticalVitalsArgs | null;
        pendingCaregiverReview?: PendingCaregiverReview | null;
        pendingScheduleFollowUp?: PendingScheduleFollowUp | null;
        pendingPlanProposal?: PlanProposalReview | null;
        pendingCareChips?: CareChipSuggestion[] | null;
        sourceUserText?: string;
        /** Sources for display (not embedded in text) */
        sources?: { label: string; count?: number }[];
        emptyFallback?: string;
      };
    }
  | { type: 'send-stopped'; payload: { assistantId: string } }
  | { type: 'send-error'; payload: { assistantId: string; error: string } }
  | { type: 'append-token'; payload: { assistantId: string; token: string } }
  | { type: 'append-reasoning-token'; payload: { assistantId: string; token: string } }
  | { type: 'set-phase'; payload: { assistantId: string; phase: 0 | 1 | 2 | 3 } }
  | { type: 'mark-answer-started'; payload: { assistantId: string } }
  | { type: 'mark-tools-phase'; payload: { assistantId: string } }
  | {
      type: 'clear-pending-health-monitor';
      payload: { assistantId: string; note?: string };
    }
  | {
      type: 'set-pending-caregiver-review';
      payload: {
        assistantId: string;
        review: PendingCaregiverReview | null;
        interimText?: string;
      };
    }
  | {
      type: 'set-pending-schedule-follow-up';
      payload: {
        assistantId: string;
        schedule: PendingScheduleFollowUp | null;
        interimText?: string;
      };
    }
  | {
      type: 'set-pending-plan-proposal';
      payload: {
        assistantId: string;
        review: PlanProposalReview | null;
      };
    }
  | {
      type: 'set-care-chips';
      payload: {
        assistantId: string;
        chips: CareChipSuggestion[] | null;
      };
    }
  | {
      type: 'update-plan-proposal-status';
      payload: {
        assistantId: string;
        status: PlanProposalReview['status'];
        errorDetail?: string | null;
      };
    }
  | { type: 'new-conversation' };

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

function initialState(): ChatState {
  return { runStatus: 'idle', messages: [] };
}

function reducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'send-start':
      return {
        ...state,
        runStatus: 'streaming',
        messages: [...state.messages, action.payload.userMessage, action.payload.assistantMessage],
      };

    case 'send-success': {
      const { finalText, reasoningContent, pendingHealthMonitor, sourceUserText, sources } = action.payload;
      const parsed = stripControlTokens(finalText);
      const thinking = reasoningContent || parsed.thinking;
      // If the answer channel came back empty (model was cut off mid-thought,
      // or only reasoning was produced), keep whatever answer tokens already
      // streamed in via 'append-token' rather than blanking the bubble. If
      // nothing streamed either, surface a graceful fallback instead of
      // rendering the raw thinking.
      const existing = state.messages.find((m) => m.id === action.payload.assistantId);
      const answer =
        parsed.answer ||
        (existing?.text?.trim() ? existing.text : '') ||
        action.payload.emptyFallback ||
        '';

      return {
        ...state,
        runStatus: 'done',
        messages: state.messages.map((m) =>
          m.id === action.payload.assistantId
            ? {
                ...m,
                text: answer,
                finalText: answer,
                thinking,
                status: 'done' as const,
                finishedAt: Date.now(),
                answerStarted: true,
                phase: 3,
                pendingHealthMonitor: pendingHealthMonitor ?? null,
                pendingCaregiverReview:
                  action.payload.pendingCaregiverReview !== undefined
                    ? action.payload.pendingCaregiverReview
                    : null,
                pendingScheduleFollowUp:
                  action.payload.pendingScheduleFollowUp !== undefined
                    ? action.payload.pendingScheduleFollowUp
                    : null,
                pendingPlanProposal:
                  action.payload.pendingPlanProposal !== undefined
                    ? action.payload.pendingPlanProposal
                    : null,
                pendingCareChips:
                  action.payload.pendingCareChips !== undefined
                    ? action.payload.pendingCareChips
                    : null,
                sourceUserText,
                sources,
              }

            : m,
        ),
      };
    }

    case 'send-stopped':
      return {
        ...state,
        runStatus: 'stopped',
        messages: state.messages.map((m) =>
          m.id === action.payload.assistantId
            ? { ...m, status: 'stopped' as const, finishedAt: Date.now() }
            : m,
        ),
      };

    case 'send-error':
      return {
        ...state,
        runStatus: 'error',
        messages: state.messages.map((m) =>
          m.id === action.payload.assistantId
            ? {
                ...m,
                status: 'error' as const,
                finalText: action.payload.error,
                finishedAt: Date.now(),
                answerStarted: true,
                phase: 3,
              }
            : m,
        ),
      };

    case 'append-token':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.payload.assistantId
            ? { ...m, text: m.text + action.payload.token, answerStarted: true, phase: 3 }
            : m,
        ),
      };

    case 'append-reasoning-token':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.payload.assistantId
            ? {
                ...m,
                thinking: (m.thinking ?? '') + action.payload.token,
                reasoningStartedAt: m.reasoningStartedAt ?? Date.now(),
                phase: 1,
              }
            : m,
        ),
      };

    case 'set-phase':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.payload.assistantId ? { ...m, phase: action.payload.phase } : m,
        ),
      };

    case 'mark-answer-started':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.payload.assistantId
            ? { ...m, answerStarted: true, phase: 3 }
            : m,
        ),
      };

    case 'mark-tools-phase':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.payload.assistantId
            ? { ...m, phase: 2 }
            : m,
        ),
      };

    case 'clear-pending-health-monitor':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.payload.assistantId
            ? {
                ...m,
                pendingHealthMonitor: null,
                text: action.payload.note
                  ? `${m.finalText ?? m.text}\n\n${action.payload.note}`
                  : m.text,
                finalText: action.payload.note
                  ? `${m.finalText ?? m.text}\n\n${action.payload.note}`
                  : m.finalText,
              }
            : m,
        ),
      };

    case 'set-pending-caregiver-review':
      return {
        ...state,
        runStatus: 'done',
        messages: state.messages.map((m) =>
          m.id === action.payload.assistantId
            ? {
                ...m,
                status: 'done' as const,
                finishedAt: Date.now(),
                answerStarted: true,
                phase: 3,
                pendingCaregiverReview: action.payload.review,
                pendingScheduleFollowUp: null,
                text: action.payload.interimText ?? m.text,
                finalText: action.payload.interimText ?? m.finalText,
              }
            : m,
        ),
      };

    case 'set-pending-schedule-follow-up':
      return {
        ...state,
        runStatus: 'done',
        messages: state.messages.map((m) =>
          m.id === action.payload.assistantId
            ? {
                ...m,
                status: 'done' as const,
                finishedAt: Date.now(),
                answerStarted: true,
                phase: 3,
                pendingCaregiverReview: null,
                pendingScheduleFollowUp: action.payload.schedule,
                text: action.payload.interimText ?? m.text,
                finalText: action.payload.interimText ?? m.finalText,
              }
            : m,
        ),
      };

    case 'set-pending-plan-proposal':
      // Message-only update: this lands AFTER send-success, and often while
      // a follow-up turn is already streaming (the draft is a second async
      // generation). Touching runStatus here would mark that turn done.
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.payload.assistantId
            ? {
                ...m,
                pendingPlanProposal: action.payload.review,
              }
            : m,
        ),
      };

    case 'set-care-chips':
      return {
        ...state,
        runStatus: 'done',
        messages: state.messages.map((m) =>
          m.id === action.payload.assistantId
            ? {
                ...m,
                status: 'done' as const,
                finishedAt: Date.now(),
                answerStarted: true,
                phase: 3,
                pendingCareChips: action.payload.chips,
              }
            : m,
        ),
      };

    case 'update-plan-proposal-status':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.payload.assistantId && m.pendingPlanProposal
            ? {
                ...m,
                pendingPlanProposal: {
                  ...m.pendingPlanProposal,
                  status: action.payload.status,
                  errorDetail: action.payload.errorDetail ?? null,
                },
              }
            : m,
        ),
      };

    case 'new-conversation':
      return initialState();

    default:
      return state;
  }
}

export default function SLMScreen({
  showBackButton = true,
}: {
  showBackButton?: boolean;
} = {}) {
  const slm = useSLM();
  const optionalGate = useOptionalFeatureGate('slm');
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const isDarkTheme = theme.appBackground === '#000000';
  const { settings, isDeveloper } = useSettings();
  const { snapshot, ready, error: patientRecordError } = usePatientRecord();
  const retriever = useOrchestratorRetriever();
  const orchestrator = useOrchestratorSafe();
  const patientId = useOrchestratorPatientId();
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [inputText, setInputText] = useState('');
  const [inputHeight, setInputHeight] = useState(PROMPT_INPUT_MIN_HEIGHT);
  const [showReasoningFor, setShowReasoningFor] = useState<Set<string>>(new Set());
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(new Set());
  const [expandedCareSections, setExpandedCareSections] = useState<Set<string>>(new Set());
  const [careContextExpanded, setCareContextExpanded] = useState(false);
  const [howMonitorExpanded, setHowMonitorExpanded] = useState(false);

  const handleInputChange = useCallback((text: string) => {
    setInputText(text);
    setInputHeight(getPromptInputHeight(text));
  }, []);
  const abortControllerRef = useRef<AbortController | null>(null);
  const flatListRef = useRef<FlatList>(null);
  /** Stash prose/userText across Health Monitor → optional caregiver review → ground. */
  const pendingGroundingRef = useRef<
    Record<
      string,
      { userText: string; prose: string; historyMessages: ChatMessage[] }
    >
  >({});
  /** Latest Health Monitor pipeline (filled after useCallback defines it). */
  const runHealthMonitorPipelineRef = useRef<
    | ((params: {
        args: HypotheticalVitalsArgs;
        userText: string;
        prose: string;
        historyMessages: ChatMessage[];
      }) => Promise<void>)
    | null
  >(null);
  const [reviewCodesByMessage, setReviewCodesByMessage] = useState<
    Record<string, string[]>
  >({});
  /** Latest assistant message id — HITL cards attach to it. */
  const allowDevelopmentNluFallback =
    __DEV__ && isDeveloper && settings.nluDevelopmentFallback === true;
  const canUseLocalAppointmentDemo = __DEV__ && isDeveloper;

  /** Deterministic plan opportunities for the empty-state suggestion chips. */
  const suggestionOpportunities = useMemo(
    () => (state.messages.length === 0 ? detectPlanOpportunities(snapshot) : []),
    [snapshot, state.messages.length],
  );

  /** In-chat card Confirm → awaiting_ml_vet (nothing applies yet). */
  const handleConfirmPlanProposal = useCallback(
    (assistantId: string, review: PlanProposalReview) => {
      let failed = false;
      for (const id of review.proposalIds) {
        try {
          caregiverConfirmProposal(id);
        } catch (err) {
          failed = true;
          console.warn('[SLM Chat] proposal confirm failed:', err);
        }
      }
      dispatch({
        type: 'update-plan-proposal-status',
        payload: {
          assistantId,
          status: failed ? 'error' : 'confirmed',
          errorDetail: failed ? t('assistant.planProposal.error') : null,
        },
      });
    },
    [t],
  );

  /** In-chat card Decline → rejected_by_caregiver. */
  const handleRejectPlanProposal = useCallback(
    (assistantId: string, review: PlanProposalReview) => {
      let failed = false;
      for (const id of review.proposalIds) {
        try {
          caregiverRejectProposal(id, 'caregiver_rejected');
        } catch (err) {
          failed = true;
          console.warn('[SLM Chat] proposal reject failed:', err);
        }
      }
      dispatch({
        type: 'update-plan-proposal-status',
        payload: {
          assistantId,
          status: failed ? 'error' : 'rejected',
          errorDetail: failed ? t('assistant.planProposal.error') : null,
        },
      });
    },
    [t],
  );

  const medicationNames = useMemo(
    () =>
      snapshot?.medications
        .map((medication: Medication) => medication.name.trim())
        .filter(Boolean) ?? [],
    [snapshot?.medications],
  );

  const dedupedSymptoms = useMemo(
    () =>
      [...new Set((snapshot?.symptoms ?? []).map((s) => s.label).filter(Boolean))],
    [snapshot?.symptoms],
  );

  const toggleCareSection = useCallback((id: string) => {
    setExpandedCareSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const caregiverContext = useMemo<CaregiverAssistantContext | null>(
    () => {
      if (!snapshot?.patient) return null;

      const context = buildCaregiverAssistantContextFromSnapshot(snapshot);
      const medicationSummary = medicationNames.join(', ');

      return {
        ...context,
        patientAge: context.patientAge ? String(context.patientAge) : undefined,
        medicationSummary: medicationSummary || context.medicationSummary,
      };
    },
    [snapshot, medicationNames],
  );

  // Doc 34 + chat grace: focus-bound session lease. On blur, keep the lease
  // for CHAT_UNLOAD_GRACE_MS so accidental tab switches / short navigations
  // do not unload mid-generation. Generation continues (no abort on blur).
  // Explicit Stop still aborts via handleStop (not on blur/unmount).
  const acquireSlm = slm.acquireSlm;
  const startChatUnloadGrace = slm.startChatUnloadGrace;
  const cancelChatUnloadGrace = slm.cancelChatUnloadGrace;
  const chatLeaseRef = useRef<import('@/services/slm/slm-task-queue').SlmTaskLease | null>(null);
  const chatGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatFocusedRef = useRef(false);

  const unloadModel = slm.unloadModel;
  const taskQueue = slm.taskQueue;
  /** Serializes concurrent focus acquires so we never hold orphaned refcount. */
  const chatAcquireGenRef = useRef(0);

  const scheduleChatLeaseRelease = useCallback(() => {
    if (chatGraceTimerRef.current) {
      clearTimeout(chatGraceTimerRef.current);
    }
    startChatUnloadGrace();
    chatGraceTimerRef.current = setTimeout(() => {
      chatGraceTimerRef.current = null;
      chatLeaseRef.current?.release();
      chatLeaseRef.current = null;
      // Belt-and-suspenders: if no other leases remain, force unload so the
      // status icon cannot stay green after the cool-down (stale refcount /
      // policy edge cases).
      if (taskQueue.activeLeaseCount === 0) {
        void unloadModel();
      }
    }, CHAT_UNLOAD_GRACE_MS);
  }, [startChatUnloadGrace, taskQueue, unloadModel]);

  /** Immediate release (no grace) — used when the app backgrounds. */
  const releaseChatLeaseNow = useCallback(() => {
    if (chatGraceTimerRef.current) {
      clearTimeout(chatGraceTimerRef.current);
      chatGraceTimerRef.current = null;
    }
    cancelChatUnloadGrace();
    chatLeaseRef.current?.release();
    chatLeaseRef.current = null;
  }, [cancelChatUnloadGrace]);

  const acquireChatLease = useCallback(async () => {
    if (chatLeaseRef.current) return;
    const acquireGen = ++chatAcquireGenRef.current;
    try {
      const lease = await acquireSlm('caregiver_chat');
      // Stale acquire (re-focus raced) — drop this lease immediately.
      if (acquireGen !== chatAcquireGenRef.current) {
        lease.release();
        return;
      }
      if (!chatFocusedRef.current) {
        // Blurred while acquiring — hold through grace, then release.
        chatLeaseRef.current = lease;
        scheduleChatLeaseRelease();
        return;
      }
      // Another concurrent acquire already filled the ref — release orphan.
      if (chatLeaseRef.current) {
        lease.release();
        return;
      }
      chatLeaseRef.current = lease;
    } catch {
      // RAM gate / not installed — chat send surfaces the unavailable state.
    }
  }, [acquireSlm, scheduleChatLeaseRelease]);

  useFocusEffect(
    useCallback(() => {
      chatFocusedRef.current = true;
      chatAcquireGenRef.current += 1;

      // Re-focused: cancel pending grace unload and keep existing lease.
      if (chatGraceTimerRef.current) {
        clearTimeout(chatGraceTimerRef.current);
        chatGraceTimerRef.current = null;
      }
      cancelChatUnloadGrace();

      void (async () => {
        // Warm NLU embedder when Concierge is opened (retry if app-start preload failed).
        void import('@/knowledge/embedder')
          .then(({ preloadTfliteEmbedder }) => preloadTfliteEmbedder())
          .catch(() => {});

        await acquireChatLease();
      })();

      return () => {
        chatFocusedRef.current = false;
        // Invalidate in-flight acquires from this focus epoch.
        chatAcquireGenRef.current += 1;
        if (!chatLeaseRef.current) {
          // Acquire still in flight; async branch schedules grace when it resolves.
          return;
        }
        scheduleChatLeaseRelease();
      };
    }, [acquireChatLease, cancelChatUnloadGrace, scheduleChatLeaseRelease]),
  );

  // ── AppState: background releases the focus lease; foreground re-acquires ──
  // The provider's AppState hook only unloads when the queue refcount is 0 —
  // a focused Concierge lease kept the ~2.4 GB model resident while the app
  // sat in the background. Release it here (unless a generation is mid-stream;
  // its finally block releases once the app is backgrounded) and re-acquire
  // when the app returns and the Concierge tab is still focused.
  const appBackgroundedRef = useRef(false);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        appBackgroundedRef.current = true;
        if (!abortControllerRef.current) {
          releaseChatLeaseNow();
        }
      } else if (state === 'active') {
        appBackgroundedRef.current = false;
        if (
          chatFocusedRef.current &&
          !chatLeaseRef.current &&
          !abortControllerRef.current
        ) {
          void acquireChatLease();
        }
      }
    });
    return () => sub.remove();
  }, [acquireChatLease, releaseChatLeaseNow]);

  // Full unmount: do not yank the lease if a blur grace is already running
  // (tab switch / short leave). Only force-release if we still hold a lease
  // with no pending grace timer (defensive).
  useEffect(() => {
    return () => {
      chatFocusedRef.current = false;
      if (chatGraceTimerRef.current) {
        // Grace already scheduled by focus cleanup — let it finish.
        return;
      }
      if (chatLeaseRef.current) {
        scheduleChatLeaseRelease();
      } else {
        cancelChatUnloadGrace();
      }
    };
  }, [cancelChatUnloadGrace, scheduleChatLeaseRelease]);

  useEffect(() => {
    flatListRef.current?.scrollToEnd({ animated: true });
  }, [state.messages]);

  const handleAskAssistant = useCallback(async (
    overrideText?: string,
    options?: { skipCareRoute?: boolean },
  ) => {
    const trimmed = (typeof overrideText === 'string' ? overrideText : inputText).trim();
    if (!trimmed || state.runStatus === 'streaming') return;

    // Dismiss the keyboard so the streaming answer and sources stay visible.
    Keyboard.dismiss();

    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      text: trimmed,
      finalText: trimmed,
      thinking: null,
      status: 'done',
      startedAt: Date.now(),
      finishedAt: Date.now(),
      reasoningStartedAt: null,
      phase: 0,
      answerStarted: false,
    };

    const assistantMessage: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      text: '',
      finalText: null,
      thinking: null,
      status: 'streaming',
      startedAt: Date.now(),
      finishedAt: null,
      reasoningStartedAt: null,
      phase: 0,
      answerStarted: false,
    };
    dispatch({ type: 'send-start', payload: { userMessage, assistantMessage } });
    setInputText('');
    // Phase 0 = Understanding (NLU). Phase 1 = Concierge (SLM).
    dispatch({ type: 'set-phase', payload: { assistantId: assistantMessage.id, phase: 0 } });

    // Deterministic safety refuses (ACL Protocol 9-Delta, dose changes, auto-911).
    // Must run before NLU/SLM so the model cannot improvise unknown protocols.
    try {
      const [{ evaluateSafetyRefuseGate }, { buildPatientNluContext }] =
        await Promise.all([
          import('@/services/slm/safety-refuse-guardrails'),
          import('@/nlu/patient-nlu-context'),
        ]);
      const safety = evaluateSafetyRefuseGate(
        trimmed,
        buildPatientNluContext(snapshot),
      );
      if (safety.refuse) {
        console.log(
          `[SLM Chat] safety refuse kind=${safety.kind} latency_ms=${Date.now() - assistantMessage.startedAt}`,
        );
        dispatch({
          type: 'send-success',
          payload: {
            assistantId: assistantMessage.id,
            finalText: safety.message,
            reasoningContent: null,
            pendingHealthMonitor: null,
            sourceUserText: trimmed,
            emptyFallback: t('assistant.responseFallback'),
          },
        });
        return;
      }
    } catch (safetyErr) {
      console.warn('[SLM Chat] safety gate skipped:', safetyErr);
    }

    // Care soft-route first (phrase/surface map works without chat SLM loaded).
    // Mid-confidence matches become in-chat chips; a selected chip (or a
    // high-confidence preselect) continues as a normal Concierge turn.
    try {
      const { resolveCareText } = await import('@/services/carePlan/coaching');
      const careResolution = options?.skipCareRoute
        ? { kind: 'concierge_handoff' as const, carryText: trimmed, reason: 'chip_or_intent' }
        : await resolveCareText(trimmed, {
            snapshot,
            timeoutMs: NLU_TIMEOUT_MS,
          });
      if (careResolution.kind === 'preselect') {
        if (isInvasiveCareChatIntent(careResolution.intent)) {
          dispatch({
            type: 'send-success',
            payload: {
              assistantId: assistantMessage.id,
              finalText: t('care.ask.didYouMean'),
              reasoningContent: null,
              pendingHealthMonitor: null,
              pendingCareChips: [
                {
                  chipId: `care:${careResolution.intent}`,
                  label: getIntentDefinition(careResolution.intent).caregiverLabel,
                  intent: careResolution.intent,
                  args: careResolution.args,
                },
              ],
              sourceUserText: trimmed,
              emptyFallback: t('assistant.responseFallback'),
            },
          });
          return;
        }
        console.log(
          `[SLM Chat] Care soft-route intent=${careResolution.intent} conf=${careResolution.confidence.toFixed(2)} source=${careResolution.source} — continuing as chat turn`,
        );
      } else if (careResolution.kind === 'single_chip') {
        const only = careResolution.chips[0];
        if (only && isInvasiveCareChatIntent(only.intent)) {
          dispatch({
            type: 'send-success',
            payload: {
              assistantId: assistantMessage.id,
              finalText: t('care.ask.didYouMean'),
              reasoningContent: null,
              pendingHealthMonitor: null,
              pendingCareChips: careResolution.chips,
              sourceUserText: trimmed,
              emptyFallback: t('assistant.responseFallback'),
            },
          });
          return;
        }
        console.log(
          `[SLM Chat] Care soft-route single chip ${only?.intent ?? 'none'} — continuing as chat turn`,
        );
      } else if (careResolution.kind === 'multi_chip') {
        dispatch({
          type: 'send-success',
          payload: {
            assistantId: assistantMessage.id,
            finalText: t('care.ask.tryOne'),
            reasoningContent: null,
            pendingHealthMonitor: null,
            pendingCareChips: careResolution.chips,
            sourceUserText: trimmed,
            emptyFallback: t('assistant.responseFallback'),
          },
        });
        return;
      }
      if (careResolution.kind === 'emergency') {
        dispatch({
          type: 'send-success',
          payload: {
            assistantId: assistantMessage.id,
            finalText:
              'This may be an emergency. If someone is in immediate danger, call 911 or go to the ER. ' +
              'Concierge does not replace emergency care.',
            reasoningContent: null,
            pendingHealthMonitor: null,
            sourceUserText: trimmed,
            emptyFallback: t('assistant.responseFallback'),
          },
        });
        return;
      }
    } catch (careRouteErr) {
      console.warn('[SLM Chat] Care soft-route skipped:', careRouteErr);
    }

    // No production fallback: normal caregiver chat must not synthesize a
    // Concierge answer when the native model is unavailable. But if the focus
    // acquire is still loading, join it briefly instead of failing the send.
    if (slm.loadStatus === 'loading') {
      const pending = slm.getLoadPromise();
      if (pending) {
        await Promise.race([
          pending.then(() => undefined).catch(() => undefined),
          new Promise<void>((resolve) => setTimeout(resolve, LOAD_JOIN_TIMEOUT_MS)),
        ]);
      }
    }

    if (slm.loadStatus !== 'ready' || slm.provider.getModelInfo() === null) {
      const message =
        slm.loadStatus === 'loading'
          ? 'Concierge reasoning is still loading. Please retry once the native model is ready.'
          : slm.loadStatus === 'error'
            ? `Concierge reasoning is temporarily unavailable${slm.loadError ? `: ${slm.loadError}` : '.'}`
            : 'Concierge reasoning is temporarily unavailable because no native model is loaded. Load the Concierge model and retry.';
      dispatch({
        type: 'send-error',
        payload: {
          assistantId: assistantMessage.id,
          error: message,
        },
      });
      return;
    }

    // Shared Pre-SLM NLU + retrieval (same path as Care sheets / mini-chat).
    const turnT0 = Date.now();
    console.log('[SLM Chat] NLU start');
    const nluT0 = Date.now();
    const prepared = await prepareSlmTurn({
      userText: trimmed,
      snapshot,
      retriever,
      forceDeep: false,
      allowDevelopmentNluFallback: allowDevelopmentNluFallback,
      nluTimeoutMs: NLU_TIMEOUT_MS,
      logTag: 'SLM Chat',
      modelId: slm.currentModelId ?? DEFAULT_SLM_MODEL_ID,
    });
    const nluMs = Date.now() - nluT0;
    const nluPacket = prepared.nluPacket;
    const generationDecision = prepared.generationDecision;
    const systemContext = prepared.systemContext;
    const userContent = prepared.userContent;

    console.log(
      `[SLM Chat] generation=${generationDecision.mode === 'none' ? 'FAST' : 'DEEP'} ` +
        `reason=${generationDecision.reason} ` +
        `intent=${nluPacket?.intent?.primary ?? 'none'} ` +
        `conf=${nluPacket?.intent?.confidence?.toFixed(2) ?? 'n/a'} ` +
        `nlu_ms=${nluMs}`,
    );

    // ── Care soft-route pass 2 (chat-head parity) ──
    // Reuse this turn's chat NLU head so draft_care_plan / mid-confidence
    // Care intents are reachable by text without a second embedder load.
    const planOpportunities = detectPlanOpportunities(snapshot);
    try {
      if (nluPacket?.intent && !options?.skipCareRoute) {
        const { resolveCareText } = await import('@/services/carePlan/coaching');
        const careResolution2 = await resolveCareText(trimmed, {
          snapshot,
          chatHead: {
            primary: nluPacket.intent.primary,
            confidence: nluPacket.intent.confidence,
            entities: nluPacket.entities,
          },
          timeoutMs: NLU_TIMEOUT_MS,
        });
        if (careResolution2.kind === 'preselect') {
          console.log(
            `[SLM Chat] Care soft-route pass 2 intent=${careResolution2.intent} — continuing as chat turn`,
          );
        } else if (
          careResolution2.kind === 'single_chip' ||
          careResolution2.kind === 'multi_chip'
        ) {
          console.log(
            `[SLM Chat] Care soft-route pass 2 chips=${careResolution2.kind} — continuing as chat turn`,
          );
        }
      }
    } catch (careRouteErr2) {
      console.warn('[SLM Chat] Care soft-route pass 2 skipped:', careRouteErr2);
    }

    // PLAN WATCH: deterministic plan signals + propose_care_plan_update
    // emission format, appended to the chat-only system context.
    const planWatchBlock = buildPlanWatchBlock(snapshot, planOpportunities);
    const finalSystemContext = planWatchBlock
      ? `${systemContext}\n\n${planWatchBlock}`
      : systemContext;

    // NLU done → Concierge (SLM) stage
    dispatch({ type: 'set-phase', payload: { assistantId: assistantMessage.id, phase: 1 } });
    console.log('[SLM Chat] SLM start');

    const messages: ProviderChatMessage[] = [
      { role: 'system', content: finalSystemContext },
      ...trimChatHistory(state.messages.map((m) => ({ role: m.role, content: m.text }))),
      { role: 'user', content: userContent },
    ];

    console.log('[SLM Chat] === USER MESSAGE ===');
    console.log(userContent);
    console.log('[SLM Chat] === END PROMPT ===');

    abortControllerRef.current = new AbortController();

    const reasoningStartedAt = { current: null as number | null };
    const slmT0 = Date.now();
    let ttftMs: number | null = null;

    try {
      const result = await slm.chat(
        messages,
        (token) => {
          if (ttftMs === null) {
            ttftMs = Date.now() - slmT0;
          }
          // First answer token — the indicator hides and the bold answer streams.
          dispatch({
            type: 'mark-answer-started',
            payload: { assistantId: assistantMessage.id },
          });
          dispatch({
            type: 'append-token',
            payload: { assistantId: assistantMessage.id, token },
          });
        },
        abortControllerRef.current.signal,
        prepared.generation,
        (token) => {
          if (ttftMs === null) {
            ttftMs = Date.now() - slmT0;
          }
          // First reasoning token — stay on Concierge stage (phase 1).
          if (reasoningStartedAt.current === null) {
            reasoningStartedAt.current = Date.now();
            dispatch({ type: 'set-phase', payload: { assistantId: assistantMessage.id, phase: 1 } });
          }
          dispatch({
            type: 'append-reasoning-token',
            payload: { assistantId: assistantMessage.id, token },
          });
        },
      );

      const slmMs = Date.now() - slmT0;
      const turnMs = Date.now() - turnT0;

      let finalText = result.text;
      let finalReasoning = result.reasoningContent;

      // Debug logging: show SLM output + latency for Smart 40 / tech appendix
      console.log('[SLM Chat] === SLM RESPONSE ===');
      console.log(finalText);
      if (finalReasoning) {
        console.log('[SLM Chat] === REASONING ===');
        console.log(finalReasoning);
      }
      console.log('[SLM Chat] === END RESPONSE ===');
      console.log(
        `[SLM Chat] latency_ms total=${turnMs} nlu=${nluMs} slm_e2e=${slmMs} ` +
          `ttft=${ttftMs ?? 'n/a'} model=${slm.currentModelId ?? 'unknown'} ` +
          `mode=${generationDecision.mode === 'none' ? 'FAST' : 'DEEP'} ` +
          `intent=${nluPacket?.intent?.primary ?? 'none'} ` +
          `conf=${nluPacket?.intent?.confidence?.toFixed(2) ?? 'n/a'}`,
      );

      // Health Monitor: prefer NLU-extracted slots, else model ACTION / user NLP.
      const monitorArgs =
        nluPacket?.slots ??
        resolveHypotheticalVitalsCandidate(trimmed, result.text);
      finalText = stripEvaluateHypotheticalAction(finalText);

      // ── propose_care_plan_update tool (chat) ──
      // The SLM may propose a plan update via one ACTION line. The line is
      // always stripped from the displayed answer (even when the parse
      // rejects it — raw ACTION text must never reach the caregiver). A valid
      // call triggers the canonical intent draft pass below, which lands on
      // the in-chat HITL card.
      finalText = stripProposeCarePlanUpdateAction(finalText);
      const planCall = parseProposeCarePlanUpdate(result.text);
      if (planCall) {
        console.log(
          `[SLM Chat] propose_care_plan_update intent=${planCall.intent} args=${JSON.stringify(planCall.args)}`,
        );
      }

      // Sources footer without chunk indices (caregiver-facing).
      const withFootnotes = formatAnswerWithFootnotes(
        finalText,
        prepared.citationChunks,
        { collapsedSources: true },
      );
      finalText = withFootnotes.displayText;
      const sources = citationsToSources(prepared.citationChunks, t);

      dispatch({
        type: 'send-success',
        payload: {
          assistantId: assistantMessage.id,
          finalText,
          reasoningContent: finalReasoning,
          pendingHealthMonitor: null,
          sourceUserText: trimmed,
          sources,
          emptyFallback: t('assistant.responseFallback'),
        },
      });

      // Canonical draft pass for a proposed plan update: runIntent builds the
      // full ADCP/UC prompt context, the SLM drafts the payload (second
      // generation, schema-validated), and the proposal is enqueued at
      // awaiting_hitl. The HITL card renders when the draft lands.
      if (planCall && snapshot) {
        const draftAssistantId = assistantMessage.id;
        void (async () => {
          try {
            const def = getIntentDefinition(planCall.intent);
            const draftResult = await runIntent({
              snapshot,
              intent: planCall.intent,
              args: planCall.args,
              completePrompt: async (params) =>
                runSlmCompletion({
                  provider: slm.provider,
                  systemContext: params.systemContext,
                  userPrompt: params.userPrompt,
                }),
            });
            const ids = draftResult.enqueuedProposalIds;
            if (ids.length === 0) {
              if (draftResult.blocked) {
                dispatch({
                  type: 'set-pending-plan-proposal',
                  payload: {
                    assistantId: draftAssistantId,
                    review: {
                      proposalIds: [],
                      intentLabel: def.caregiverLabel,
                      summaries: [draftResult.blockMessage ?? ''],
                      status: 'error',
                      errorDetail: draftResult.blockMessage ?? null,
                    },
                  },
                });
              }
              return;
            }
            const summaries = ids
              .map((id) => {
                const proposal = getProposalById(id);
                return proposal ? proposalPayloadSummary(proposal.payload) : '';
              })
              .filter((s): s is string => Boolean(s));
            dispatch({
              type: 'set-pending-plan-proposal',
              payload: {
                assistantId: draftAssistantId,
                review: {
                  proposalIds: ids,
                  intentLabel: def.caregiverLabel,
                  summaries,
                  status: 'awaiting_hitl',
                },
              },
            });
          } catch (err) {
            console.warn(
              '[SLM Chat] care-plan proposal draft failed:',
              err instanceof Error ? err.message : err,
            );
          }
        })();
      }

      if (monitorArgs && orchestrator && runHealthMonitorPipelineRef.current) {
        // Auto-run Health Monitor (no confirm). Sev 1–2 may still show
        // caregiver observation review; sev 3 skips that.
        void runHealthMonitorPipelineRef.current({
          args: monitorArgs,
          userText: trimmed,
          prose: finalText,
          historyMessages: [
            ...state.messages,
            {
              id: userMessage.id,
              role: 'user' as const,
              text: trimmed,
              finalText: trimmed,
              thinking: null,
              status: 'done' as const,
              startedAt: Date.now(),
              finishedAt: Date.now(),
              reasoningStartedAt: null,
              phase: 0 as const,
              answerStarted: false,
            },
            {
              id: assistantMessage.id,
              role: 'assistant' as const,
              text: finalText,
              finalText,
              thinking: finalReasoning ?? null,
              status: 'done' as const,
              startedAt: Date.now(),
              finishedAt: Date.now(),
              reasoningStartedAt: null,
              phase: 3 as const,
              answerStarted: true,
            },
          ],
        });
      }
    } catch (error) {
      if (
        error instanceof DOMException &&
        (error.name === 'AbortError' || abortControllerRef.current?.signal.aborted)
      ) {
        dispatch({ type: 'send-stopped', payload: { assistantId: assistantMessage.id } });
      } else {
        dispatch({
          type: 'send-error',
          payload: {
            assistantId: assistantMessage.id,
            error:
              error instanceof Error
                ? error.message
                : 'Something went wrong while streaming the response.',
          },
        });
      }
    } finally {
      abortControllerRef.current = null;
      // A generation finished while the app was backgrounded — the background
      // handler skipped the release so the stream could complete. Release now
      // so the dynamic queue unloads the model.
      if (appBackgroundedRef.current) {
        releaseChatLeaseNow();
      }
    }
  }, [
    inputText,
    state.runStatus,
    state.messages,
    slm,
    snapshot,
    retriever,
    orchestrator,
    allowDevelopmentNluFallback,
    t,
    releaseChatLeaseNow,
  ]);

  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  const groundAnswerAfterHealthMonitor = useCallback(
    async (params: {
      assistantId: string;
      evalBlock: string;
      userText: string;
      prose: string;
      historyMessages: ChatMessage[];
      /** Outcome of the in-chat schedule step (if offered). */
      scheduleOutcome?: InChatScheduleResult | null;
    }) => {
      const contextForRequest: CaregiverAssistantContext = caregiverContext ?? {};
      const systemContext = buildCaregiverSystemContext(contextForRequest);
      const scheduleBlock = params.scheduleOutcome
        ? `\n\n${formatScheduleOutcomeForPrompt(params.scheduleOutcome)}`
        : '';
      const groundingInstruction = [
        'Health Monitor has finished. An INTERNAL_HEALTH_MONITOR_RESULT block is in the system context for you only.',
        '',
        'HOW TO REPLY (required):',
        '- Speak to the family caregiver in calm, plain language — same voice as normal Concierge chat.',
        '- Lead with the bottom line: what looks off (if anything), how urgent it is in everyday words, and what to do next.',
        '- Weave in any caregiver observations they selected (e.g. bathroom changes, reduced intake) as human context — not as code names.',
        '- For moderate/mild findings: suggest check-in, monitoring, or contacting the care team — not automatic 911 unless this is truly urgent.',
        '- For urgent/emergency findings: clear, action-oriented guidance (Call 911 / ER) without dumping technical fields.',
        '- If a CAREGIVER SCHEDULING OUTCOME is provided below, acknowledge it (scheduled details or dismissed) in plain language.',
        '',
        'NEVER do this:',
        '- Do NOT paste, quote, or paraphrase the internal block line-by-line.',
        '- Do NOT list "Anomaly score", "threshold", snake_case labels, or bullet dumps of feature names with numbers.',
        '- Do NOT invent vitals or scores that are not in the monitor result.',
        '',
        'Markdown is fine. Short prose plus light action bullets only. Never invent scores.',
        scheduleBlock,
      ].join('\n');

      const looksLikeRawDump = (text: string): boolean => {
        const t = text.trim();
        if (!t) return true;
        if (/^Anomaly score\s*:/i.test(t)) return true;
        if (/ML_HYPOTHETICAL_EVAL|INTERNAL_HEALTH_MONITOR_RESULT/i.test(t)) return true;
        if (/Initial classification\s*:/i.test(t) && /Post-review classification\s*:/i.test(t)) {
          return true;
        }
        if (/Final notification\s*:/i.test(t) && /Is anomaly\s*:/i.test(t)) return true;
        // Heavy snake_case feature dump
        if ((t.match(/[a-z]+_[a-z]+/g) ?? []).length >= 4) return true;
        return false;
      };

      const runGroundingTurn = async (
        assistantId: string,
        userContent: string,
        history: ChatMessage[],
      ) => {
        const turn2Messages: ProviderChatMessage[] = [
          { role: 'system', content: `${systemContext}\n\n${params.evalBlock}` },
          ...history.map((m) => ({
            role: m.role,
            content: m.finalText ?? m.text,
          })),
          { role: 'user', content: params.userText },
          { role: 'assistant', content: params.prose },
          { role: 'user', content: userContent },
        ];
        const turn2Abort = new AbortController();
        abortControllerRef.current = turn2Abort;
        dispatch({ type: 'set-phase', payload: { assistantId, phase: 2 } });
        return slm.chat(
          turn2Messages,
          (token) => {
            dispatch({
              type: 'mark-answer-started',
              payload: { assistantId },
            });
            dispatch({
              type: 'append-token',
              payload: { assistantId, token },
            });
          },
          turn2Abort.signal,
          getConciergeGeneration(slm.currentModelId ?? DEFAULT_SLM_MODEL_ID, 'deep'),
        );
      };

      let turn2Result = await runGroundingTurn(
        params.assistantId,
        groundingInstruction,
        params.historyMessages,
      );
      let finalText = turn2Result.text;
      let finalReasoning = turn2Result.reasoningContent;

      if (looksLikeRawDump(finalText)) {
        // One retry: model echoed the internal block — force plain-language rewrite.
        const rewriteId = params.assistantId;
        const retryMessages: ProviderChatMessage[] = [
          { role: 'system', content: systemContext },
          {
            role: 'user',
            content:
              'Rewrite the following Health Monitor explanation for a family caregiver. ' +
              'Use warm, plain language. Do NOT include anomaly scores, thresholds, snake_case, ' +
              'or feature dumps. Explain what it means and what to do next.\n\n---\n' +
              finalText,
          },
        ];
        const retryAbort = new AbortController();
        abortControllerRef.current = retryAbort;
        // Clear the bad stream by replacing with rewrite (new tokens append; we replace on success).
        const retryResult = await slm.chat(
          retryMessages,
          () => {
            // Ignore streaming partials on rewrite; we only keep final text.
          },
          retryAbort.signal,
          getConciergeGeneration(slm.currentModelId ?? DEFAULT_SLM_MODEL_ID, 'deep'),
        );
        if (retryResult.text?.trim() && !looksLikeRawDump(retryResult.text)) {
          finalText = retryResult.text;
          finalReasoning = retryResult.reasoningContent ?? finalReasoning;
        } else if (looksLikeRawDump(finalText)) {
          finalText =
            'The Health Monitor noticed an unusual pattern in the vitals you described. ' +
            'With your notes, treat this as something to watch closely and follow your care plan — ' +
            'contact the care team if things worsen, and use emergency services only if breathing, ' +
            'alertness, or other red-flag symptoms are serious. I can go into more detail if you tell me what you are seeing now.';
        }
        void rewriteId;
      }

      dispatch({
        type: 'send-success',
        payload: {
          assistantId: params.assistantId,
          finalText,
          reasoningContent: finalReasoning,
          pendingCaregiverReview: null,
          pendingScheduleFollowUp: null,
          emptyFallback: t('assistant.responseFallback'),
        },
      });
    },
    [caregiverContext, slm, t],
  );

  /**
   * After Health Monitor (+ optional HITL): if professional follow-up is
   * recommended (sev 1–2), pause for in-chat schedule/dismiss; otherwise
   * ground the Concierge answer immediately.
   */
  const maybeOfferScheduleOrGround = useCallback(
    async (params: {
      assistantId: string;
      evalBlock: string;
      mlResult: {
        emergencyResult?: { emergency?: boolean };
        isAnomaly?: boolean;
        finalDecision?: {
          final_severity?: number;
          final_notification_type?: string;
          final_notification_level?: string | null;
          final_notification_body?: string;
        };
        post_hitl_severity?: number;
        postHitlAnomalyType?: string;
        post_hitl_anomaly_type?: string;
        initialAnomalyType?: string;
        final_notification_type?: string;
        final_notification_level?: string | null;
      } | null;
      userText: string;
      prose: string;
      historyMessages: ChatMessage[];
    }) => {
      const { assistantId, evalBlock, mlResult, userText, prose, historyMessages } =
        params;
      if (!mlResult) {
        await groundAnswerAfterHealthMonitor({
          assistantId,
          evalBlock,
          userText,
          prose,
          historyMessages,
        });
        return;
      }

      if (shouldOfferScheduleFollowUp(mlResult) && !canUseLocalAppointmentDemo) {
        await groundAnswerAfterHealthMonitor({
          assistantId,
          evalBlock:
            `${evalBlock}\n\nFOLLOW-UP SCHEDULING STATUS: Appointment scheduling is not available in this caregiver-mode chat. Do not state or imply that a follow-up appointment was scheduled, saved, sent, or received.`,
          userText,
          prose,
          historyMessages,
        });
        return;
      }

      if (shouldOfferScheduleFollowUp(mlResult)) {
        const severity =
          mlResult.finalDecision?.final_severity ?? mlResult.post_hitl_severity ?? 1;
        const summaryLine = [
          `Severity ${severity}`,
          mlResult.isAnomaly ? 'anomaly' : 'pattern',
          String(
            mlResult.postHitlAnomalyType ??
              mlResult.post_hitl_anomaly_type ??
              mlResult.initialAnomalyType ??
              '',
          )
            .replace(/_/g, ' ')
            .toLowerCase(),
        ]
          .filter(Boolean)
          .join(' · ');
        const defaultReason =
          mlResult.finalDecision?.final_notification_body?.trim() ||
          `Follow-up after Health Monitor (${summaryLine})`;
        dispatch({
          type: 'set-pending-schedule-follow-up',
          payload: {
            assistantId,
            schedule: {
              evalBlock,
              severity: Number(severity) || 1,
              summaryLine,
              defaultReason,
            },
            interimText:
              `Professional follow-up recommended (${summaryLine}).\n\n` +
              `Save a local demo follow-up below, or choose Not now — then I’ll wrap up with guidance.`,
          },
        });
        pendingGroundingRef.current[assistantId] = {
          userText,
          prose,
          historyMessages,
        };
        return;
      }

      await groundAnswerAfterHealthMonitor({
        assistantId,
        evalBlock,
        userText,
        prose,
        historyMessages,
      });
    },
    [groundAnswerAfterHealthMonitor, canUseLocalAppointmentDemo],
  );

  const runHealthMonitorPipeline = useCallback(
    async (params: {
      args: HypotheticalVitalsArgs;
      userText: string;
      prose: string;
      historyMessages: ChatMessage[];
    }) => {
      if (!orchestrator) return;
      const { args, userText, prose, historyMessages } = params;

      const vitalsSummary = formatVitalsArgsSummary(args);
      const followUpUser: ChatMessage = {
        id: generateId(),
        role: 'user',
        text: `Vitals detected (${vitalsSummary}) — activating Health Monitor`,
        finalText: `Vitals detected (${vitalsSummary}) — activating Health Monitor`,
        thinking: null,
        status: 'done',
        startedAt: Date.now(),
        finishedAt: Date.now(),
        reasoningStartedAt: null,
        phase: 0,
        answerStarted: false,
      };
      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        text: 'Running Health Monitor…',
        finalText: null,
        thinking: null,
        status: 'streaming',
        startedAt: Date.now(),
        finishedAt: null,
        reasoningStartedAt: null,
        phase: 2,
        answerStarted: true,
      };
      dispatch({ type: 'send-start', payload: { userMessage: followUpUser, assistantMessage } });

      try {
        dispatch({ type: 'mark-tools-phase', payload: { assistantId: assistantMessage.id } });
        const { evalBlock, mlResult } = await orchestrator.executeHypotheticalEval(
          {
            tool: 'evaluate_hypothetical_vitals',
            args: args as Record<string, unknown>,
            rationale: 'auto chat Health Monitor',
          },
          patientId ?? '',
        );

        if (!evalBlock || !mlResult) {
          dispatch({
            type: 'send-error',
            payload: {
              assistantId: assistantMessage.id,
              error: 'Health Monitor did not return a result. Try again or rephrase the vitals.',
            },
          });
          return;
        }

        // Sev 1–2: pause for caregiver observations before Concierge grounds.
        // Sev 3 / emergency: skip HITL (hard threshold path).
        if (needsChatCaregiverReview(mlResult)) {
          const severity =
            mlResult.finalDecision?.final_severity ?? mlResult.post_hitl_severity ?? 1;
          const summaryLine = [
            `Severity ${severity}`,
            mlResult.isAnomaly ? 'anomaly' : 'pattern',
            String(mlResult.initialAnomalyType ?? '').replace(/_/g, ' ').toLowerCase(),
          ]
            .filter(Boolean)
            .join(' · ');
          dispatch({
            type: 'set-pending-caregiver-review',
            payload: {
              assistantId: assistantMessage.id,
              review: {
                vitals: args,
                severity: Number(severity) || 1,
                evalBlock,
                summaryLine,
                mlResult,
              },
              interimText:
                `Health Monitor result (${summaryLine}).\n\n` +
                `Add anything you observed below, then continue — or skip review to use the monitor result only.`,
            },
          });
          pendingGroundingRef.current[assistantMessage.id] = {
            userText,
            prose,
            historyMessages,
          };
          return;
        }

        // No HITL step (e.g. severity 3): publish final decision to Dashboard now.
        publishChatHealthMonitorAlert({
          patientId,
          vitals: args,
          result: mlResult,
        });

        await maybeOfferScheduleOrGround({
          assistantId: assistantMessage.id,
          evalBlock,
          mlResult,
          userText,
          prose,
          historyMessages,
        });
      } catch (error) {
        dispatch({
          type: 'send-error',
          payload: {
            assistantId: assistantMessage.id,
            error:
              error instanceof Error
                ? error.message
                : 'Health Monitor failed. You can still ask Concierge without it.',
          },
        });
      } finally {
        abortControllerRef.current = null;
      }
    },
    [orchestrator, patientId, maybeOfferScheduleOrGround],
  );

  useEffect(() => {
    runHealthMonitorPipelineRef.current = runHealthMonitorPipeline;
  }, [runHealthMonitorPipeline]);

  const handleSkipCaregiverReview = useCallback(
    async (sourceMessage: ChatMessage) => {
      const review = sourceMessage.pendingCaregiverReview;
      if (!review || state.runStatus === 'streaming') return;
      const grounding = pendingGroundingRef.current[sourceMessage.id];
      dispatch({
        type: 'set-pending-caregiver-review',
        payload: { assistantId: sourceMessage.id, review: null },
      });
      const followUpUser: ChatMessage = {
        id: generateId(),
        role: 'user',
        text: 'Continue without extra observations',
        finalText: 'Continue without extra observations',
        thinking: null,
        status: 'done',
        startedAt: Date.now(),
        finishedAt: Date.now(),
        reasoningStartedAt: null,
        phase: 0,
        answerStarted: false,
      };
      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        text: '',
        finalText: null,
        thinking: null,
        status: 'streaming',
        startedAt: Date.now(),
        finishedAt: null,
        reasoningStartedAt: null,
        phase: 2,
        answerStarted: false,
      };
      dispatch({ type: 'send-start', payload: { userMessage: followUpUser, assistantMessage } });
      try {
        // Final ML decision = pre-HITL result (caregiver made no observation changes).
        publishChatHealthMonitorAlert({
          patientId,
          vitals: review.vitals,
          result: review.mlResult,
          observationCodes: [],
        });

        // Sev 1–2: offer schedule; otherwise ground immediately.
        if (review.severity === 1 || review.severity === 2) {
          await maybeOfferScheduleOrGround({
            assistantId: assistantMessage.id,
            evalBlock: review.evalBlock,
            mlResult: review.mlResult,
            userText: grounding?.userText ?? '',
            prose: grounding?.prose ?? sourceMessage.finalText ?? sourceMessage.text,
            historyMessages: grounding?.historyMessages ?? state.messages,
          });
          delete pendingGroundingRef.current[sourceMessage.id];
          return;
        }
        await groundAnswerAfterHealthMonitor({
          assistantId: assistantMessage.id,
          evalBlock: review.evalBlock,
          userText: grounding?.userText ?? '',
          prose: grounding?.prose ?? sourceMessage.finalText ?? sourceMessage.text,
          historyMessages: grounding?.historyMessages ?? state.messages,
        });
      } catch (error) {
        dispatch({
          type: 'send-error',
          payload: {
            assistantId: assistantMessage.id,
            error:
              error instanceof Error ? error.message : 'Failed to finish explanation.',
          },
        });
      } finally {
        delete pendingGroundingRef.current[sourceMessage.id];
        abortControllerRef.current = null;
      }
    },
    [
      groundAnswerAfterHealthMonitor,
      maybeOfferScheduleOrGround,
      patientId,
      state.messages,
      state.runStatus,
    ],
  );

  const handleApplyCaregiverReview = useCallback(
    async (sourceMessage: ChatMessage) => {
      const review = sourceMessage.pendingCaregiverReview;
      if (!review || !orchestrator || state.runStatus === 'streaming') return;
      const codes = reviewCodesByMessage[sourceMessage.id] ?? [];
      const grounding = pendingGroundingRef.current[sourceMessage.id];

      dispatch({
        type: 'set-pending-caregiver-review',
        payload: { assistantId: sourceMessage.id, review: null },
      });

      const followUpUser: ChatMessage = {
        id: generateId(),
        role: 'user',
        text:
          codes.length > 0
            ? `Apply caregiver review: ${codes.join(', ')}`
            : 'Apply caregiver review (no codes)',
        finalText:
          codes.length > 0
            ? `Apply caregiver review: ${codes.join(', ')}`
            : 'Apply caregiver review (no codes)',
        thinking: null,
        status: 'done',
        startedAt: Date.now(),
        finishedAt: Date.now(),
        reasoningStartedAt: null,
        phase: 0,
        answerStarted: false,
      };
      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        text: '',
        finalText: null,
        thinking: null,
        status: 'streaming',
        startedAt: Date.now(),
        finishedAt: null,
        reasoningStartedAt: null,
        phase: 2,
        answerStarted: false,
      };
      dispatch({ type: 'send-start', payload: { userMessage: followUpUser, assistantMessage } });

      try {
        dispatch({ type: 'mark-tools-phase', payload: { assistantId: assistantMessage.id } });
        const { evalBlock, mlResult } = await orchestrator.executeHypotheticalEval(
          {
            tool: 'evaluate_hypothetical_vitals',
            args: review.vitals as Record<string, unknown>,
            rationale: 'chat caregiver HITL re-run',
          },
          patientId ?? '',
          { caregiverSelectedCodes: codes },
        );
        if (!evalBlock || !mlResult) {
          dispatch({
            type: 'send-error',
            payload: {
              assistantId: assistantMessage.id,
              error: 'Health Monitor re-run failed after caregiver review.',
            },
          });
          return;
        }
        // Final post-HITL decision → Dashboard alerts (Care Analysis publish path).
        publishChatHealthMonitorAlert({
          patientId,
          vitals: review.vitals,
          result: mlResult,
          observationCodes: codes,
        });
        await maybeOfferScheduleOrGround({
          assistantId: assistantMessage.id,
          evalBlock,
          mlResult,
          userText: grounding?.userText ?? '',
          prose: grounding?.prose ?? '',
          historyMessages: grounding?.historyMessages ?? state.messages,
        });
      } catch (error) {
        dispatch({
          type: 'send-error',
          payload: {
            assistantId: assistantMessage.id,
            error:
              error instanceof Error
                ? error.message
                : 'Caregiver review failed.',
          },
        });
      } finally {
        delete pendingGroundingRef.current[sourceMessage.id];
        setReviewCodesByMessage((prev) => {
          const next = { ...prev };
          delete next[sourceMessage.id];
          return next;
        });
        abortControllerRef.current = null;
      }
    },
    [
      orchestrator,
      patientId,
      reviewCodesByMessage,
      maybeOfferScheduleOrGround,
      state.messages,
      state.runStatus,
    ],
  );

  const handleScheduleFollowUpComplete = useCallback(
    async (sourceMessage: ChatMessage, result: InChatScheduleResult) => {
      const schedule = sourceMessage.pendingScheduleFollowUp;
      if (!schedule || state.runStatus === 'streaming') return;
      const grounding = pendingGroundingRef.current[sourceMessage.id];

      dispatch({
        type: 'set-pending-schedule-follow-up',
        payload: { assistantId: sourceMessage.id, schedule: null },
      });

      const outcomeLabel =
        result.action === 'scheduled'
          ? `Saved local demo appointment: ${result.type} on ${result.date}${result.time ? ` at ${result.time}` : ''}`
          : 'Dismissed scheduling for now';

      const followUpUser: ChatMessage = {
        id: generateId(),
        role: 'user',
        text: outcomeLabel,
        finalText: outcomeLabel,
        thinking: null,
        status: 'done',
        startedAt: Date.now(),
        finishedAt: Date.now(),
        reasoningStartedAt: null,
        phase: 0,
        answerStarted: false,
      };
      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        text: '',
        finalText: null,
        thinking: null,
        status: 'streaming',
        startedAt: Date.now(),
        finishedAt: null,
        reasoningStartedAt: null,
        phase: 2,
        answerStarted: false,
      };
      dispatch({ type: 'send-start', payload: { userMessage: followUpUser, assistantMessage } });

      try {
        await groundAnswerAfterHealthMonitor({
          assistantId: assistantMessage.id,
          evalBlock: schedule.evalBlock,
          userText: grounding?.userText ?? '',
          prose: grounding?.prose ?? sourceMessage.finalText ?? sourceMessage.text,
          historyMessages: grounding?.historyMessages ?? state.messages,
          scheduleOutcome: result,
        });
      } catch (error) {
        dispatch({
          type: 'send-error',
          payload: {
            assistantId: assistantMessage.id,
            error:
              error instanceof Error
                ? error.message
                : 'Failed to finish after scheduling.',
          },
        });
      } finally {
        delete pendingGroundingRef.current[sourceMessage.id];
        abortControllerRef.current = null;
      }
    },
    [groundAnswerAfterHealthMonitor, state.messages, state.runStatus],
  );

  const handleNewConversation = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    dispatch({ type: 'new-conversation' });
  }, []);

  const toggleReasoning = useCallback((messageId: string) => {
    setShowReasoningFor((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }, []);

  const handleTellMeMore = useCallback(
    async (sourceMessage: ChatMessage) => {
      if (!sourceMessage.finalText || state.runStatus === 'streaming') return;
      const trimmed = inputText.trim();
      const followUpText = trimmed || 'Tell me more about your last answer. Go deeper on the reasoning, evidence, and practical next steps.';
      // Replay the most recent exchange as a follow-up.
      const userMessage: ChatMessage = {
        id: generateId(),
        role: 'user',
        text: followUpText,
        finalText: followUpText,
        thinking: null,
        status: 'done',
        startedAt: Date.now(),
        finishedAt: Date.now(),
        reasoningStartedAt: null,
        phase: 0,
        answerStarted: false,
      };
      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        text: '',
        finalText: null,
        thinking: null,
        status: 'streaming',
        startedAt: Date.now(),
        finishedAt: null,
        reasoningStartedAt: null,
        phase: 0,
        answerStarted: false,
      };
      dispatch({ type: 'send-start', payload: { userMessage, assistantMessage } });
      setInputText('');
      const contextForRequest: CaregiverAssistantContext = caregiverContext ?? {};
      const systemContext = buildCaregiverSystemContext(contextForRequest);
      const priorMessages: ProviderChatMessage[] = state.messages.map((m) => ({
        role: m.role,
        content: m.finalText ?? m.text,
      }));
      const messages: ProviderChatMessage[] = [
        { role: 'system', content: systemContext },
        ...priorMessages,
        { role: 'user', content: followUpText },
      ];
      abortControllerRef.current = new AbortController();
      try {
        const result = await slm.chat(
          messages,
          (token) => {
            dispatch({ type: 'mark-answer-started', payload: { assistantId: assistantMessage.id } });
            dispatch({ type: 'append-token', payload: { assistantId: assistantMessage.id, token } });
          },
          abortControllerRef.current.signal,
          selectChatGeneration({ forceDeep: true }).profile,
          (token) => {
            dispatch({ type: 'set-phase', payload: { assistantId: assistantMessage.id, phase: 1 } });
            dispatch({ type: 'append-reasoning-token', payload: { assistantId: assistantMessage.id, token } });
          },
        );
        dispatch({
          type: 'send-success',
          payload: {
            assistantId: assistantMessage.id,
            finalText: result.text,
            reasoningContent: result.reasoningContent,
            emptyFallback: t('assistant.responseFallback'),
          },
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          dispatch({ type: 'send-stopped', payload: { assistantId: assistantMessage.id } });
        } else {
          dispatch({
            type: 'send-error',
            payload: {
              assistantId: assistantMessage.id,
              error: error instanceof Error ? error.message : 'Something went wrong.',
            },
          });
        }
      } finally {
        abortControllerRef.current = null;
      }
    },
    [caregiverContext, inputText, slm, state.messages, state.runStatus, t],
  );

  const renderMessage: ListRenderItem<ChatMessage> = ({ item }) => {
    if (item.role === 'user') {
      return (
        <View style={styles.userBubbleWrapper}>
          <View style={[styles.userBubble, themedStyles.userBubble]}>
            <Text style={[styles.userBubbleText, themedStyles.userBubbleText]}>{item.text}</Text>
          </View>
        </View>
      );
    }

    const reasoningOpen = showReasoningFor.has(item.id);
    const isExpanded = expandedMessageIds.has(item.id);
    const reasoning = item.thinking;
    const showReasoningToggle = isDeveloper && Boolean(reasoning && reasoning.trim());
    const rawDisplayText = isExpanded || !item.finalText
      ? item.finalText ?? item.text
      : truncateForQuickAnswer(item.finalText ?? item.text);
    const displayText = formatAssistantMessageForDisplay(rawDisplayText, t);
    return (
      <View style={[styles.assistantBubble, themedStyles.assistantBubble]}>
        {item.status === 'streaming' && !item.answerStarted && (
          // Never render the raw reasoning stream in the bubble. While the
          // model is thinking (before the first answer token), show only the
          // blinking-ellipsis + discrete step progress bar. Passing the raw
          // reasoning text lets the indicator light one chunk per completed
          // reasoning step (deriveReasoningSteps) — real structure, not a loop.
          <ThinkingIndicator
            phase={item.phase}
            streaming={false}
            reasoning={item.thinking}
          />
        )}

        {item.status === 'streaming' && item.answerStarted && (
          // Answer streaming — render in bold inline; the indicator hides
          // (streaming={true}) and no grey reasoning text is shown.
          <View style={styles.answerContainer}>
            <MarkdownRenderer size="large" bold>{item.text}</MarkdownRenderer>
          </View>
        )}

        {(item.status === 'done' || item.status === 'stopped' || item.status === 'error') && (
          <>
            {item.finalText ? (
              <View style={styles.answerContainer}>
                <MarkdownRenderer size="large">{displayText}</MarkdownRenderer>
                {!isExpanded && shouldOfferTellMeMore(item.finalText) ? (
                  <Pressable
                    style={[styles.tellMeMoreButton, themedStyles.outlineAction]}
                    onPress={() => {
                      setExpandedMessageIds((prev) => new Set(prev).add(item.id));
                      void handleTellMeMore(item);
                    }}
                    disabled={state.runStatus === 'streaming'}
                  >
                    <Text style={[styles.tellMeMoreText, themedStyles.accentText]}>{t('assistant.tellMeMore')}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <Text style={[styles.answerText, themedStyles.primaryText]}>
                {formatAssistantMessageForDisplay(item.text, t)}
              </Text>
            )}

            {item.sources && item.sources.length > 0 && item.status === 'done' ? (
              <CitationList
                sources={item.sources}
                collapsible
                defaultExpanded={false}
                compact
                maxItems={6}
              />
            ) : null}

            {item.pendingCaregiverReview && item.status === 'done' ? (
              <View style={[styles.healthMonitorConfirmCard, themedStyles.healthMonitorConfirmCard]}>
                <Text style={[styles.healthMonitorConfirmTitle, themedStyles.primaryText]}>
                  {t('assistant.review.title', {
                    label: t(chatReviewSeverityKey(item.pendingCaregiverReview.severity)),
                  })}
                </Text>
                <Text style={[styles.healthMonitorConfirmBody, themedStyles.supportingText]}>
                  {t('assistant.review.body', {
                    summary: item.pendingCaregiverReview.summaryLine,
                  })}
                </Text>
                <ObservationPicker
                  selected={reviewCodesByMessage[item.id] ?? []}
                  onChange={(codes) =>
                    setReviewCodesByMessage((prev) => ({ ...prev, [item.id]: codes }))
                  }
                  enabled={state.runStatus !== 'streaming'}
                />
                <View style={styles.healthMonitorConfirmRow}>
                  <Pressable
                    style={[styles.healthMonitorButton, styles.healthMonitorButtonPrimary]}
                    onPress={() => void handleApplyCaregiverReview(item)}
                    disabled={state.runStatus === 'streaming'}
                  >
                    <Text style={styles.healthMonitorButtonPrimaryText}>
                      {t('assistant.review.apply')}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.healthMonitorButton, styles.healthMonitorButtonSecondary, themedStyles.secondaryAction]}
                    onPress={() => void handleSkipCaregiverReview(item)}
                    disabled={state.runStatus === 'streaming'}
                  >
                    <Text style={[styles.healthMonitorButtonSecondaryText, themedStyles.accentText]}>
                      {t('assistant.review.skip')}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {item.pendingScheduleFollowUp && item.status === 'done' && patientId ? (
              <InChatScheduleAppointmentCard
                patientId={patientId}
                defaultReason={item.pendingScheduleFollowUp.defaultReason}
                enabled={state.runStatus !== 'streaming'}
                onComplete={(result) => void handleScheduleFollowUpComplete(item, result)}
              />
            ) : null}
            {item.pendingScheduleFollowUp && item.status === 'done' && !patientId ? (
              <View style={[styles.healthMonitorConfirmCard, themedStyles.healthMonitorConfirmCard]}>
                <Text style={[styles.healthMonitorConfirmBody, themedStyles.supportingText]}>
                  {t('assistant.schedule.noActivePatient')}
                </Text>
                <Pressable
                  style={[styles.healthMonitorButton, styles.healthMonitorButtonSecondary, themedStyles.secondaryAction]}
                  onPress={() =>
                    void handleScheduleFollowUpComplete(item, { action: 'dismissed' })
                  }
                >
                  <Text style={[styles.healthMonitorButtonSecondaryText, themedStyles.accentText]}>{t('assistant.schedule.continueWithoutScheduling')}</Text>
                </Pressable>
              </View>
            ) : null}

            {item.pendingCareChips && item.status === 'done' ? (
              <View style={[styles.healthMonitorConfirmCard, themedStyles.healthMonitorConfirmCard]}>
                <View style={styles.careChipsRow}>
                  {item.pendingCareChips.map((chip) => (
                    <Pressable
                      key={chip.chipId}
                      style={[styles.careChip, themedStyles.careChip]}
                      onPress={() => {
                        void handleAskAssistant(
                          chatPromptForCareIntent(chip.intent, chip.args),
                          { skipCareRoute: true },
                        );
                      }}
                      disabled={state.runStatus === 'streaming'}
                      accessibilityRole="button"
                      accessibilityLabel={chip.label}
                    >
                      <Text style={[styles.careChipText, themedStyles.accentText]}>{chip.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {item.pendingPlanProposal && item.status === 'done' ? (
              <View style={[styles.healthMonitorConfirmCard, themedStyles.healthMonitorConfirmCard]}>
                <Text style={[styles.healthMonitorConfirmTitle, themedStyles.primaryText]}>
                  {item.pendingPlanProposal.intentLabel || t('assistant.planProposal.title')}
                </Text>
                {item.pendingPlanProposal.status === 'awaiting_hitl' ? (
                  <>
                    {item.pendingPlanProposal.summaries.map((summary, index) => (
                      <Text
                        key={`${item.id}-proposal-${index}`}
                        style={[styles.healthMonitorConfirmBody, themedStyles.supportingText]}
                      >
                        {'\u2022'} {summary}
                      </Text>
                    ))}
                    <Text style={[styles.healthMonitorConfirmBody, themedStyles.mutedText]}>
                      {t('assistant.planProposal.footnote')}
                    </Text>
                    <View style={styles.healthMonitorConfirmRow}>
                      <Pressable
                        style={[styles.healthMonitorButton, styles.healthMonitorButtonPrimary]}
                        onPress={() => handleConfirmPlanProposal(item.id, item.pendingPlanProposal!)}
                        disabled={state.runStatus === 'streaming'}
                        accessibilityRole="button"
                        accessibilityLabel={t('assistant.planProposal.confirm')}
                      >
                        <Text style={styles.healthMonitorButtonPrimaryText}>
                          {t('assistant.planProposal.confirm')}
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[styles.healthMonitorButton, styles.healthMonitorButtonSecondary, themedStyles.secondaryAction]}
                        onPress={() => handleRejectPlanProposal(item.id, item.pendingPlanProposal!)}
                        disabled={state.runStatus === 'streaming'}
                        accessibilityRole="button"
                        accessibilityLabel={t('assistant.planProposal.reject')}
                      >
                        <Text style={[styles.healthMonitorButtonSecondaryText, themedStyles.accentText]}>
                          {t('assistant.planProposal.reject')}
                        </Text>
                      </Pressable>
                    </View>
                  </>
                ) : (
                  <Text style={[styles.healthMonitorConfirmBody, themedStyles.supportingText]}>
                    {item.pendingPlanProposal.status === 'confirmed'
                      ? t('assistant.planProposal.confirmed')
                      : item.pendingPlanProposal.status === 'rejected'
                        ? t('assistant.planProposal.rejected')
                        : item.pendingPlanProposal.errorDetail ?? t('assistant.planProposal.error')}
                  </Text>
                )}
              </View>
            ) : null}

            {showReasoningToggle ? (
              <View style={styles.reasoningSection}>
                <Pressable onPress={() => toggleReasoning(item.id)}>
                  <Text style={[styles.reasoningToggle, themedStyles.supportingText]}>
                    {reasoningOpen ? '▾' : '▸'} {reasoningOpen ? t('assistant.reasoning.hide') : t('assistant.reasoning.show')}
                  </Text>
                </Pressable>
                {reasoningOpen ? (
                  <View style={[styles.reasoningBox, themedStyles.reasoningBox]}>
                    <Text style={[styles.reasoningText, themedStyles.supportingText]}>
                      {reasoning}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {item.status === 'error' ? (
              <Text style={[styles.errorText, themedStyles.errorText]}>
                {t('assistant.error.withDetail', {
                  error: formatAssistantErrorForDisplay(item.finalText, t),
                })}
              </Text>
            ) : null}
            {item.status === 'stopped' ? (
              <Text style={[styles.stoppedHint, themedStyles.mutedText]}>· {t('assistant.status.stopped')}</Text>
            ) : null}
          </>
        )}
      </View>
    );
  };

  const patientRecordLoading = !ready;
  const isInputDisabled = slm.loadStatus !== 'ready' && slm.loadStatus !== 'idle';
  const notProvided = t('common.notProvided');

  if (!optionalGate.ready) {
    return (
      <SafeAreaView
        style={[styles.container, themedStyles.container]}
        edges={showBackButton ? ['top', 'bottom'] : ['top']}
      >
        {showBackButton ? (
          <View style={styles.headerRow}>
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <Text style={styles.backText}>← {t('common.back')}</Text>
            </Pressable>
            <Text style={styles.headerTitle}>{t('assistant.header.title')}</Text>
          </View>
        ) : null}
        <View style={styles.greyedBody}>
          <OptionalFeaturePrompt
            requirement="slm"
            simulatedMissing={optionalGate.simulatedMissing}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, themedStyles.container]}
      edges={showBackButton ? ['top', 'bottom'] : ['top']}
    >
      <KeyboardAvoidingView
        style={[styles.keyboardView, themedStyles.container]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
        {showBackButton ? (
          <View style={styles.headerRow}>
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <Text style={[styles.backText, themedStyles.accentText]}>← {t('common.back')}</Text>
            </Pressable>
          </View>
        ) : null}

        <ScrollView style={[styles.scrollView, themedStyles.container]} contentContainerStyle={styles.scrollContent}>
          <MainTabHeader
            title={t('assistant.header.title')}
            eyebrow={t('assistant.header.eyebrow')}
            subtitle={t('assistant.header.subtitle')}
            icon="assistant"
            rightContent={
              <Pressable
                onPress={handleNewConversation}
                style={[styles.newConvButton, themedStyles.outlineAction]}
                accessibilityRole="button"
                accessibilityLabel={t('assistant.newConversation')}
              >
                <Text style={[styles.newConvButtonText, themedStyles.accentText]} numberOfLines={1}>{t('assistant.newConversationShort')}</Text>
              </Pressable>
            }
          />

          <View style={[styles.contextCard, themedStyles.card]}>
            <Pressable
              style={styles.collapsibleCardHeader}
              onPress={() => setCareContextExpanded((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: careContextExpanded }}
              accessibilityLabel={t('assistant.context.a11y', {
                state: expandCollapseState(careContextExpanded, t),
              })}
            >
              <View style={styles.collapsibleCardHeaderText}>
                <Text style={[styles.cardTitle, themedStyles.primaryText]}>{t('assistant.context.title')}</Text>
                {!careContextExpanded ? (
                  <Text style={[styles.collapsibleCardSummary, themedStyles.supportingText]} numberOfLines={1}>
                    {snapshot?.patient
                      ? t('assistant.context.patientSummary', {
                          name: snapshot.patient.preferredName?.trim() || snapshot.patient.name,
                        })
                      : t('assistant.context.tapToExpand')}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.collapsibleChevron, themedStyles.supportingText]}>{careContextExpanded ? '▾' : '▸'}</Text>
            </Pressable>

            {careContextExpanded ? (
              <>
                {patientRecordLoading ? (
                  <Text style={[styles.contextText, themedStyles.supportingText]}>{t('assistant.context.loading')}</Text>
                ) : patientRecordError ? (
                  <Text style={[styles.errorText, themedStyles.errorText]}>
                    {t('assistant.context.unavailable', { message: patientRecordError.message })}
                  </Text>
                ) : !snapshot?.patient ? (
                  <Text style={[styles.contextText, themedStyles.supportingText]}>
                    {t('assistant.context.noRecord')}
                  </Text>
                ) : (
                  <>
                    <CollapsibleCareSection
                      id="patient"
                      title={t('assistant.context.patient')}
                      summary={t('assistant.context.patientSummaryAge', {
                        name: snapshot.patient.preferredName?.trim() || snapshot.patient.name,
                        age: caregiverContext?.patientAge ?? notProvided,
                      })}
                      expanded={expandedCareSections.has('patient')}
                      onToggle={toggleCareSection}
                    >
                      <Text style={[styles.contextText, themedStyles.supportingText]}>
                        {t('assistant.context.conditions', {
                          value:
                            snapshot.conditions.map((condition: PatientCondition) => condition.name).filter(Boolean).join(', ') ||
                            t('assistant.context.noConditions'),
                        })}
                      </Text>
                      <Text style={[styles.contextText, themedStyles.supportingText]}>
                        {t('assistant.context.medications', {
                          value: medicationNames.join(', ') || t('assistant.context.noMedications'),
                        })}
                      </Text>
                      <Text style={[styles.contextText, themedStyles.supportingText]}>
                        {t('assistant.context.baselineRoutine', {
                          value: snapshot.patient.baselineDailyRoutine ?? notProvided,
                        })}
                      </Text>
                      <Text style={[styles.contextText, themedStyles.supportingText]}>
                        {t('assistant.context.spo2Cutoff', {
                          value: snapshot.patient.spo2Cutoff ?? notProvided,
                        })} · {t('assistant.context.baselineHr', {
                          value: snapshot.patient.baselineHeartRate ?? notProvided,
                        })}
                      </Text>
                    </CollapsibleCareSection>

                    <CollapsibleCareSection
                      id="caregiver"
                      title={t('assistant.context.caregiver')}
                      summary={
                        snapshot.caregiver
                          ? `${snapshot.caregiver.name} (${snapshot.caregiver.relationship ?? notProvided})`
                          : notProvided
                      }
                      expanded={expandedCareSections.has('caregiver')}
                      onToggle={toggleCareSection}
                    >
                      {snapshot.caregiver ? (
                        <>
                          <Text style={[styles.contextText, themedStyles.supportingText]}>
                            {snapshot.caregiver.name} ({snapshot.caregiver.relationship ?? t('assistant.context.relationshipNotProvided')}) · {snapshot.caregiver.experience ?? t('assistant.context.experienceNotProvided')} · {snapshot.caregiver.availability ?? t('assistant.context.availabilityNotProvided')}
                          </Text>
                          <Text style={[styles.contextText, themedStyles.supportingText]}>
                            {t('assistant.context.language', {
                              value: languagePreferenceLabel(snapshot.caregiver.languagePreference, t) || notProvided,
                            })} · {t('assistant.context.comfort', {
                              value: snapshot.caregiver.medicalComfortLevel ?? notProvided,
                            })}
                          </Text>
                          <Text style={[styles.contextText, themedStyles.supportingText]}>
                            {t('assistant.context.activeConcern', {
                              value: snapshot.caregiver.mainConcern ?? notProvided,
                            })}
                          </Text>
                          <Text style={[styles.contextText, themedStyles.supportingText]}>
                            {t('assistant.context.backup', {
                              value: snapshot.caregiver.backupCaregiver ?? notProvided,
                            })}
                          </Text>
                        </>
                      ) : (
                        <Text style={[styles.contextText, themedStyles.supportingText]}>{t('assistant.context.noCaregiver')}</Text>
                      )}
                    </CollapsibleCareSection>

                    <CollapsibleCareSection
                      id="care-team"
                      title={t('assistant.context.careTeam')}
                      summary={t('assistant.context.pcp', {
                        value: caregiverContext?.primaryCareProviderName ?? notProvided,
                      })}
                      expanded={expandedCareSections.has('care-team')}
                      onToggle={toggleCareSection}
                    >
                      <Text style={[styles.contextText, themedStyles.supportingText]}>
                        {t('assistant.context.pcp', {
                          value: caregiverContext?.primaryCareProviderName ?? notProvided,
                        })}
                        {caregiverContext?.primaryCareProviderPhone ? ` · ${caregiverContext.primaryCareProviderPhone}` : ''}
                      </Text>
                      {caregiverContext?.primaryCareProviderEmail ? (
                        <Text style={[styles.contextText, themedStyles.supportingText]}>
                          {t('assistant.context.email', {
                            value: caregiverContext.primaryCareProviderEmail,
                          })}
                        </Text>
                      ) : null}
                    </CollapsibleCareSection>

                    <CollapsibleCareSection
                      id="safety"
                      title={t('assistant.context.safety')}
                      summary={t('assistant.context.emergency', {
                        value: caregiverContext?.emergencyContact ?? notProvided,
                      })}
                      expanded={expandedCareSections.has('safety')}
                      onToggle={toggleCareSection}
                    >
                      <Text style={[styles.contextText, themedStyles.supportingText]}>
                        {t('assistant.context.emergencyContact', {
                          value: caregiverContext?.emergencyContact ?? notProvided,
                        })}
                      </Text>
                      <Text style={[styles.contextText, themedStyles.supportingText]}>
                        {t('assistant.context.safetyNotes', {
                          value: caregiverContext?.safetyNotes ?? notProvided,
                        })}
                      </Text>
                    </CollapsibleCareSection>

                    <CollapsibleCareSection
                      id="clinical"
                      title={t('assistant.context.clinical')}
                      summary={`${dedupedSymptoms.length} ${
                        dedupedSymptoms.length === 1
                          ? t('assistant.context.symptom.one')
                          : t('assistant.context.symptom.many')
                      } · ${snapshot.thresholds.length} ${
                        snapshot.thresholds.length === 1
                          ? t('assistant.context.threshold.one')
                          : t('assistant.context.threshold.many')
                      }`}
                      expanded={expandedCareSections.has('clinical')}
                      onToggle={toggleCareSection}
                    >
                      <Text style={[styles.contextText, themedStyles.supportingText]}>
                        {t('assistant.context.symptoms', {
                          value: dedupedSymptoms.join(', ') || t('assistant.context.noSymptoms'),
                        })}
                      </Text>
                      <Text style={[styles.contextText, themedStyles.supportingText]}>
                        {t('assistant.context.activeThresholds', {
                          count: snapshot.thresholds.length,
                        })}
                      </Text>
                    </CollapsibleCareSection>
                  </>
                )}
                <Pressable
                  style={[styles.editProfilesButton, themedStyles.softAction]}
                  onPress={() => router.push('/profile' as never)}
                  accessibilityRole="button"
                  accessibilityLabel={t('assistant.context.editProfilesA11y')}
                >
                  <Text style={[styles.editProfilesButtonText, themedStyles.accentText]}>{t('assistant.context.editProfiles')}</Text>
                </Pressable>
                <Text style={[styles.tagline, themedStyles.mutedText]}>
                  {t('assistant.tagline', { source: t('assistant.term.concierge') })}
                </Text>
              </>
            ) : null}
          </View>

          {state.messages.length === 0 ? (
            <>
              <ConciergeSuggestionBox
                onSendPrompt={(prompt) => void handleAskAssistant(prompt)}
                onLaunchIntent={(intentId: AdcpProposalIntentId, args?: Record<string, unknown>) => {
                  void handleAskAssistant(chatPromptForCareIntent(intentId, args), {
                    skipCareRoute: true,
                  });
                }}
                disabled={state.runStatus === 'streaming'}
                opportunities={suggestionOpportunities}
              />
              <View style={[styles.howToCard, themedStyles.softCard]}>
                <Pressable
                  style={styles.collapsibleCardHeader}
                  onPress={() => setHowMonitorExpanded((v) => !v)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: howMonitorExpanded }}
                  accessibilityLabel={t('assistant.howMonitor.a11y', {
                    state: expandCollapseState(howMonitorExpanded, t),
                  })}
                >
                  <Text style={[styles.howToTitle, themedStyles.primaryText]}>{t('assistant.howMonitor.title')}</Text>
                  <Text style={[styles.collapsibleChevron, themedStyles.supportingText]}>{howMonitorExpanded ? '▾' : '▸'}</Text>
                </Pressable>
                {howMonitorExpanded ? (
                  <>
                    <Text style={[styles.howToBody, themedStyles.supportingText]}>
                      {t('assistant.howMonitor.step1')}
                    </Text>
                    <Text style={[styles.howToBody, themedStyles.supportingText]}>
                      {t('assistant.howMonitor.step2')}
                    </Text>
                    <Text style={[styles.howToBody, themedStyles.supportingText]}>
                      {t('assistant.howMonitor.step3')}
                    </Text>
                    <Text style={[styles.howToBody, themedStyles.supportingText]}>
                      {t('assistant.howMonitor.step4')}
                    </Text>
                    <Text style={[styles.howToFootnote, themedStyles.accentText]}>
                      {t('assistant.howMonitor.footnote')}
                    </Text>
                  </>
                ) : null}
              </View>
            </>
          ) : (
            <View style={[styles.card, themedStyles.card]}>
              <FlatList
                ref={flatListRef}
                data={state.messages}
                keyExtractor={(item) => item.id}
                renderItem={renderMessage}
                contentContainerStyle={styles.messagesContent}
                scrollEnabled={false}
              />
            </View>
          )}

          <View style={[styles.safetyCard, themedStyles.safetyCard]}>
            <Text style={[styles.safetyNote, themedStyles.safetyNote]}>
              {t('assistant.safetyNote')}
            </Text>
          </View>
        </ScrollView>

        <View style={[styles.inputRow, themedStyles.inputRow]}>
          <TextInput
            value={inputText}
            onChangeText={handleInputChange}
            placeholder={t('assistant.input.placeholder')}
            placeholderTextColor={isDarkTheme ? theme.appTextMuted : '#8A9A9A'}
            multiline
            maxLength={4000}
            editable={!isInputDisabled}
            accessibilityLabel={t('assistant.input.a11y')}
            style={[
              styles.textInput,
              themedStyles.textInput,
              { height: inputHeight },
            ]}
            textAlignVertical="top"
            scrollEnabled={inputHeight >= PROMPT_INPUT_MAX_HEIGHT - 1}
          />
          {state.runStatus === 'streaming' ? (
            <Pressable
              onPress={handleStop}
              style={[styles.sendButton, styles.stopButton]}
              accessibilityRole="button"
              accessibilityLabel={t('common.stop')}
            >
              <Text style={styles.sendButtonText}>{t('common.stop')}</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => void handleAskAssistant()}
              disabled={!inputText.trim() || isInputDisabled}
              accessibilityRole="button"
              accessibilityLabel={t('common.ask')}
              style={[
                styles.sendButton,
                {
                  backgroundColor:
                    inputText.trim() && !isInputDisabled
                      ? '#0E6F68'
                      : isDarkTheme
                        ? theme.appControlSurface
                        : theme.backgroundElement,
                },
              ]}>
              <Text
                style={{
                  color: inputText.trim() && !isInputDisabled ? '#FFFFFF' : theme.appTextMuted,
                  fontWeight: '600',
                }}>
                {t('common.ask')}
              </Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>

    </SafeAreaView>
  );
}

function CollapsibleCareSection({
  id,
  title,
  summary,
  expanded,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  summary: string;
  expanded: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);

  return (
    <View style={styles.careSectionWrap}>
      <Pressable
        style={styles.careSectionHeader}
        onPress={() => onToggle(id)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${title} - ${expandCollapseState(expanded, t)}`}
      >
        <Text style={[styles.contextSection, themedStyles.accentText]}>{title}</Text>
        <Text style={[styles.careSectionChevron, themedStyles.accentText]}>{expanded ? '▾' : '▸'}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.careSectionBody}>{children}</View>
      ) : (
        <Text style={[styles.careSectionSummary, themedStyles.mutedText]} numberOfLines={2}>{summary}</Text>
      )}
    </View>
  );
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  const isDark = theme.appBackground === '#000000';
  const accentText = isDark ? AppTheme.colors.brandPale : '#0E6F68';

  return StyleSheet.create({
    container: {
      backgroundColor: theme.appBackground,
    },
    card: {
      backgroundColor: theme.appSurface,
    },
    softCard: {
      backgroundColor: isDark ? theme.appControlSurface : '#F0F7F6',
      borderColor: isDark ? theme.appBorder : '#C5DDD9',
    },
    primaryText: {
      color: isDark ? theme.appText : '#123433',
    },
    supportingText: {
      color: isDark ? theme.appTextSupporting : '#526866',
    },
    mutedText: {
      color: isDark ? theme.appTextMuted : '#8B9AB6',
    },
    accentText: {
      color: accentText,
    },
    outlineAction: {
      borderColor: accentText,
    },
    softAction: {
      backgroundColor: isDark ? theme.appControlSurface : '#E8F5F3',
      borderColor: accentText,
    },
    healthMonitorConfirmCard: {
      backgroundColor: isDark ? theme.appControlSurface : '#F0F7F6',
      borderColor: accentText,
    },
    careChip: {
      backgroundColor: isDark ? theme.appSurface : AppTheme.colors.brandSoft,
    },
    secondaryAction: {
      backgroundColor: isDark ? theme.appInputBackground : '#FFFFFF',
      borderColor: accentText,
    },
    assistantBubble: {
      borderTopColor: isDark ? theme.appBorder : '#88888830',
    },
    userBubble: {
      backgroundColor: isDark ? theme.appControlSurface : theme.backgroundElement,
    },
    userBubbleText: {
      color: theme.text,
    },
    reasoningBox: {
      backgroundColor: isDark ? theme.appInputBackground : '#F7FAF9',
      borderColor: isDark ? theme.appBorder : theme.textSecondary + '40',
    },
    errorText: {
      color: isDark ? AppTheme.colors.dangerLight : '#B42318',
    },
    safetyCard: {
      backgroundColor: isDark ? theme.appControlSurface : '#FFFFFF',
    },
    safetyNote: {
      color: isDark ? AppTheme.colors.warningSoft : '#7A4A00',
    },
    inputRow: {
      backgroundColor: theme.appSurface,
      borderTopColor: isDark ? theme.appBorder : theme.textSecondary + '30',
    },
    textInput: {
      color: theme.text,
      backgroundColor: isDark ? theme.appInputBackground : theme.backgroundElement,
      borderColor: isDark ? theme.appBorder : '#D9E7E5',
    },
  });
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 40,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  headerTitle: {
    color: AppTheme.colors.sectionText,
    fontSize: 15,
    fontWeight: '900',
  },
  greyedBody: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  headerRowTab: {
    justifyContent: 'space-between',
  },
  headerTabTitle: {
    color: '#0E6F68',
    fontWeight: '900',
    fontSize: 17,
  },
  backButton: {
    paddingVertical: 8,
  },
  backText: {
    color: '#0E6F68',
    fontWeight: '700',
  },
  newConvButton: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#0E6F68',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newConvButtonText: {
    color: '#0E6F68',
    fontWeight: '700',
    fontSize: 13,
  },
  contextCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
  },
  howToCard: {
    backgroundColor: '#F0F7F6',
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#C5DDD9',
  },
  collapsibleCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  collapsibleCardHeaderText: {
    flex: 1,
  },
  collapsibleCardSummary: {
    color: '#526866',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  collapsibleChevron: {
    color: '#526866',
    fontSize: 16,
    fontWeight: '900',
  },
  editProfilesButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: '#E8F5F3',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#0E6F68',
  },
  editProfilesButtonText: {
    color: '#0E6F68',
    fontSize: 13,
    fontWeight: '900',
  },
  howToTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: '#123433',
    marginBottom: 0,
  },
  howToBody: {
    color: '#526866',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  howToFootnote: {
    color: '#0E6F68',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  healthMonitorConfirmCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#F0F7F6',
    borderWidth: 1,
    borderColor: '#0E6F68',
  },
  healthMonitorConfirmTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#123433',
    marginBottom: 6,
  },
  healthMonitorConfirmBody: {
    fontSize: 13,
    color: '#526866',
    lineHeight: 18,
    marginBottom: 12,
  },
  careChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  careChip: {
    backgroundColor: AppTheme.colors.brandSoft,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  careChipText: {
    color: AppTheme.colors.brand,
    fontSize: 13,
    fontWeight: '800',
  },
  healthMonitorConfirmRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  healthMonitorButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  healthMonitorButtonPrimary: {
    backgroundColor: '#0E6F68',
  },
  healthMonitorButtonPrimaryText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  healthMonitorButtonSecondary: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#0E6F68',
  },
  healthMonitorButtonSecondaryText: {
    color: '#0E6F68',
    fontWeight: '700',
    fontSize: 13,
  },
  safetyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#123433',
    marginBottom: 10,
  },
  contextText: {
    color: '#526866',
    marginBottom: 6,
    lineHeight: 20,
  },
  contextSection: {
    color: '#0E6F68',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 10,
    marginBottom: 4,
  },
  careSectionWrap: {
    marginBottom: 2,
  },
  careSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  careSectionChevron: {
    color: '#0E6F68',
    fontSize: 14,
    fontWeight: '800',
  },
  careSectionSummary: {
    color: '#7A8A89',
    fontSize: 13,
    marginBottom: 6,
    lineHeight: 20,
  },
  careSectionBody: {
    marginTop: 2,
    marginBottom: 4,
  },
  tagline: {
    fontSize: 11,
    color: '#8B9AB6',
    fontStyle: 'italic',
    marginTop: 12,
    textAlign: 'center',
  },
  errorText: {
    color: '#B42318',
    marginTop: 8,
  },
  messagesContent: {
    gap: 12,
  },
  userBubbleWrapper: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  userBubble: {
    maxWidth: '80%',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 18,
  },
  userBubbleText: {
    fontSize: 15,
  },
  assistantBubble: {
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#88888830',
  },
  streamingText: {
    fontStyle: 'italic',
    fontSize: 14,
    lineHeight: 20,
  },
  answerContainer: {
    marginTop: 4,
  },
  tellMeMoreButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#0E6F68',
  },
  tellMeMoreText: {
    color: '#0E6F68',
    fontWeight: '700',
    fontSize: 13,
  },
  reasoningSection: {
    marginTop: 8,
  },
  reasoningToggle: {
    fontSize: 12,
    fontWeight: '600',
    paddingVertical: 4,
  },
  reasoningBox: {
    marginTop: 4,
    padding: 10,
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: '#F7FAF9',
  },
  reasoningText: {
    fontSize: 12,
    lineHeight: 17,
    fontStyle: 'italic',
  },
  answerText: {
    fontSize: 15,
    lineHeight: 22,
  },
  stoppedHint: {
    fontStyle: 'italic',
    marginTop: 4,
    fontSize: 13,
  },
  safetyNote: {
    color: '#7A4A00',
    fontSize: 13,
    lineHeight: 19,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
    backgroundColor: '#FFFFFF',
  },
  textInput: {
    flex: 1,
    minHeight: PROMPT_INPUT_MIN_HEIGHT,
    maxHeight: PROMPT_INPUT_MAX_HEIGHT,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontSize: 15,
    lineHeight: 20,
    borderWidth: 1,
    borderColor: '#D9E7E5',
  },
  sendButton: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 16,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stopButton: {
    backgroundColor: '#B42318',
  },
  sendButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});

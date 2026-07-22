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
  FlatList,
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
  buildChatRetrievalQuery,
  formatCitationsForPrompt,
  messageHasClinicalKeywords,
  retrieveClinicalChunksViaBm25,
} from '@/clinical-evidence/retrieval-helper';
import {
  buildMedSafetyContext,
  selectChatGeneration,
  formatAnswerWithFootnotes,
} from '@/clinical-evidence';
import { createReadyEmbedder } from '@/knowledge/embedder';
import type { McpToolSummary } from '@/knowledge/types';
import {
  PreSlmNlu,
  buildPatientNluContext,
  formatEntityHint,
} from '@/nlu';
import type { PreSlmPacket } from '@/nlu/types';
import { TOOL_SCHEMAS } from '@/orchestration/mcp/tool-registry';
import { filterToolsForSkill } from '@/orchestration/skills';
import { MainTabHeader } from '@/components/MainTabHeader';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import {
  ThinkingIndicator,
  shouldOfferTellMeMore,
  truncateForQuickAnswer,
} from '@/components/concierge/ThinkingIndicator';
import { AppTheme, MaxContentWidth } from '@/constants/theme';
import { CONCIERGE_GENERATION_DEEP, CONCIERGE_GENERATION_FAST } from '@/constants/concierge';
import { usePatientRecord } from '@/contexts/patient-record-context';
import { useSettings } from '@/contexts/settings-context';
import { CHAT_UNLOAD_GRACE_MS, useSLM } from '@/contexts/slm-context';
import { useOrchestratorSafe, useOrchestratorRetriever, useOrchestratorPatientId } from '@/contexts/orchestrator-context';
import { useTheme } from '@/hooks/use-theme';
import type { ChatMessage as ProviderChatMessage } from '@/inference/inference-provider';
import {
  buildCaregiverAssistantContextFromSnapshot,
  buildCaregiverSystemContext,
  type CaregiverAssistantContext,
} from '@/services/slm/slmService';
import { detectIdentityMismatches } from '@/services/slm/identity-guardrails';
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
import type { UC2DecisionResult } from '@/ml-models/uc2-decision-layer';
import { stripControlTokens } from '@/utils/stripControlTokens';
import type { Medication, PatientCondition } from '@/data/types';
import { ObservationPicker } from '@/components/ObservationPicker';
import {
  InChatScheduleAppointmentCard,
  type InChatScheduleResult,
} from '@/components/concierge/InChatScheduleAppointmentCard';
import { ConciergeSuggestionBox } from '@/components/concierge/ConciergeSuggestionBox';
import { CarePlanInsightSheet } from '@/components/careConcierge/CarePlanInsightSheet';
import { getIntentDefinition } from '@/services/carePlan/intentRouter';
import type { AdcpProposalIntentId } from '@/data/adcp/types';
import type { CareIntentDefinition } from '@/services/carePlan/intentCatalog';

/** Cap Pre-SLM NLU so empty-cache / live network never blocks Concierge. */
const NLU_TIMEOUT_MS = 2500;

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

function needsChatCaregiverReview(ml: {
  emergencyResult?: { emergency?: boolean };
  isAnomaly?: boolean;
  promptShown?: boolean;
  finalDecision?: { final_severity?: number };
  post_hitl_severity?: number;
} | null): boolean {
  if (!ml) return false;
  const severity =
    ml.finalDecision?.final_severity ?? ml.post_hitl_severity ?? 0;
  if (ml.emergencyResult?.emergency || severity === 3) return false;
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
  /** User message that triggered this assistant turn (for turn-2 grounding). */
  sourceUserText?: string;
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
        sourceUserText?: string;
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
      const { finalText, reasoningContent, pendingHealthMonitor, sourceUserText } = action.payload;
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
        'I ran out of room before finishing that thought. Tap "Ask" again or try a shorter question.';

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
                sourceUserText: sourceUserText ?? m.sourceUserText,
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
  const theme = useTheme();
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
  const [activeSuggestionIntent, setActiveSuggestionIntent] =
    useState<CareIntentDefinition<any, any> | null>(null);
  const allowDevelopmentNluFallback =
    __DEV__ && isDeveloper && settings.nluDevelopmentFallback === true;
  const canUseLocalAppointmentDemo = __DEV__ && isDeveloper;

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

  useFocusEffect(
    useCallback(() => {
      chatFocusedRef.current = true;
      const acquireGen = ++chatAcquireGenRef.current;

      // Re-focused: cancel pending grace unload and keep existing lease.
      if (chatGraceTimerRef.current) {
        clearTimeout(chatGraceTimerRef.current);
        chatGraceTimerRef.current = null;
      }
      cancelChatUnloadGrace();

      void (async () => {
        if (chatLeaseRef.current) return;
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
    }, [acquireSlm, cancelChatUnloadGrace, scheduleChatLeaseRelease]),
  );

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

  const handleAskAssistant = useCallback(async (overrideText?: string) => {
    const trimmed = (typeof overrideText === 'string' ? overrideText : inputText).trim();
    if (!trimmed || state.runStatus === 'streaming') return;
    const contextForRequest: CaregiverAssistantContext = caregiverContext ?? {};

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

    // No production fallback: normal caregiver chat must not synthesize a
    // Concierge answer when the native model is unavailable.
    if (slm.loadStatus !== 'ready') {
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

    // Pre-SLM NLU pipeline (planning/35): entity linking + intent classification
    // + budgeted retrieval. Hard timeout so chat never hangs on network/NLU.
    const conditionNames = snapshot
      ? [
          ...new Set(
            [
              snapshot.primaryCondition?.name,
              ...snapshot.comorbidities.map((c: PatientCondition) => c.name),
              ...snapshot.conditions
                .filter((c: PatientCondition) => !c.needsReview)
                .map((c: PatientCondition) => c.name),
            ].filter((name): name is string => Boolean(name?.trim())),
          ),
        ]
      : [];
    const medNames = medicationNames;

    let userContent = trimmed;
    let nluPacket: PreSlmPacket | null = null;
    let nluSkillId: string | undefined;

    console.log('[SLM Chat] NLU start');
    try {
      const patientCtx = buildPatientNluContext(snapshot);
      patientCtx.medications = [
        ...new Set([...patientCtx.medications, ...medNames].filter(Boolean)),
      ];

      const embedder = await createReadyEmbedder(400, {
        allowDevelopmentFallback: allowDevelopmentNluFallback,
      });
      const nlu = new PreSlmNlu({
        embedder,
        retriever: retriever ?? {
          retrieve: async () => ({ tools: [], chunks: [], citations: [], latencyMs: 0 }),
        },
        toolSchemas: TOOL_SCHEMAS as unknown as McpToolSummary[],
        allowDevelopmentFallback: allowDevelopmentNluFallback,
        filterToolsForSkill: (id, tools) =>
          filterToolsForSkill(id, tools as typeof TOOL_SCHEMAS) as McpToolSummary[],
      });

      nluPacket = await Promise.race([
        nlu.run(trimmed, patientCtx),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`NLU timeout after ${NLU_TIMEOUT_MS}ms`)), NLU_TIMEOUT_MS),
        ),
      ]);
      nluSkillId = nluPacket.intent.skillId;
      console.log(
        `[SLM Chat] NLU: intent=${nluPacket.intent.primary} conf=${nluPacket.intent.confidence.toFixed(2)} ` +
          `entities=${nluPacket.entities.length} tools=${nluPacket.tools.length} ` +
          `chunks=${nluPacket.chunks.length} backend=${nluPacket.trace.backend} ` +
          `latency=${nluPacket.trace.latencyMs}ms`,
      );
    } catch (nluErr) {
      console.warn('[SLM Chat] NLU unavailable or timed out; continuing without NLU:', nluErr);
    }

    // Generation routing from NLU intent + confidence (planning/37 §6.3-6.4).
    const generationDecision = selectChatGeneration({
      intent: nluPacket?.intent ?? null,
      message: trimmed,
      conditions: conditionNames,
      meds: medNames,
      citedChunkCount: nluPacket?.chunks.length ?? 0,
      forceDeep: false,
    });
    console.log(
      `[SLM Chat] generation=${generationDecision.profile === CONCIERGE_GENERATION_FAST ? 'FAST' : 'DEEP'} ` +
        `reason=${generationDecision.reason} ` +
        `intent=${nluPacket?.intent?.primary ?? 'none'} ` +
        `conf=${nluPacket?.intent?.confidence?.toFixed(2) ?? 'n/a'}`,
    );

    // Skill fragment from NLU; toolsOverride injects only budgeted packet tools (planning/35).
    let systemContext = buildCaregiverSystemContext(contextForRequest, {
      skillId: nluSkillId,
      toolsOverride: nluPacket ? nluPacket.tools : undefined,
    });

    // Identity guardrails: wrong patient / wrong caregiver self-reference
    const identityGuard = detectIdentityMismatches(trimmed, {
      patientName: snapshot?.patient?.name ?? contextForRequest.patientName,
      patientPreferredName:
        snapshot?.patient?.preferredName ?? contextForRequest.patientName,
      caregiverName:
        snapshot?.caregiver?.name ?? contextForRequest.caregiverName,
    });
    if (identityGuard.hasMismatch) {
      console.warn(
        '[SLM Chat] Identity mismatch:',
        identityGuard.findings.map((f) => f.reason).join(' | '),
      );
      systemContext = `${systemContext}\n\n${identityGuard.systemPromptBlock}`;
    }

    // On-demand RxNorm DDI when this turn is med-related (chat, not Meds-tab-only).
    const mentionedMeds = (nluPacket?.entities ?? [])
      .filter((e) => e.type === 'medication')
      .map((e) => e.label);
    let medSafetyChunks: {
      docId: string;
      source: string;
      text: string;
    }[] = [];
    try {
      const medSafety = await Promise.race([
        buildMedSafetyContext({
          medicationNames: [...new Set([...mentionedMeds, ...medNames])],
          intent: nluPacket?.intent.primary ?? null,
          hasMedicationEntities: mentionedMeds.length > 0,
          message: trimmed,
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 4_000)),
      ]);
      if (medSafety?.chunks.length) {
        medSafetyChunks = medSafety.chunks.map((c) => ({
          docId: c.docId,
          source: String(c.source),
          text: c.text,
        }));
        console.log(
          `[SLM Chat] Med safety DDI: ${medSafety.chunks.length} chunks (${medSafety.reason})`,
        );
      }
    } catch (medErr) {
      console.warn('[SLM Chat] Med safety context skipped:', medErr);
    }

    // Use NLU chunks if available, otherwise fall back to keyword-based retrieval
    if (nluPacket && nluPacket.chunks.length > 0) {
      const entityHint = formatEntityHint(nluPacket.entities);
      const maxChunkChars = nluPacket.budget.maxChunkChars;
      const citationBlock = formatCitationsForPrompt(
        [
          ...nluPacket.chunks.map((c) => ({
            docId: c.docId,
            source: String(c.source),
            text: c.text,
            patientId: c.patientId,
            sourceId: c.sourceId,
            sourceType: c.sourceType,
            resourceId: c.resourceId,
            effectiveAt: c.effectiveAt,
            createdAt: c.createdAt,
            synthetic: c.synthetic,
            retrievalMethod: c.retrievalMethod,
            graphRelation: c.graphRelation,
            graphSeedId: c.graphSeedId,
          })),
          ...medSafetyChunks,
        ],
        maxChunkChars,
      );
      if (citationBlock) {
        const hintLine = entityHint ? `\n${entityHint}` : '';
        console.log(`[SLM Chat] NLU citation block added (${citationBlock.length} chars)`);
        userContent = `${trimmed}${hintLine}\n\n${citationBlock}\n\nGround your answer in the clinical knowledge above where relevant. After claims drawn from a chunk, append that chunk's exact tag (e.g. [PubMed #1], [Drug Label #2], [Care Plan #3]) — include the # number.`;
      }
    } else if (nluPacket && nluPacket.entities.length > 0) {
      const entityHint = formatEntityHint(nluPacket.entities);
      const ddiBlock = medSafetyChunks.length
        ? `\n\n${formatCitationsForPrompt(medSafetyChunks)}`
        : '';
      userContent = `${trimmed}\n${entityHint}${ddiBlock}`;
    } else {
      const hasClinicalIntent = messageHasClinicalKeywords(
        trimmed,
        conditionNames,
        medNames,
      );
      if (hasClinicalIntent) {
        const retrievalQuery = buildChatRetrievalQuery(
          trimmed,
          conditionNames,
          medNames,
        );
        const citations = await retrieveClinicalChunksViaBm25(
          retriever,
          retrievalQuery || [trimmed, ...conditionNames].join(' '),
          5,
          patientId,
        );
        console.log(
          `[SLM Chat] Clinical intent fallback. Query: "${retrievalQuery}". Chunks: ${citations.length}`,
        );
        const citationBlock = formatCitationsForPrompt([
          ...citations,
          ...medSafetyChunks,
        ]);
        if (citationBlock) {
          userContent = `${trimmed}\n\n${citationBlock}\n\nGround your answer in the clinical knowledge above where relevant. After claims drawn from a chunk, append that chunk's exact tag (e.g. [PubMed #1], [Drug Label #2], [Care Plan #3]) — include the # number.`;
        }
      } else if (medSafetyChunks.length > 0) {
        const citationBlock = formatCitationsForPrompt(medSafetyChunks);
        userContent = `${trimmed}\n\n${citationBlock}\n\nGround medication safety claims in the knowledge above where relevant.`;
      } else {
        console.log(
          `[SLM Chat] No clinical intent. Conditions: [${conditionNames.join(', ')}], Meds: [${medNames.join(', ')}]`,
        );
      }
    }

    // NLU done → Concierge (SLM) stage
    dispatch({ type: 'set-phase', payload: { assistantId: assistantMessage.id, phase: 1 } });
    console.log('[SLM Chat] SLM start');

    const messages: ProviderChatMessage[] = [
      { role: 'system', content: systemContext },
      ...state.messages.map((m) => ({ role: m.role, content: m.text })),
      { role: 'user', content: userContent },
    ];

    console.log('[SLM Chat] === USER MESSAGE ===');
    console.log(userContent);
    console.log('[SLM Chat] === END PROMPT ===');

    abortControllerRef.current = new AbortController();

    const reasoningStartedAt = { current: null as number | null };

    try {
      const result = await slm.chat(
        messages,
        (token) => {
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
        generationDecision.profile,
        (token) => {
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

      let finalText = result.text;
      let finalReasoning = result.reasoningContent;

      // Debug logging: show SLM output
      console.log('[SLM Chat] === SLM RESPONSE ===');
      console.log(finalText);
      if (finalReasoning) {
        console.log('[SLM Chat] === REASONING ===');
        console.log(finalReasoning);
      }
      console.log('[SLM Chat] === END RESPONSE ===');

      // Health Monitor: prefer NLU-extracted slots, else model ACTION / user NLP.
      const monitorArgs =
        nluPacket?.slots ??
        resolveHypotheticalVitalsCandidate(trimmed, result.text);
      finalText = stripEvaluateHypotheticalAction(finalText);

      // Footnote citations on finalize (planning/37 §6.4.4).
      const chunksForCite =
        nluPacket?.chunks.map((c) => ({
          docId: c.docId,
          source: String(c.source),
          text: c.text,
          patientId: c.patientId,
          sourceId: c.sourceId,
          sourceType: c.sourceType,
          resourceId: c.resourceId,
          effectiveAt: c.effectiveAt,
          createdAt: c.createdAt,
          synthetic: c.synthetic,
          retrievalMethod: c.retrievalMethod,
          graphRelation: c.graphRelation,
          graphSeedId: c.graphSeedId,
        })) ?? [];
      const withFootnotes = formatAnswerWithFootnotes(finalText, chunksForCite);
      finalText = withFootnotes.displayText;

      dispatch({
        type: 'send-success',
        payload: {
          assistantId: assistantMessage.id,
          finalText,
          reasoningContent: finalReasoning,
          pendingHealthMonitor: null,
          sourceUserText: trimmed,
        },
      });

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
    }
  }, [
    inputText,
    state.runStatus,
    state.messages,
    slm,
    caregiverContext,
    snapshot,
    medicationNames,
    retriever,
    orchestrator,
    patientId,
    allowDevelopmentNluFallback,
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
          CONCIERGE_GENERATION_DEEP,
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
          CONCIERGE_GENERATION_DEEP,
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
        },
      });
    },
    [caregiverContext, slm],
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
    [caregiverContext, inputText, slm, state.messages, state.runStatus],
  );

  const renderMessage: ListRenderItem<ChatMessage> = ({ item }) => {
    if (item.role === 'user') {
      return (
        <View style={styles.userBubbleWrapper}>
          <View style={[styles.userBubble, { backgroundColor: theme.backgroundElement }]}>
            <Text style={[styles.userBubbleText, { color: theme.text }]}>{item.text}</Text>
          </View>
        </View>
      );
    }

    const reasoningOpen = showReasoningFor.has(item.id);
    const isExpanded = expandedMessageIds.has(item.id);
    const reasoning = item.thinking;
    const showReasoningToggle = isDeveloper && Boolean(reasoning && reasoning.trim());
    const displayText = isExpanded || !item.finalText
      ? item.finalText ?? item.text
      : truncateForQuickAnswer(item.finalText ?? item.text);
    return (
      <View style={styles.assistantBubble}>
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
                    style={styles.tellMeMoreButton}
                    onPress={() => {
                      setExpandedMessageIds((prev) => new Set(prev).add(item.id));
                      void handleTellMeMore(item);
                    }}
                    disabled={state.runStatus === 'streaming'}
                  >
                    <Text style={styles.tellMeMoreText}>Tell me more</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <Text style={[styles.answerText, { color: theme.text }]}>{item.text}</Text>
            )}

            {item.pendingCaregiverReview && item.status === 'done' ? (
              <View style={styles.healthMonitorConfirmCard}>
                <Text style={styles.healthMonitorConfirmTitle}>
                  Caregiver review (severity {item.pendingCaregiverReview.severity})
                </Text>
                <Text style={styles.healthMonitorConfirmBody}>
                  {item.pendingCaregiverReview.summaryLine}. Select anything you
                  observed, then continue. Severity 3 emergencies skip this step.
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
                      Apply review & continue
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.healthMonitorButton, styles.healthMonitorButtonSecondary]}
                    onPress={() => void handleSkipCaregiverReview(item)}
                    disabled={state.runStatus === 'streaming'}
                  >
                    <Text style={styles.healthMonitorButtonSecondaryText}>
                      Skip review
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
              <View style={styles.healthMonitorConfirmCard}>
                <Text style={styles.healthMonitorConfirmBody}>
                  No active patient — open a profile, then ask again to schedule.
                </Text>
                <Pressable
                  style={[styles.healthMonitorButton, styles.healthMonitorButtonSecondary]}
                  onPress={() =>
                    void handleScheduleFollowUpComplete(item, { action: 'dismissed' })
                  }
                >
                  <Text style={styles.healthMonitorButtonSecondaryText}>Continue without scheduling</Text>
                </Pressable>
              </View>
            ) : null}

            {showReasoningToggle ? (
              <View style={styles.reasoningSection}>
                <Pressable onPress={() => toggleReasoning(item.id)}>
                  <Text style={[styles.reasoningToggle, { color: theme.textSecondary }]}>
                    {reasoningOpen ? '▾' : '▸'} Show reasoning
                  </Text>
                </Pressable>
                {reasoningOpen ? (
                  <View style={[styles.reasoningBox, { borderColor: theme.textSecondary + '40' }]}>
                    <Text style={[styles.reasoningText, { color: theme.textSecondary }]}>
                      {reasoning}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {item.status === 'error' ? (
              <Text style={styles.errorText}>Error: {item.finalText ?? 'Unknown error'}</Text>
            ) : null}
            {item.status === 'stopped' ? (
              <Text style={[styles.stoppedHint, { color: theme.textSecondary }]}>· stopped</Text>
            ) : null}
          </>
        )}
      </View>
    );
  };

  const patientRecordLoading = !ready;
  const isInputDisabled = slm.loadStatus !== 'ready' && slm.loadStatus !== 'idle';

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: AppTheme.colors.screen }]}
      edges={showBackButton ? ['top', 'bottom'] : ['top']}
    >
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
        {showBackButton ? (
          <View style={styles.headerRow}>
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <Text style={styles.backText}>← Back</Text>
            </Pressable>
          </View>
        ) : null}

        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          <MainTabHeader
            title="Concierge Support"
            eyebrow="Caregiver Concierge"
            subtitle="Ask practical questions using the caregiver profile and patient context."
            icon="assistant"
            rightContent={
              <Pressable
                onPress={handleNewConversation}
                style={styles.newConvButton}
                accessibilityRole="button"
                accessibilityLabel="New conversation"
              >
                <Text style={styles.newConvButtonText} numberOfLines={1}>New</Text>
              </Pressable>
            }
          />

          <View style={styles.contextCard}>
            <Pressable
              style={styles.collapsibleCardHeader}
              onPress={() => setCareContextExpanded((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: careContextExpanded }}
              accessibilityLabel={`Care Context${careContextExpanded ? ' — collapse' : ' — expand'}`}
            >
              <View style={styles.collapsibleCardHeaderText}>
                <Text style={styles.cardTitle}>Care Context</Text>
                {!careContextExpanded ? (
                  <Text style={styles.collapsibleCardSummary} numberOfLines={1}>
                    {snapshot?.patient
                      ? `${snapshot.patient.preferredName?.trim() || snapshot.patient.name} · tap to expand`
                      : 'Tap to expand patient and care details'}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.collapsibleChevron}>{careContextExpanded ? '▾' : '▸'}</Text>
            </Pressable>

            {careContextExpanded ? (
              <>
                {patientRecordLoading ? (
                  <Text style={styles.contextText}>Loading patient record...</Text>
                ) : patientRecordError ? (
                  <Text style={styles.errorText}>
                    Patient record unavailable: {patientRecordError.message}
                  </Text>
                ) : !snapshot?.patient ? (
                  <Text style={styles.contextText}>
                    No persisted patient record is available. Import or create a patient record before asking the Concierge.
                  </Text>
                ) : (
                  <>
                    <CollapsibleCareSection
                      id="patient"
                      title="Patient"
                      summary={`${snapshot.patient.preferredName?.trim() || snapshot.patient.name} · age ${caregiverContext?.patientAge ?? 'Not provided'}`}
                      expanded={expandedCareSections.has('patient')}
                      onToggle={toggleCareSection}
                    >
                      <Text style={styles.contextText}>
                        Conditions: {snapshot.conditions.map((condition: PatientCondition) => condition.name).filter(Boolean).join(', ') || 'No conditions provided'}
                      </Text>
                      <Text style={styles.contextText}>
                        Medications: {medicationNames.join(', ') || 'No medications provided'}
                      </Text>
                      <Text style={styles.contextText}>
                        Baseline routine: {snapshot.patient.baselineDailyRoutine ?? 'Not provided'}
                      </Text>
                      <Text style={styles.contextText}>
                        SpO2 cutoff: {snapshot.patient.spo2Cutoff ?? 'Not provided'} · Baseline HR: {snapshot.patient.baselineHeartRate ?? 'Not provided'}
                      </Text>
                    </CollapsibleCareSection>

                    <CollapsibleCareSection
                      id="caregiver"
                      title="Caregiver"
                      summary={
                        snapshot.caregiver
                          ? `${snapshot.caregiver.name} (${snapshot.caregiver.relationship ?? 'N/A'})`
                          : 'Not provided'
                      }
                      expanded={expandedCareSections.has('caregiver')}
                      onToggle={toggleCareSection}
                    >
                      {snapshot.caregiver ? (
                        <>
                          <Text style={styles.contextText}>
                            {snapshot.caregiver.name} ({snapshot.caregiver.relationship ?? 'relationship not provided'}) · {snapshot.caregiver.experience ?? 'experience not provided'} · {snapshot.caregiver.availability ?? 'availability not provided'}
                          </Text>
                          <Text style={styles.contextText}>
                            Language: {snapshot.caregiver.languagePreference ?? 'Not provided'} · Comfort: {snapshot.caregiver.medicalComfortLevel ?? 'Not provided'}
                          </Text>
                          <Text style={styles.contextText}>
                            Active concern: {snapshot.caregiver.mainConcern ?? 'Not provided'}
                          </Text>
                          <Text style={styles.contextText}>
                            Backup: {snapshot.caregiver.backupCaregiver ?? 'Not provided'}
                          </Text>
                        </>
                      ) : (
                        <Text style={styles.contextText}>No caregiver information was provided.</Text>
                      )}
                    </CollapsibleCareSection>

                    <CollapsibleCareSection
                      id="care-team"
                      title="Care Team"
                      summary={`PCP: ${caregiverContext?.primaryCareProviderName ?? 'Not provided'}`}
                      expanded={expandedCareSections.has('care-team')}
                      onToggle={toggleCareSection}
                    >
                      <Text style={styles.contextText}>
                        PCP: {caregiverContext?.primaryCareProviderName ?? 'Not provided'}
                        {caregiverContext?.primaryCareProviderPhone ? ` · ${caregiverContext.primaryCareProviderPhone}` : ''}
                      </Text>
                      {caregiverContext?.primaryCareProviderEmail ? (
                        <Text style={styles.contextText}>
                          Email: {caregiverContext.primaryCareProviderEmail}
                        </Text>
                      ) : null}
                    </CollapsibleCareSection>

                    <CollapsibleCareSection
                      id="safety"
                      title="Safety"
                      summary={`Emergency: ${caregiverContext?.emergencyContact ?? 'Not provided'}`}
                      expanded={expandedCareSections.has('safety')}
                      onToggle={toggleCareSection}
                    >
                      <Text style={styles.contextText}>
                        Emergency contact: {caregiverContext?.emergencyContact ?? 'Not provided'}
                      </Text>
                      <Text style={styles.contextText}>
                        Safety notes: {caregiverContext?.safetyNotes ?? 'Not provided'}
                      </Text>
                    </CollapsibleCareSection>

                    <CollapsibleCareSection
                      id="clinical"
                      title="Clinical"
                      summary={`${dedupedSymptoms.length} symptom${dedupedSymptoms.length === 1 ? '' : 's'} · ${snapshot.thresholds.length} active threshold${snapshot.thresholds.length === 1 ? '' : 's'}`}
                      expanded={expandedCareSections.has('clinical')}
                      onToggle={toggleCareSection}
                    >
                      <Text style={styles.contextText}>
                        Symptoms: {dedupedSymptoms.join(', ') || 'No symptoms provided'}
                      </Text>
                      <Text style={styles.contextText}>
                        Active thresholds: {snapshot.thresholds.length}
                      </Text>
                    </CollapsibleCareSection>
                  </>
                )}
                <Pressable
                  style={styles.editProfilesButton}
                  onPress={() => router.push('/profile' as never)}
                  accessibilityRole="button"
                  accessibilityLabel="Open edit profiles"
                >
                  <Text style={styles.editProfilesButtonText}>Edit profiles</Text>
                </Pressable>
                <Text style={styles.tagline}>The Concierge suggests. You decide.</Text>
              </>
            ) : null}
          </View>

          {state.messages.length === 0 ? (
            <>
              <ConciergeSuggestionBox
                onSendPrompt={(prompt) => void handleAskAssistant(prompt)}
                onLaunchIntent={(intentId: AdcpProposalIntentId) =>
                  setActiveSuggestionIntent(getIntentDefinition(intentId))
                }
                disabled={state.runStatus === 'streaming'}
              />
              <View style={styles.howToCard}>
                <Pressable
                  style={styles.collapsibleCardHeader}
                  onPress={() => setHowMonitorExpanded((v) => !v)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: howMonitorExpanded }}
                  accessibilityLabel={`How Health Monitor works${howMonitorExpanded ? ' — collapse' : ' — expand'}`}
                >
                  <Text style={styles.howToTitle}>How Health Monitor works in chat</Text>
                  <Text style={styles.collapsibleChevron}>{howMonitorExpanded ? '▾' : '▸'}</Text>
                </Pressable>
                {howMonitorExpanded ? (
                  <>
                    <Text style={styles.howToBody}>
                      1. Ask a vitals or what-if question (e.g. “What if SpO2 is 86% and heart rate is 118?”).
                    </Text>
                    <Text style={styles.howToBody}>
                      2. When vitals are detected, you’ll see “activating Health Monitor” and it runs right away.
                    </Text>
                    <Text style={styles.howToBody}>
                      3. Severity 1-2 may ask for observations. In developer mode, it may also offer a local demo follow-up appointment.
                    </Text>
                    <Text style={styles.howToBody}>
                      4. After you finish, Concierge explains with that context. Severity 3 skips review/scheduling and may show a critical banner — never auto-calls 911.
                    </Text>
                    <Text style={styles.howToFootnote}>
                      SpO2 is percent (86, not 0.86). Pure med/schedule questions skip Health Monitor.
                    </Text>
                  </>
                ) : null}
              </View>
            </>
          ) : (
            <View style={styles.card}>
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

          <View style={styles.safetyCard}>
            <Text style={styles.safetyNote}>
              Concierge is a caregiver support prototype and does not replace emergency care
              or professional medical advice.
            </Text>
          </View>
        </ScrollView>

        <View style={[styles.inputRow, { borderTopColor: theme.textSecondary + '30' }]}>
          <TextInput
            value={inputText}
            onChangeText={handleInputChange}
            placeholder="Ask the Concierge..."
            placeholderTextColor="#8A9A9A"
            multiline
            maxLength={4000}
            editable={!isInputDisabled}
            style={[
              styles.textInput,
              {
                color: theme.text,
                backgroundColor: theme.backgroundElement,
                height: inputHeight,
              },
            ]}
            textAlignVertical="top"
            scrollEnabled={inputHeight >= PROMPT_INPUT_MAX_HEIGHT - 1}
          />
          {state.runStatus === 'streaming' ? (
            <Pressable onPress={handleStop} style={[styles.sendButton, styles.stopButton]}>
              <Text style={styles.sendButtonText}>Stop</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => void handleAskAssistant()}
              disabled={!inputText.trim() || isInputDisabled}
              style={[
                styles.sendButton,
                {
                  backgroundColor:
                    inputText.trim() && !isInputDisabled ? '#0E6F68' : theme.backgroundElement,
                },
              ]}>
              <Text
                style={{
                  color: inputText.trim() && !isInputDisabled ? '#FFFFFF' : theme.textSecondary,
                  fontWeight: '600',
                }}>
                Ask
              </Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>

      <CarePlanInsightSheet
        visible={activeSuggestionIntent !== null}
        intent={activeSuggestionIntent}
        snapshot={snapshot}
        onClose={() => setActiveSuggestionIntent(null)}
        onProposalResolved={() => setActiveSuggestionIntent(null)}
      />
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
  return (
    <View style={styles.careSectionWrap}>
      <Pressable
        style={styles.careSectionHeader}
        onPress={() => onToggle(id)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${title}${expanded ? ' — collapse' : ' — expand'}`}
      >
        <Text style={styles.contextSection}>{title}</Text>
        <Text style={styles.careSectionChevron}>{expanded ? '▾' : '▸'}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.careSectionBody}>{children}</View>
      ) : (
        <Text style={styles.careSectionSummary} numberOfLines={2}>{summary}</Text>
      )}
    </View>
  );
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

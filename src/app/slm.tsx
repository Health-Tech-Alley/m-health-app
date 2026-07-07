/**
 * Caregiver SLM chat screen.
 *
 * Combines the PatientRecordSnapshot-backed care context with Ethan's streaming
 * playground UX (model selector, memory bar, markdown rendering,
 * control-token stripping, stop/new-conversation).
 */

import { router } from 'expo-router';
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
  formatCitationsForPrompt,
  messageHasClinicalKeywords,
  retrieveClinicalChunksViaBm25,
} from '@/clinical-evidence/retrieval-helper';
import { MainTabHeader } from '@/components/MainTabHeader';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import {
  ThinkingIndicator,
  shouldOfferTellMeMore,
  truncateForQuickAnswer,
} from '@/components/concierge/ThinkingIndicator';
import { AppTheme, MaxContentWidth } from '@/constants/theme';
import { CONCIERGE_GENERATION_DEEP, REASONING_FORMAT_EXPLAIN } from '@/constants/concierge';
import { usePatientRecord } from '@/contexts/patient-record-context';
import { useSettings } from '@/contexts/settings-context';
import { useSLM } from '@/contexts/slm-context';
import { useOrchestratorSafe, useOrchestratorRetriever, useOrchestratorPatientId } from '@/contexts/orchestrator-context';
import { useTheme } from '@/hooks/use-theme';
import type { ChatMessage as ProviderChatMessage } from '@/inference/inference-provider';
import { MODEL_CATALOG } from '@/inference/model-catalog';
import { isNativeMemoryAvailable, useMemoryInfo } from '@/services/device-memory';
import { isModelInstalled } from '@/services/model-storage';
import {
  askCaregiverAssistantMock,
  buildCaregiverAssistantContextFromSnapshot,
  buildCaregiverSystemContext,
  CAREGIVER_SLM_MODEL_ID,
  downloadCaregiverSLMModel,
  isCaregiverSLMModelInstalled,
  type CaregiverAssistantContext,
} from '@/services/slm/slmService';
import { stripControlTokens } from '@/utils/stripControlTokens';
import type { Medication, PatientCondition } from '@/data/types';

type MessageStatus = 'streaming' | 'done' | 'stopped' | 'error';

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
      };
    }
  | { type: 'send-stopped'; payload: { assistantId: string } }
  | { type: 'send-error'; payload: { assistantId: string; error: string } }
  | { type: 'append-token'; payload: { assistantId: string; token: string } }
  | { type: 'append-reasoning-token'; payload: { assistantId: string; token: string } }
  | { type: 'set-phase'; payload: { assistantId: string; phase: 0 | 1 | 2 | 3 } }
  | { type: 'mark-answer-started'; payload: { assistantId: string } }
  | { type: 'mark-tools-phase'; payload: { assistantId: string } }
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
      const { finalText, reasoningContent } = action.payload;
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
  const { isDeveloper } = useSettings();
  const { snapshot, ready, error: patientRecordError } = usePatientRecord();
  const retriever = useOrchestratorRetriever();
  const orchestrator = useOrchestratorSafe();
  const patientId = useOrchestratorPatientId();
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [inputText, setInputText] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [inputHeight, setInputHeight] = useState(PROMPT_INPUT_MIN_HEIGHT);
  const [showReasoningFor, setShowReasoningFor] = useState<Set<string>>(new Set());
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(new Set());
  const [expandedCareSections, setExpandedCareSections] = useState<Set<string>>(new Set());

  const handleInputChange = useCallback((text: string) => {
    setInputText(text);
    setInputHeight(getPromptInputHeight(text));
  }, []);
  const abortControllerRef = useRef<AbortController | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const memoryInfo = useMemoryInfo(2000);
  const hasNativeMemory = isNativeMemoryAvailable();

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

  const installedModels = useMemo(
    () => MODEL_CATALOG.filter(isModelInstalled),
    [],
  );

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    flatListRef.current?.scrollToEnd({ animated: true });
  }, [state.messages]);

  const handleLoadNativeModel = useCallback(
    async (modelId: string) => {
      try {
        setIsDownloading(true);
        setDownloadProgress(null);

        if (modelId === CAREGIVER_SLM_MODEL_ID && !isCaregiverSLMModelInstalled()) {
          await downloadCaregiverSLMModel({ onProgress: setDownloadProgress });
        }

        await slm.loadModel(modelId);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to download or load the Concierge model.';
        dispatch({
          type: 'send-error',
          payload: { assistantId: generateId(), error: message },
        });
      } finally {
        setIsDownloading(false);
      }
    },
    [slm],
  );

  const handleAskAssistant = useCallback(async () => {
    const trimmed = inputText.trim();
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

    // Mock fallback when no model is loaded.
    if (slm.loadStatus !== 'ready') {
      try {
        const response = await askCaregiverAssistantMock(trimmed, contextForRequest);
        dispatch({
          type: 'send-success',
          payload: {
            assistantId: assistantMessage.id,
            finalText: response.answer,
            reasoningContent: response.reasoningContent,
          },
        });
      } catch (error) {
        dispatch({
          type: 'send-error',
          payload: {
            assistantId: assistantMessage.id,
            error:
              error instanceof Error
                ? error.message
                : 'Something went wrong while asking the Concierge.',
          },
        });
      }
      return;
    }

    const systemContext = buildCaregiverSystemContext(contextForRequest);

    // Opt-in clinical knowledge retrieval: only when the user's message
    // contains a condition or medication keyword. Avoids latency on
    // non-clinical questions.
    const conditionNames = snapshot
      ? [
          snapshot.primaryCondition?.name,
          ...snapshot.comorbidities.map((condition: PatientCondition) => condition.name),
        ].filter((name): name is string => Boolean(name))
      : [];
    const medNames = medicationNames;

    let userContent = trimmed;
    const hasKeywords = messageHasClinicalKeywords(trimmed, conditionNames, medNames);
    if (hasKeywords) {
      const citations = await retrieveClinicalChunksViaBm25(
        retriever,
        [trimmed, ...conditionNames, ...medNames].join(' '),
        5,
      );
      console.log(`[SLM Chat] Keyword match detected. Retrieved ${citations.length} clinical chunks.`);
      const citationBlock = formatCitationsForPrompt(citations);
      if (citationBlock) {
        console.log(`[SLM Chat] Citation block added (${citationBlock.length} chars)`);
        userContent = `${trimmed}\n\n${citationBlock}\n\nGround your answer in the clinical knowledge above where relevant. Add the source label in brackets after relevant statements (e.g., "Common side effects include nausea [Drug Label]" or "Studies show improved outcomes [PubMed]").`;
      }
    } else {
      console.log(`[SLM Chat] No clinical keywords detected. Conditions: [${conditionNames.join(', ')}], Meds: [${medNames.join(', ')}]`);
    }

    const messages: ProviderChatMessage[] = [
      { role: 'system', content: systemContext },
      ...state.messages.map((m) => ({ role: m.role, content: m.text })),
      { role: 'user', content: userContent },
    ];

    // Debug logging: show user message and SLM output
    console.log('[SLM Chat] === USER MESSAGE ===');
    console.log(userContent);
    console.log('[SLM Chat] === END PROMPT ===');

    abortControllerRef.current = new AbortController();

    // §7: drive the phase-word indicator from real reasoning tokens.
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
        // Single mode: always deep. The model reasons fully in its dedicated
        // channel (unlimited budget), then streams the complete answer. The
        // fast path was removed — it reliably got cut off mid-thought.
        CONCIERGE_GENERATION_DEEP,
        (token) => {
          // First reasoning token → phase 1 (Verifying).
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

      const actionMatch = result.text.match(/ACTION:\s*evaluate_hypothetical_vitals\(([\s\S]*?)\)/);
      if (actionMatch && orchestrator) {
        dispatch({ type: 'mark-tools-phase', payload: { assistantId: assistantMessage.id } });
        try {
          const args = JSON.parse(actionMatch[1]);
          const { evalBlock } = await orchestrator.executeHypotheticalEval(
            { tool: 'evaluate_hypothetical_vitals', args, rationale: 'chat follow-up' },
            patientId ?? '',
          );
          if (evalBlock) {
            const turn2Messages: ProviderChatMessage[] = [
              { role: 'system', content: `${systemContext}\n\n${evalBlock}` },
              ...state.messages.map((m) => ({ role: m.role, content: m.text })),
              { role: 'user', content: trimmed },
              { role: 'assistant', content: result.text.replace(/ACTION:.*\n?/g, '').trim() },
              { role: 'user', content: 'Now ground your answer in the ML hypothetical evaluation above.' },
            ];
            const turn2Abort = new AbortController();
            abortControllerRef.current = turn2Abort;
            dispatch({ type: 'set-phase', payload: { assistantId: assistantMessage.id, phase: 2 } });
            const turn2Result = await slm.chat(
              turn2Messages,
              (token) => {
                dispatch({ type: 'mark-answer-started', payload: { assistantId: assistantMessage.id } });
                dispatch({ type: 'append-token', payload: { assistantId: assistantMessage.id, token } });
              },
              turn2Abort.signal,
              CONCIERGE_GENERATION_DEEP,
            );
            finalText = turn2Result.text;
            finalReasoning = turn2Result.reasoningContent ?? finalReasoning;
          }
        } catch {
          // Hypothetical eval failed — fall through with the original answer.
        }
      }

      dispatch({
        type: 'send-success',
        payload: {
          assistantId: assistantMessage.id,
          finalText,
          reasoningContent: finalReasoning,
        },
      });
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
  }, [inputText, state.runStatus, state.messages, slm, caregiverContext, snapshot, medicationNames, retriever, orchestrator, patientId]);

  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

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
          // §6.6: "Tell me more" is always deep.
          { ...CONCIERGE_GENERATION_DEEP, reasoningFormat: REASONING_FORMAT_EXPLAIN },
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
    <SafeAreaView style={[styles.container, { backgroundColor: AppTheme.colors.screen }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
        <View style={[styles.headerRow, !showBackButton && styles.headerRowTab]}>
          {showBackButton ? (
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <Text style={styles.backText}>← Back</Text>
            </Pressable>
          ) : (
            <Text style={styles.headerTabTitle}>Concierge</Text>
          )}
          <Pressable onPress={handleNewConversation} style={styles.newConvButton}>
            <Text style={styles.newConvButtonText}>New conversation</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          <MainTabHeader
            title="Concierge Support"
            eyebrow="Caregiver Concierge"
            subtitle="Ask practical questions using the caregiver profile and patient context."
            icon="assistant"
          />

          <View style={styles.statusCard}>
            <Text style={styles.cardTitle}>Model Status</Text>
            <Text style={styles.statusText}>Status: {slm.loadStatus}</Text>
            {slm.currentModelId ? (
              <Text style={styles.statusText}>Model: {slm.currentModelId}</Text>
            ) : null}
            {slm.modelSizeGB ? (
              <Text style={styles.statusText}>Size: {slm.modelSizeGB.toFixed(2)} GB</Text>
            ) : null}
            {slm.loadError ? <Text style={styles.errorText}>{slm.loadError}</Text> : null}

            {installedModels.length === 0 ? (
              <Text style={styles.helperText}>
                No models installed. Use the Models screen to download a model first.
              </Text>
            ) : (
              <View style={styles.modelSelector}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {installedModels.map((entry) => (
                    <Pressable
                      key={entry.id}
                      onPress={() => handleLoadNativeModel(entry.id)}
                      disabled={isDownloading || state.runStatus === 'streaming'}
                      style={[
                        styles.modelButton,
                        slm.currentModelId === entry.id && styles.modelButtonSelected,
                        {
                          borderColor:
                            slm.currentModelId === entry.id ? '#0E6F68' : theme.textSecondary + '30',
                          backgroundColor:
                            slm.currentModelId === entry.id ? '#0E6F68' : '#FFFFFF',
                        },
                      ]}>
                      <Text
                        style={{
                          color: slm.currentModelId === entry.id ? '#FFFFFF' : theme.text,
                          fontWeight: slm.currentModelId === entry.id ? '600' : '400',
                        }}>
                        {entry.displayName}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>

                {slm.loadStatus === 'ready' ? (
                  <Pressable onPress={slm.unloadModel} style={styles.secondaryButton}>
                    <Text style={styles.secondaryButtonText}>Unload Concierge model</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => handleLoadNativeModel(CAREGIVER_SLM_MODEL_ID)}
                    style={[styles.secondaryButton, isDownloading && styles.disabledButton]}
                    disabled={isDownloading}>
                    <Text style={styles.secondaryButtonText}>
                      {isDownloading
                        ? `Downloading${downloadProgress !== null ? ` ${downloadProgress}%` : ''}`
                        : 'Download / load Concierge model'}
                    </Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>

          {(slm.loadStatus === 'ready' || slm.loadStatus === 'loading') && memoryInfo ? (
            <View style={[styles.memoryCard, { backgroundColor: theme.backgroundElement }]}>
              <View style={styles.memoryHeader}>
                <Text style={[styles.cardTitle, { marginBottom: 0 }]}>Device RAM</Text>
                <Text style={[styles.statusText, { marginBottom: 0 }]}>
                  {memoryInfo.usedMB.toFixed(0)} / {memoryInfo.totalMB.toFixed(0)} MB
                </Text>
              </View>
              <View style={styles.progressBarBg}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${Math.min((memoryInfo.usedMB / memoryInfo.totalMB) * 100, 100)}%`,
                      backgroundColor:
                        memoryInfo.usedMB / memoryInfo.totalMB > 0.8 ? '#B42318' : '#0E6F68',
                    },
                  ]}
                />
              </View>
              <View style={styles.memoryDetails}>
                <Text style={styles.statusText}>Free: {memoryInfo.freeMB.toFixed(0)} MB</Text>
                {slm.modelSizeGB !== null ? (
                  <Text style={styles.statusText}>Model: {slm.modelSizeGB.toFixed(2)} GB</Text>
                ) : null}
                {hasNativeMemory ? (
                  <Text style={styles.statusText}>App: {memoryInfo.appMB.toFixed(0)} MB</Text>
                ) : null}
              </View>
            </View>
          ) : null}

          <View style={styles.contextCard}>
            <Text style={styles.cardTitle}>Care Context</Text>
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
                  summary={`${snapshot.patient.name} · age ${caregiverContext?.patientAge ?? 'Not provided'}`}
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
            <Text style={styles.tagline}>The Concierge suggests. You decide.</Text>
          </View>

          {state.messages.length > 0 ? (
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
          ) : null}

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
              onPress={handleAskAssistant}
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
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#0E6F68',
  },
  newConvButtonText: {
    color: '#0E6F68',
    fontWeight: '700',
    fontSize: 13,
  },
  statusCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
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
  safetyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
  },
  memoryCard: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    gap: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#123433',
    marginBottom: 10,
  },
  statusText: {
    color: '#526866',
    marginBottom: 4,
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
  helperText: {
    marginTop: 10,
    color: '#6B7C7B',
    fontSize: 13,
    lineHeight: 19,
  },
  errorText: {
    color: '#B42318',
    marginTop: 8,
  },
  modelSelector: {
    marginTop: 10,
    gap: 12,
  },
  modelButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    marginRight: 10,
  },
  modelButtonSelected: {
    backgroundColor: '#0E6F68',
    borderColor: '#0E6F68',
  },
  secondaryButton: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#0E6F68',
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  disabledButton: {
    opacity: 0.6,
  },
  secondaryButtonText: {
    color: '#0E6F68',
    fontWeight: '800',
  },
  memoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressBarBg: {
    height: 6,
    backgroundColor: '#88888830',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  memoryDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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

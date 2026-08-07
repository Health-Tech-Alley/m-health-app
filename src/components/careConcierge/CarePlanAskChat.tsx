/**
 * CarePlanAskChat — in-card Concierge for "Ask about the plan" (Care tab).
 *
 * Matches therapy's InCardMiniChat pattern:
 *   - embedded multi-turn chat (not a bottom sheet)
 *   - observation "Your review" after the first reply
 *   - modal Confirm / Cancel for plan proposals (therapy completion style)
 *
 * Soft-NLU routes free text into a Care catalog intent when confident;
 * catalog chips open the same in-card thread.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { MarkdownRenderer } from '@/components/markdown-renderer';
import { ObservationPicker } from '@/components/ObservationPicker';
import { OptionalFeaturePrompt } from '@/components/optional-feature-prompt';
import { AppTheme } from '@/constants/theme';
import { useCriticalAlert } from '@/contexts/critical-alert-context';
import { usePatientRecord } from '@/contexts/patient-record-context';
import { useSettings } from '@/contexts/settings-context';
import { useSLM } from '@/contexts/slm-context';
import { useOptionalFeatureGate } from '@/hooks/useOptionalFeatureGate';
import type { AdcpProposalIntentId } from '@/data/adcp/types';
import type { NextStepActionId, PatientRecordSnapshot } from '@/data/types';
import { executeNextStep } from '@/orchestration/next-steps';
import { audit } from '@/services/audit/auditService';
import { MODEL_CATALOG, resolveActiveModelId } from '@/inference/model-catalog';
import { isModelInstalled } from '@/services/model-storage';
import type { SlmTaskLease } from '@/services/slm/slm-task-queue';
import { getConciergeGeneration } from '@/constants/concierge';
import { stripControlTokens } from '@/utils/stripControlTokens';
import {
  resolveCareText,
  type CareTextResolution,
} from '@/services/carePlan/coaching';
import { getIntentDefinition, runIntent } from '@/services/carePlan/intentRouter';
import type { AnyIntentOutput } from '@/services/carePlan/intentCatalog';
import {
  caregiverConfirmProposal,
  caregiverRejectProposal,
} from '@/services/carePlan/mlPlanProposalService';
import {
  retrievePlanChunks,
  formatCitationsForPrompt,
  buildRetrievalQuery,
  type RetrievedCitation,
} from '@/clinical-evidence/retrieval-helper';
import { formatAnswerWithCollapsedSources } from '@/clinical-evidence/citation-display';
import { CitationList, citationsToSources } from '@/components/common/CitationList';
import { runSlmCompletion } from '@/services/carePlan/careSlmAdapter';
import { buildCompactCarePlanSystemContext } from '@/services/carePlan/contextAssembler';

type ChatRole = 'user' | 'assistant';

type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  status: 'streaming' | 'done' | 'error';
  hidden?: boolean;
  /** Sources for assistant messages (for display) */
  sources?: { label: string; count?: number }[];
};

export type CarePlanAskLaunch = {
  intent: AdcpProposalIntentId;
  args?: Record<string, unknown>;
};

export interface CarePlanAskChatProps {
  snapshot: PatientRecordSnapshot | null;
  patientName?: string;
  writable?: boolean;
  disabled?: boolean;
  /** Imperative launch from catalog chips (CareAskRegion). */
  externalLaunch?: CarePlanAskLaunch | null;
  onExternalLaunchConsumed?: () => void;
  onProposalResolved?: () => void;
  onConciergeHandoff?: (text: string) => void;
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function CarePlanAskChat({
  snapshot,
  patientName,
  writable = true,
  disabled = false,
  externalLaunch = null,
  onExternalLaunchConsumed,
  onProposalResolved,
  onConciergeHandoff,
}: CarePlanAskChatProps) {
  const slm = useSLM();
  const {
    acquireSlm,
    provider,
    loadModel: slmLoadModel,
    unloadModel: slmUnloadModel,
    policy: slmPolicy,
    taskQueue,
    currentModelId,
  } = slm;
  const { settings } = useSettings();
  const optionalGate = useOptionalFeatureGate('both');
  const { refresh, patientId } = usePatientRecord();
  const { presentCaregiverReportedEmergency } = useCriticalAlert();
  // Effective default — a single installed model is always the default.
  const defaultModelId = resolveActiveModelId(settings.demoDefaultModelId, (id) =>
    MODEL_CATALOG.some((m) => m.id === id && isModelInstalled(m)),
  );

  const [composerText, setComposerText] = useState('');
  const [routingBusy, setRoutingBusy] = useState(false);
  const [resolution, setResolution] = useState<CareTextResolution | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [refuseMessage, setRefuseMessage] = useState<string | null>(null);
  /** S19: after emergency screen hit — wait for real vs not-now confirm. */
  const [emergencyPending, setEmergencyPending] = useState<{
    phrase?: string;
    rawText: string;
  } | null>(null);
  const [emergencyBusy, setEmergencyBusy] = useState(false);

  const [chatOpen, setChatOpen] = useState(false);
  const [chatTitle, setChatTitle] = useState('Ask about the plan');
  const [activeIntent, setActiveIntent] = useState<AdcpProposalIntentId | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [followUp, setFollowUp] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusLine, setStatusLine] = useState('Preparing…');
  const [observationCodes, setObservationCodes] = useState<string[]>([]);
  const [showHitl, setShowHitl] = useState(false);
  const [hitlResolved, setHitlResolved] = useState(false);
  const [proposalIds, setProposalIds] = useState<string[]>([]);
  const [proposalConfirmVisible, setProposalConfirmVisible] = useState(false);
  const [proposalBusy, setProposalBusy] = useState(false);
  const [proposalNote, setProposalNote] = useState<string | null>(null);

  const leaseRef = useRef<SlmTaskLease | null>(null);
  const loadedBySheetRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const cancelRef = useRef(false);
  const historyRef = useRef<{ role: 'system' | 'user' | 'assistant'; content: string }[]>([]);
  const scrollRef = useRef<ScrollView | null>(null);
  const sessionKeyRef = useRef(0);

  const placeholder = patientName
    ? `Ask about ${patientName}'s plan…`
    : "Ask about the care plan…";

  const releaseLease = useCallback(() => {
    const hadLease = leaseRef.current !== null;
    leaseRef.current?.release();
    leaseRef.current = null;
    if (
      loadedBySheetRef.current &&
      !hadLease &&
      slmPolicy === 'auto' &&
      taskQueue.activeLeaseCount === 0
    ) {
      void slmUnloadModel();
    }
    loadedBySheetRef.current = false;
  }, [slmPolicy, slmUnloadModel, taskQueue]);

  const ensureModelAndLease = useCallback(async (): Promise<SlmTaskLease | null> => {
    loadedBySheetRef.current = false;
    try {
      return await acquireSlm('care_concierge');
    } catch {
      /* fall through */
    }
    const installed = MODEL_CATALOG.filter(isModelInstalled);
    if (installed.length === 0) return null;
    const preferred = installed.find((m) => m.id === defaultModelId) ?? installed[0];
    try {
      await slmLoadModel(preferred.id);
    } catch {
      return null;
    }
    loadedBySheetRef.current = true;
    await new Promise((r) => setTimeout(r, 0));
    if (cancelRef.current) return null;
    try {
      return await acquireSlm('care_concierge');
    } catch {
      return null;
    }
  }, [acquireSlm, defaultModelId, slmLoadModel]);

  const resetChatState = useCallback(() => {
    cancelRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
    releaseLease();
    historyRef.current = [];
    setMessages([]);
    setFollowUp('');
    setBusy(false);
    setShowHitl(false);
    setHitlResolved(false);
    setObservationCodes([]);
    setProposalIds([]);
    setProposalConfirmVisible(false);
    setProposalNote(null);
    setStatusLine('Preparing…');
    setActiveIntent(null);
    setChatOpen(false);
  }, [releaseLease]);

  const runFollowUpTurn = useCallback(
    async (userText: string) => {
      const trimmed = userText.trim();
      if (!trimmed || cancelRef.current) return;

      const userMsg: ChatMessage = {
        id: makeId('u'),
        role: 'user',
        text: trimmed,
        status: 'done',
      };
      const assistantId = makeId('a');
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: 'assistant', text: '', status: 'streaming' },
      ]);
      setBusy(true);
      setStatusLine(currentModelId ? `Thinking · ${currentModelId}…` : 'Loading Concierge…');

      const lease = await ensureModelAndLease();
      if (cancelRef.current) {
        lease?.release();
        return;
      }
      leaseRef.current = lease;

      if (!provider.getModelInfo()) {
        const installed = MODEL_CATALOG.filter(isModelInstalled);
        const err =
          installed.length === 0
            ? 'Concierge is unavailable — no model is installed.'
            : 'Concierge could not load a model.';
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, text: err, status: 'error' } : m)),
        );
        setStatusLine(`Error: ${err}`);
        setBusy(false);
        return;
      }

      // Plan chat: compact ADCP+meds system, no NLU/tools (protects n_ctx).
      const systemContext = buildCompactCarePlanSystemContext(
        snapshot,
        activeIntent ?? 'weekly_care_plan_review',
      );
      if (cancelRef.current) {
        lease?.release();
        return;
      }

      const priorTurns = historyRef.current.filter((m) => m.role !== 'system');
      historyRef.current = [
        { role: 'system', content: systemContext },
        ...priorTurns,
        { role: 'user', content: trimmed },
      ];

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        setStatusLine(currentModelId ? `Generating · ${currentModelId}…` : 'Generating…');
        const result = await provider.chat(
          historyRef.current,
          (token) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, text: m.text + token } : m,
              ),
            );
          },
          controller.signal,
          getConciergeGeneration(defaultModelId, 'deep'),
        );
        if (cancelRef.current) return;
        const cleaned = stripControlTokens(result.text).answer;
        historyRef.current.push({ role: 'assistant', content: cleaned });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, text: cleaned, status: 'done' } : m,
          ),
        );
        setStatusLine(currentModelId ? `Complete · ${currentModelId}` : 'Complete');
      } catch (err) {
        if (cancelRef.current || controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, text: message, status: 'error' } : m,
          ),
        );
        setStatusLine(`Error: ${message}`);
      } finally {
        abortRef.current = null;
        setBusy(false);
        leaseRef.current?.release();
        leaseRef.current = null;
      }
    },
    [
      activeIntent,
      currentModelId,
      defaultModelId,
      ensureModelAndLease,
      provider,
      snapshot,
    ],
  );

  const runIntentSeed = useCallback(
    async (intentId: AdcpProposalIntentId, args: Record<string, unknown> = {}) => {
      if (!snapshot) {
        setRouteError('No patient record loaded yet.');
        return;
      }
      const def = getIntentDefinition(intentId);
      const session = ++sessionKeyRef.current;
      cancelRef.current = false;
      setChatOpen(true);
      setChatTitle(def.caregiverLabel);
      setActiveIntent(intentId);
      setMessages([]);
      setShowHitl(false);
      setHitlResolved(false);
      setObservationCodes([]);
      setProposalIds([]);
      setProposalNote(null);
      setFollowUp('');
      historyRef.current = [];

      const assistantId = makeId('a');
      setMessages([
        {
          id: makeId('u'),
          role: 'user',
          text: def.caregiverLabel,
          status: 'done',
          hidden: true,
        },
        { id: assistantId, role: 'assistant', text: '', status: 'streaming' },
      ]);
      setBusy(true);
      setStatusLine(currentModelId ? `Thinking · ${currentModelId}…` : 'Loading Concierge…');

      const lease = await ensureModelAndLease();
      if (cancelRef.current || session !== sessionKeyRef.current) {
        lease?.release();
        return;
      }
      leaseRef.current = lease;

      if (!provider.getModelInfo()) {
        const installed = MODEL_CATALOG.filter(isModelInstalled);
        const err =
          installed.length === 0
            ? 'Concierge is unavailable — no model is installed.'
            : 'Concierge could not load a model.';
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, text: err, status: 'error' } : m)),
        );
        setStatusLine(`Error: ${err}`);
        setBusy(false);
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      let answerAcc = '';

      try {
        setStatusLine(currentModelId ? `Generating · ${currentModelId}…` : 'Generating…');
        const conditionName = snapshot.primaryCondition?.name;
        const retrievalQuery = buildRetrievalQuery(conditionName, def.caregiverLabel);
        const pid = snapshot.patient?.patientId ?? '';
        // Compact plan RAG only — intent system already has ADCP + meds + UC4.
        const mergedCitations: RetrievedCitation[] = (
          pid ? retrievePlanChunks(pid, retrievalQuery, 2) : []
        ).map((c) => ({
          ...c,
          text: c.text.length > 280 ? `${c.text.slice(0, 280)}…` : c.text,
        }));
        const citationBlock = formatCitationsForPrompt(mergedCitations, 600);

        const routerResult = await runIntent<AnyIntentOutput>({
          snapshot,
          intent: intentId,
          args,
          completePrompt: async (params) => {
            // Do not stack full caregiver+NLU system on top of ADCP context.
            const systemContext = params.systemContext;
            const userPrompt = citationBlock
              ? `${params.userPrompt}\n\n${citationBlock}`
              : params.userPrompt;
            // History keeps clean user text so follow-ups stay inside n_ctx.
            historyRef.current = [
              { role: 'system', content: systemContext },
              { role: 'user', content: params.userPrompt },
            ];
            const text = await runSlmCompletion({
              provider,
              systemContext,
              userPrompt,
              signal: controller.signal,
              onToken: (token) => {
                if (cancelRef.current) return;
                answerAcc += token;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, text: answerAcc } : m,
                  ),
                );
              },
            });
            return text;
          },
        });

        if (cancelRef.current || session !== sessionKeyRef.current) return;

        const outputAny = routerResult.output as { explanation?: string; rationale?: string };
        const raw =
          outputAny?.explanation?.trim() ||
          outputAny?.rationale?.trim() ||
          answerAcc ||
          '';
        const cleaned = stripControlTokens(raw).answer;
        const collapsed = formatAnswerWithCollapsedSources(cleaned, mergedCitations);
        const display = collapsed.displayText || cleaned || 'No response.';
        const sources = citationsToSources(mergedCitations);
        historyRef.current.push({ role: 'assistant', content: display });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, text: display, status: 'done', sources } : m,
          ),
        );
        setStatusLine(currentModelId ? `Complete · ${currentModelId}` : 'Complete');

        if (routerResult.blocked) {
          setProposalNote(routerResult.blockMessage ?? 'Care plan is view-only.');
        } else if (routerResult.enqueuedProposalIds.length > 0) {
          setProposalIds(routerResult.enqueuedProposalIds);
          setProposalConfirmVisible(true);
        } else {
          setProposalNote('No plan change suggested — explanation only.');
        }

        if (!hitlResolved) setShowHitl(true);
      } catch (err) {
        if (cancelRef.current || controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, text: message, status: 'error' } : m,
          ),
        );
        setStatusLine(`Error: ${message}`);
      } finally {
        abortRef.current = null;
        setBusy(false);
        leaseRef.current?.release();
        leaseRef.current = null;
      }
    },
    [
      currentModelId,
      ensureModelAndLease,
      hitlResolved,
      provider,
      snapshot,
    ],
  );

  const openFreeTextChat = useCallback(
    async (text: string) => {
      cancelRef.current = false;
      setChatOpen(true);
      setChatTitle('Ask about the plan');
      setActiveIntent(null);
      setMessages([]);
      setShowHitl(false);
      setHitlResolved(false);
      setObservationCodes([]);
      setProposalIds([]);
      setProposalNote(null);
      historyRef.current = [];
      await runFollowUpTurn(text);
      if (!hitlResolved) setShowHitl(true);
    },
    [hitlResolved, runFollowUpTurn],
  );

  const launchIntent = useCallback(
    (intentId: AdcpProposalIntentId, args?: Record<string, unknown>) => {
      setComposerText('');
      setResolution(null);
      setRouteError(null);
      setRefuseMessage(null);
      void runIntentSeed(intentId, args ?? {});
    },
    [runIntentSeed],
  );

  // Catalog / parent external launch — defer setState out of the effect body
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!externalLaunch) return;
    const launch = externalLaunch;
    const handle = setTimeout(() => {
      launchIntent(launch.intent, launch.args);
      onExternalLaunchConsumed?.();
    }, 0);
    return () => clearTimeout(handle);
  }, [externalLaunch, launchIntent, onExternalLaunchConsumed]);

  useEffect(() => {
    if (!chatOpen || messages.length === 0) return;
    const handle = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 40);
    return () => clearTimeout(handle);
  }, [messages, chatOpen, showHitl, proposalConfirmVisible]);

  useEffect(() => {
    return () => {
      cancelRef.current = true;
      abortRef.current?.abort();
      leaseRef.current?.release();
      leaseRef.current = null;
    };
  }, []);

  const submitComposer = useCallback(async () => {
    const trimmed = composerText.trim();
    if (!trimmed || routingBusy || disabled || busy) return;
    setRoutingBusy(true);
    setRouteError(null);
    setRefuseMessage(null);
    setResolution(null);
    try {
      const { evaluateSafetyRefuseGate } = await import(
        '@/services/slm/safety-refuse-guardrails'
      );
      const safety = evaluateSafetyRefuseGate(trimmed);
      if (safety.refuse) {
        setRefuseMessage(safety.message);
        return;
      }

      let embedder = null as Awaited<
        ReturnType<typeof import('@/knowledge/embedder').createReadyEmbedder>
      > | null;
      try {
        const { createReadyEmbedder, DEFAULT_TFLITE_EMBEDDER_LOAD_MS } =
          await import('@/knowledge/embedder');
        embedder = await createReadyEmbedder(DEFAULT_TFLITE_EMBEDDER_LOAD_MS, {
          allowDevelopmentFallback: __DEV__,
        });
      } catch {
        embedder = null;
      }

      const result = await resolveCareText(trimmed, {
        snapshot,
        embedder,
      });
      setResolution(result);

      if (result.kind === 'emergency') {
        setEmergencyPending({
          phrase: result.matchedPhrase,
          rawText: trimmed,
        });
        setComposerText('');
        return;
      }
      if (result.kind === 'preselect') {
        launchIntent(result.intent, result.args);
        return;
      }
      if (result.kind === 'concierge_handoff') {
        onConciergeHandoff?.(result.carryText);
        // Still open in-card chat so the caregiver can continue here.
        setComposerText('');
        await openFreeTextChat(trimmed);
        return;
      }
      // Chips shown; wait for tap. Also allow opening free chat on second Ask.
    } catch (err) {
      setRouteError(err instanceof Error ? err.message : 'Could not understand that yet.');
    } finally {
      setRoutingBusy(false);
    }
  }, [
    busy,
    composerText,
    disabled,
    launchIntent,
    onConciergeHandoff,
    openFreeTextChat,
    routingBusy,
    snapshot,
  ]);

  const requestCloseChat = useCallback(() => {
    if (busy) {
      Alert.alert(
        'Stop Concierge?',
        'Concierge is still generating. Closing now will cancel this conversation.',
        [
          { text: 'Keep going', style: 'cancel' },
          {
            text: 'Stop',
            style: 'destructive',
            onPress: resetChatState,
          },
        ],
      );
      return;
    }
    resetChatState();
  }, [busy, resetChatState]);

  const handleSendFollowUp = useCallback(() => {
    if (busy || !followUp.trim()) return;
    const text = followUp.trim();
    setFollowUp('');
    void runFollowUpTurn(text);
  }, [busy, followUp, runFollowUpTurn]);

  const handleApplyHitl = useCallback(() => {
    setHitlResolved(true);
    setShowHitl(false);
    const codes =
      observationCodes.length > 0 ? observationCodes.join(', ') : 'none selected';
    void runFollowUpTurn(
      `Caregiver review notes (observations: ${codes}). Please refine your guidance with this ground truth.`,
    );
  }, [observationCodes, runFollowUpTurn]);

  const handleSkipHitl = useCallback(() => {
    setHitlResolved(true);
    setShowHitl(false);
  }, []);

  const handleConfirmProposals = useCallback(() => {
    if (proposalBusy || proposalIds.length === 0) return;
    setProposalBusy(true);
    try {
      for (const id of proposalIds) {
        caregiverConfirmProposal(id, {
          note: activeIntent ? `Confirmed from Care ask · ${activeIntent}` : 'Confirmed from Care ask',
        });
      }
      setProposalConfirmVisible(false);
      setProposalNote('Sent for review — check Needs your review when ready.');
      setProposalIds([]);
      refresh();
      onProposalResolved?.();
    } catch (err) {
      Alert.alert(
        'Could not confirm',
        err instanceof Error ? err.message : 'Something went wrong confirming the proposal.',
      );
    } finally {
      setProposalBusy(false);
    }
  }, [activeIntent, onProposalResolved, proposalBusy, proposalIds, refresh]);

  const handleEmergencyAction = useCallback(
    async (actionId: NextStepActionId) => {
      setEmergencyBusy(true);
      try {
        await executeNextStep(actionId, {
          patientId: patientId || 'unknown',
          alertId: emergencyPending
            ? `care-ask-emg-preview-${Date.now().toString(36)}`
            : undefined,
          caregiverId: 'caregiver-1',
        });
      } finally {
        setEmergencyBusy(false);
      }
    },
    [emergencyPending, patientId],
  );

  const handleConfirmRealEmergency = useCallback(() => {
    if (!emergencyPending) return;
    setEmergencyBusy(true);
    try {
      const alertId = presentCaregiverReportedEmergency({
        title: 'Caregiver-reported emergency',
        body: emergencyPending.phrase
          ? `Caregiver confirmed this is happening now: “${emergencyPending.phrase}”. Take emergency action if the patient is in danger.`
          : `Caregiver confirmed a reported emergency from Care ask: “${emergencyPending.rawText.slice(0, 160)}”.`,
        matchedPhrase: emergencyPending.phrase,
      });
      audit({
        actor: 'caregiver',
        action: 'care_ask_emergency_confirmed_real',
        resourceType: 'alert',
        resourceId: alertId ?? 'none',
        patientId: patientId || undefined,
        payload: {
          matchedPhrase: emergencyPending.phrase ?? null,
          rawText: emergencyPending.rawText.slice(0, 240),
        },
      });
      setEmergencyPending(null);
      setResolution(null);
      refresh();
    } finally {
      setEmergencyBusy(false);
    }
  }, [emergencyPending, patientId, presentCaregiverReportedEmergency, refresh]);

  const handleDismissEmergencyAsHypothetical = useCallback(() => {
    if (!emergencyPending) return;
    audit({
      actor: 'caregiver',
      action: 'care_ask_emergency_dismissed_not_now',
      resourceType: 'care_ask',
      resourceId: 'emergency_screen',
      patientId: patientId || undefined,
      payload: {
        matchedPhrase: emergencyPending.phrase ?? null,
        rawText: emergencyPending.rawText.slice(0, 240),
      },
    });
    setEmergencyPending(null);
    setResolution(null);
  }, [emergencyPending, patientId]);

  const handleRejectProposals = useCallback(() => {
    if (proposalBusy || proposalIds.length === 0) return;
    setProposalBusy(true);
    try {
      for (const id of proposalIds) {
        caregiverRejectProposal(id, 'Rejected from Care ask chat');
      }
      setProposalConfirmVisible(false);
      setProposalNote('Proposal dismissed — no plan change.');
      setProposalIds([]);
      refresh();
    } catch (err) {
      Alert.alert(
        'Could not dismiss',
        err instanceof Error ? err.message : 'Something went wrong dismissing the proposal.',
      );
    } finally {
      setProposalBusy(false);
    }
  }, [proposalBusy, proposalIds, refresh]);

  const visibleMessages = messages.filter((m) => !m.hidden);

  if (!optionalGate.ready) {
    return (
      <View style={styles.wrap} accessible accessibilityLabel="Ask about the care plan">
        <View style={styles.card}>
          <Text style={styles.title}>Ask about the plan</Text>
          <Text style={styles.subtitle}>
            The Concierge powers care-plan questions. It is not downloaded yet.
          </Text>
          <OptionalFeaturePrompt
            requirement="both"
            simulatedMissing={optionalGate.simulatedMissing}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap} accessible accessibilityLabel="Ask about the care plan">
      {!chatOpen ? (
        <View style={styles.card}>
          <Text style={styles.title}>Ask about the plan</Text>
          <Text style={styles.subtitle}>
            Type a short request. Concierge opens in this card — you still confirm any plan change.
          </Text>
          <View style={styles.row}>
            <TextInput
              value={composerText}
              onChangeText={setComposerText}
              placeholder={placeholder}
              placeholderTextColor={AppTheme.colors.textSoft}
              editable={!disabled && !routingBusy && writable !== false}
              style={styles.input}
              returnKeyType="send"
              onSubmitEditing={() => void submitComposer()}
              maxLength={500}
            />
            <Pressable
              onPress={() => void submitComposer()}
              disabled={disabled || routingBusy || !composerText.trim()}
              style={[
                styles.send,
                (!composerText.trim() || disabled || routingBusy) && styles.sendDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Submit care question"
            >
              {routingBusy ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.sendText}>Ask</Text>
              )}
            </Pressable>
          </View>

          {routeError ? <Text style={styles.error}>{routeError}</Text> : null}

          {refuseMessage ? (
            <View style={styles.refuse}>
              <Text style={styles.refuseTitle}>Couldn&apos;t apply that</Text>
              <Text style={styles.refuseBody}>{refuseMessage}</Text>
            </View>
          ) : null}

          {emergencyPending ? (
            <View
              style={styles.emergency}
              accessible
              accessibilityLabel="Emergency confirmation"
            >
              <Text style={styles.emergencyKicker}>Emergency check</Text>
              <Text style={styles.emergencyTitle}>Is this happening right now?</Text>
              <Text style={styles.emergencyBody}>
                Concierge does not diagnose. If someone is in immediate danger, use the actions
                below. Confirm only if this is a real emergency — not a what-if or practice
                question.
              </Text>
              {emergencyPending.phrase ? (
                <Text style={styles.emergencyPhrase}>
                  Detected: “{emergencyPending.phrase}”
                </Text>
              ) : null}

              <Pressable
                style={[styles.emergencyPrimary, emergencyBusy && styles.sendDisabled]}
                onPress={handleConfirmRealEmergency}
                disabled={emergencyBusy}
                accessibilityRole="button"
                accessibilityLabel="Confirm this is a real emergency"
              >
                <Text style={styles.emergencyPrimaryText}>Yes — this is real</Text>
              </Pressable>
              <Text style={styles.emergencyHint}>
                Opens the emergency alert dialogue (Call 911 / Go to ER).
              </Text>

              <Pressable
                style={[styles.emergencySecondary, emergencyBusy && styles.sendDisabled]}
                onPress={handleDismissEmergencyAsHypothetical}
                disabled={emergencyBusy}
                accessibilityRole="button"
                accessibilityLabel="Not happening now, dismiss"
              >
                <Text style={styles.emergencySecondaryText}>No — just asking / not now</Text>
              </Pressable>

              <View style={styles.emergencyActionRow}>
                <Pressable
                  style={styles.emergencyCall}
                  onPress={() => void handleEmergencyAction('call_911')}
                  disabled={emergencyBusy}
                  accessibilityRole="button"
                  accessibilityLabel="Call 911"
                >
                  <Text style={styles.emergencyCallText}>Call 911</Text>
                </Pressable>
                <Pressable
                  style={styles.emergencyEr}
                  onPress={() => void handleEmergencyAction('go_to_er')}
                  disabled={emergencyBusy}
                  accessibilityRole="button"
                  accessibilityLabel="Go to ER"
                >
                  <Text style={styles.emergencyErText}>Go to ER</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {resolution?.kind === 'single_chip' || resolution?.kind === 'multi_chip' ? (
            <View style={styles.chips}>
              <Text style={styles.chipHint}>
                {resolution.kind === 'single_chip' ? 'Did you mean:' : 'Try one of these:'}
              </Text>
              {resolution.chips.map((c) => (
                <Pressable
                  key={c.chipId}
                  style={styles.chip}
                  onPress={() => launchIntent(c.intent, c.args)}
                  accessibilityRole="button"
                  accessibilityLabel={c.label}
                >
                  <Text style={styles.chipText}>{c.label}</Text>
                </Pressable>
              ))}
              <Pressable
                style={styles.chipSecondary}
                onPress={() => {
                  const t = composerText.trim();
                  if (!t) return;
                  setComposerText('');
                  setResolution(null);
                  void openFreeTextChat(t);
                }}
                accessibilityRole="button"
                accessibilityLabel="Open free chat with this question"
              >
                <Text style={styles.chipSecondaryText}>Chat about this instead</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.chatCard} accessibilityLabel={chatTitle}>
          <View style={styles.header}>
            <Text style={styles.chatTitle} numberOfLines={2}>
              {chatTitle}
            </Text>
            <Pressable
              style={styles.closeButton}
              onPress={requestCloseChat}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close plan chat"
            >
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>

          <View style={styles.statusRow}>
            {busy ? (
              <ActivityIndicator color={AppTheme.colors.brand} size="small" />
            ) : (
              <View style={styles.statusDot} />
            )}
            <Text style={styles.statusText} numberOfLines={2}>
              {statusLine}
            </Text>
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.thread}
            contentContainerStyle={styles.threadContent}
            keyboardShouldPersistTaps="handled"
          >
            {visibleMessages.map((msg) => (
              <View
                key={msg.id}
                style={[
                  styles.bubble,
                  msg.role === 'user' ? styles.userBubble : styles.assistantBubble,
                ]}
              >
                <Text style={styles.bubbleLabel}>
                  {msg.role === 'user' ? 'You' : 'Concierge'}
                </Text>
                {msg.role === 'assistant' && msg.status === 'done' ? (
                  <>
                    <MarkdownRenderer size="normal">{msg.text || '…'}</MarkdownRenderer>
                    {msg.sources && msg.sources.length > 0 ? (
                      <CitationList
                        sources={msg.sources}
                        collapsible
                        defaultExpanded={false}
                        compact
                        maxItems={5}
                      />
                    ) : null}
                  </>
                ) : (
                  <Text
                    style={[
                      styles.bubbleText,
                      msg.status === 'streaming' && styles.streamingText,
                      msg.status === 'error' && styles.errorTextBubble,
                    ]}
                  >
                    {msg.text || (msg.status === 'streaming' ? '…' : '')}
                  </Text>
                )}
              </View>
            ))}

            {proposalNote && !proposalConfirmVisible ? (
              <Text style={styles.proposalNote}>{proposalNote}</Text>
            ) : null}

            {showHitl && !hitlResolved ? (
              <View style={styles.hitlCard}>
                <Text style={styles.hitlTitle}>Your review</Text>
                <Text style={styles.hitlBody}>
                  Select anything you observed so Concierge can refine this guidance. This is
                  optional.
                </Text>
                <ObservationPicker
                  selected={observationCodes}
                  onChange={setObservationCodes}
                  enabled={!busy}
                />
                <View style={styles.hitlRow}>
                  <Pressable
                    style={[styles.hitlButton, styles.hitlPrimary]}
                    onPress={handleApplyHitl}
                    disabled={busy}
                  >
                    <Text style={styles.hitlPrimaryText}>Apply review & continue</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.hitlButton, styles.hitlSecondary]}
                    onPress={handleSkipHitl}
                    disabled={busy}
                  >
                    <Text style={styles.hitlSecondaryText}>Skip review</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {proposalIds.length > 0 && !proposalConfirmVisible ? (
              <Pressable
                style={styles.reopenProposal}
                onPress={() => setProposalConfirmVisible(true)}
              >
                <Text style={styles.reopenProposalText}>Review plan proposal…</Text>
              </Pressable>
            ) : null}
          </ScrollView>

          <View style={styles.inputRow}>
            <TextInput
              value={followUp}
              onChangeText={setFollowUp}
              placeholder="Ask a follow-up…"
              placeholderTextColor={AppTheme.colors.textMuted}
              editable={!busy}
              multiline
              style={styles.followInput}
            />
            <Pressable
              style={[styles.sendButton, (!followUp.trim() || busy) && styles.sendDisabled]}
              onPress={handleSendFollowUp}
              disabled={!followUp.trim() || busy}
              accessibilityRole="button"
              accessibilityLabel="Send follow-up"
            >
              <Text style={styles.sendText}>Ask</Text>
            </Pressable>
          </View>

          <Text style={styles.footnote}>
            Concierge guidance — not a diagnosis. Confirm any plan change below.
          </Text>
        </View>
      )}

      <Modal
        visible={proposalConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!proposalBusy) setProposalConfirmVisible(false);
        }}
      >
        <Pressable
          style={styles.confirmOverlay}
          onPress={() => {
            if (!proposalBusy) setProposalConfirmVisible(false);
          }}
        >
          <Pressable style={styles.confirmSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.confirmTitle}>Confirm plan proposal</Text>
            <Text style={styles.confirmMessage}>
              Concierge drafted a care plan update. Confirm to send it for review, or cancel to
              dismiss it. Nothing is applied until you confirm.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                style={[styles.confirmButton, styles.confirmCancelButton]}
                onPress={handleRejectProposals}
                disabled={proposalBusy}
              >
                <Text style={styles.confirmCancelText}>Dismiss</Text>
              </Pressable>
              <Pressable
                style={[styles.confirmButton, styles.confirmPrimaryButton]}
                onPress={handleConfirmProposals}
                disabled={proposalBusy || !writable}
              >
                {proposalBusy ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.confirmPrimaryText}>Confirm</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 12,
  },
  card: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 14,
  },
  title: {
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  subtitle: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: AppTheme.colors.text,
    backgroundColor: AppTheme.colors.screen,
    fontSize: 14,
    fontWeight: '600',
  },
  send: {
    backgroundColor: AppTheme.colors.brand,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 56,
    alignItems: 'center',
  },
  sendDisabled: {
    opacity: 0.45,
  },
  sendText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 13,
  },
  error: {
    color: AppTheme.colors.danger,
    marginTop: 8,
    fontSize: 12,
    fontWeight: '700',
  },
  refuse: {
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: AppTheme.colors.softSurface,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
  },
  refuseTitle: {
    color: AppTheme.colors.text,
    fontWeight: '900',
    fontSize: 13,
  },
  refuseBody: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    marginTop: 4,
  },
  emergency: {
    marginTop: 10,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#B3261E',
    borderWidth: 1,
    borderColor: '#8B1A14',
  },
  emergencyKicker: {
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  emergencyTitle: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 16,
  },
  emergencyBody: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginTop: 6,
  },
  emergencyPhrase: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 10,
    fontStyle: 'italic',
  },
  emergencyPrimary: {
    marginTop: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  emergencyPrimaryText: {
    color: '#B3261E',
    fontWeight: '900',
    fontSize: 14,
  },
  emergencyHint: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 6,
    textAlign: 'center',
  },
  emergencySecondary: {
    marginTop: 10,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  emergencySecondaryText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
  emergencyActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  emergencyCall: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  emergencyCallText: {
    color: '#B3261E',
    fontWeight: '900',
    fontSize: 14,
  },
  emergencyEr: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  emergencyErText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 14,
  },
  chips: {
    marginTop: 10,
    gap: 8,
  },
  chipHint: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: AppTheme.colors.brandSoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: AppTheme.colors.brand,
  },
  chipText: {
    color: AppTheme.colors.brandDark,
    fontWeight: '800',
    fontSize: 12,
  },
  chipSecondary: {
    alignSelf: 'flex-start',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  chipSecondaryText: {
    color: AppTheme.colors.textSoft,
    fontWeight: '700',
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  chatCard: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.brand,
    padding: 14,
    ...AppTheme.shadow,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  chatTitle: {
    flex: 1,
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  closeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: AppTheme.colors.softSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: AppTheme.colors.textSoft,
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '900',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: AppTheme.colors.brandSoft,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: AppTheme.colors.brand,
  },
  statusText: {
    flex: 1,
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: '800',
  },
  thread: {
    maxHeight: 320,
  },
  threadContent: {
    gap: 8,
    paddingBottom: 8,
  },
  bubble: {
    borderRadius: 12,
    padding: 10,
  },
  userBubble: {
    backgroundColor: AppTheme.colors.softSurface,
    alignSelf: 'flex-end',
    maxWidth: '92%',
  },
  assistantBubble: {
    backgroundColor: AppTheme.colors.brandSoft,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  bubbleLabel: {
    color: AppTheme.colors.textMuted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  bubbleText: {
    color: AppTheme.colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  streamingText: {
    fontStyle: 'italic',
    color: AppTheme.colors.textSoft,
  },
  errorTextBubble: {
    color: AppTheme.colors.danger,
  },
  proposalNote: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
    marginTop: 4,
  },
  hitlCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.surface,
    padding: 12,
    marginTop: 4,
  },
  hitlTitle: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 4,
  },
  hitlBody: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 8,
  },
  hitlRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  hitlButton: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  hitlPrimary: {
    backgroundColor: AppTheme.colors.brand,
  },
  hitlPrimaryText: {
    color: AppTheme.colors.white,
    fontSize: 12,
    fontWeight: '900',
  },
  hitlSecondary: {
    backgroundColor: AppTheme.colors.softSurface,
  },
  hitlSecondaryText: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    fontWeight: '800',
  },
  reopenProposal: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingVertical: 6,
  },
  reopenProposalText: {
    color: AppTheme.colors.brandDark,
    fontWeight: '800',
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  followInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 96,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.softSurface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: AppTheme.colors.text,
    fontSize: 14,
  },
  sendButton: {
    borderRadius: 12,
    backgroundColor: AppTheme.colors.brand,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  footnote: {
    marginTop: 8,
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  confirmSheet: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
  },
  confirmTitle: {
    color: AppTheme.colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  confirmMessage: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 16,
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  confirmButton: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 96,
    alignItems: 'center',
  },
  confirmCancelButton: {
    backgroundColor: AppTheme.colors.softSurface,
  },
  confirmPrimaryButton: {
    backgroundColor: AppTheme.colors.brand,
  },
  confirmCancelText: {
    color: AppTheme.colors.textSoft,
    fontWeight: '800',
    fontSize: 13,
  },
  confirmPrimaryText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 13,
  },
});

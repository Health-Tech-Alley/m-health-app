/**
 * In-card mini Concierge chat for Care-tab explain paths that need multi-turn
 * HITL (e.g. rehab "more information is needed") instead of the broken full
 * slm-explain screen.
 *
 * Mirrors main Concierge chat patterns at a smaller scale:
 *   - Seed prompt + streamed answer
 *   - Follow-up text input
 *   - Optional observation HITL card (same picker as main chat UC2 path)
 *   - Fail-closed when no native model is available
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { useOrchestratorRetriever } from '@/contexts/orchestrator-context';
import {
  getCurrentPatientSnapshot,
  usePatientRecord,
} from '@/contexts/patient-record-context';
import { useSettings } from '@/contexts/settings-context';
import { useSLM } from '@/contexts/slm-context';
import { useOptionalFeatureGate } from '@/hooks/useOptionalFeatureGate';
import { useTheme } from '@/hooks/use-theme';
import { MODEL_CATALOG, resolveActiveModelId } from '@/inference/model-catalog';
import { isModelInstalled } from '@/services/model-storage';
import type { SlmTaskLease } from '@/services/slm/slm-task-queue';
import {
  buildExplainFingerprint,
  getCachedExplainAnswer,
  setCachedExplainAnswer,
} from '@/services/slm/explainAnswerCache';
import { prepareSlmTurn } from '@/services/slm/prepareSlmTurn';
import { buildUc3TherapySystemContext } from '@/services/carePlan/uc3TherapyChatContext';
import { stripControlTokens } from '@/utils/stripControlTokens';

type ChatRole = 'user' | 'assistant';

type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  status: 'streaming' | 'done' | 'error';
  /** Seed prompt is sent to the model but not shown to the caregiver. */
  hidden?: boolean;
};

/** Domain grounding injected every turn (system + plan RAG). */
export type InCardMiniChatContextProfile = 'default' | 'uc3_therapy';

export type InCardMiniChatProps = {
  visible: boolean;
  title: string;
  /** First user turn — sent automatically when the card opens. */
  seedPrompt: string;
  onClose: () => void;
  /** Show an observation HITL card after the first assistant reply. */
  enableObservationHitl?: boolean;
  /**
   * Cache key title (defaults to `title`). Include session/input fingerprint
   * material in seedPrompt so unchanged therapy sessions hit cache.
   */
  cacheTitle?: string;
  /** Embedded inside another card (no outer border/title chrome). */
  embedded?: boolean;
  /**
   * When `uc3_therapy`, every turn gets a compact therapy + medications
   * system block (no NLU / tool dump / plan-RAG — keeps n_ctx headroom).
   */
  contextProfile?: InCardMiniChatContextProfile;
};

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function InCardMiniChat({
  visible,
  title,
  seedPrompt,
  onClose,
  enableObservationHitl = true,
  cacheTitle,
  embedded = false,
  contextProfile = 'default',
}: InCardMiniChatProps) {
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
  const { snapshot, patientId } = usePatientRecord();
  const { settings, isDeveloper } = useSettings();
  const optionalGate = useOptionalFeatureGate('both');
  const retriever = useOrchestratorRetriever();
  // Effective default — a single installed model is always the default.
  const defaultModelId = resolveActiveModelId(settings.demoDefaultModelId, (id) =>
    MODEL_CATALOG.some((m) => m.id === id && isModelInstalled(m)),
  );
  const effectiveCacheTitle = cacheTitle ?? title;
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusLine, setStatusLine] = useState('Preparing…');
  const [observationCodes, setObservationCodes] = useState<string[]>([]);
  const [showHitl, setShowHitl] = useState(false);
  const [hitlResolved, setHitlResolved] = useState(false);

  const leaseRef = useRef<SlmTaskLease | null>(null);
  const loadedBySheetRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const cancelRef = useRef(false);
  const seededRef = useRef(false);
  const historyRef = useRef<{ role: 'system' | 'user' | 'assistant'; content: string }[]>([]);
  const scrollRef = useRef<ScrollView | null>(null);

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
      return await acquireSlm('care_explain');
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
      return await acquireSlm('care_explain');
    } catch {
      return null;
    }
  }, [acquireSlm, defaultModelId, slmLoadModel]);

  const runTurn = useCallback(
    async (userText: string, opts?: { hidden?: boolean; isSeed?: boolean }) => {
      const trimmed = userText.trim();
      if (!trimmed || cancelRef.current) return;

      const isSeed = Boolean(opts?.isSeed);
      const fingerprint = isSeed
        ? buildExplainFingerprint({
            title: effectiveCacheTitle,
            prompt: trimmed,
            patientId,
          })
        : null;

      if (isSeed && fingerprint) {
        const cached = getCachedExplainAnswer(fingerprint);
        if (cached?.answer) {
          const assistantId = makeId('a');
          setMessages([
            {
              id: makeId('u'),
              role: 'user',
              text: trimmed,
              status: 'done',
              hidden: true,
            },
            {
              id: assistantId,
              role: 'assistant',
              text: cached.answer,
              status: 'done',
            },
          ]);
          historyRef.current = [
            { role: 'user', content: trimmed },
            { role: 'assistant', content: cached.answer },
          ];
          setStatusLine('Saved explanation · unchanged since last run');
          setBusy(false);
          if (enableObservationHitl && !hitlResolved) {
            setShowHitl(true);
          }
          return;
        }
      }

      const userMsg: ChatMessage = {
        id: makeId('u'),
        role: 'user',
        text: trimmed,
        status: 'done',
        hidden: Boolean(opts?.hidden || isSeed),
      };
      const assistantId = makeId('a');
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: 'assistant', text: '', status: 'streaming' },
      ]);
      setBusy(true);
      setStatusLine(
        currentModelId ? `Thinking · ${currentModelId}…` : 'Loading Concierge…',
      );

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
          prev.map((m) =>
            m.id === assistantId ? { ...m, text: err, status: 'error' } : m,
          ),
        );
        setStatusLine(`Error: ${err}`);
        setBusy(false);
        return;
      }

      const allowDevNlu =
        __DEV__ && isDeveloper && settings.nluDevelopmentFallback === true;
      const useUc3Therapy = contextProfile === 'uc3_therapy';
      // Read the latest active-patient snapshot just before the turn so values
      // entered on the therapy card moments ago are present in the prompt.
      const liveSnapshot = getCurrentPatientSnapshot() ?? snapshot;
      // UC3: snapshot already has exercises/meds — skip NLU (avoids TFLite
      // failures blocking the turn) and drop tools/plan-RAG to protect n_ctx.
      const prepared = await prepareSlmTurn({
        userText: trimmed,
        snapshot: liveSnapshot,
        retriever: useUc3Therapy ? null : retriever,
        forceDeep: true,
        allowDevelopmentNluFallback: allowDevNlu,
        skipNlu: useUc3Therapy,
        toolsOverride: useUc3Therapy ? [] : undefined,
        modelId: defaultModelId,
        extraSystemContext: useUc3Therapy
          ? buildUc3TherapySystemContext(liveSnapshot)
          : undefined,
        logTag: 'InCardMiniChat',
      });
      if (cancelRef.current) {
        lease?.release();
        return;
      }

      // Multi-turn: store clean user text in history (not citation-bloated
      // prepared.userContent) so follow-ups stay inside n_ctx.
      const priorTurns = historyRef.current.filter((m) => m.role !== 'system');
      const userForModel = useUc3Therapy ? trimmed : prepared.userContent;
      historyRef.current = [
        { role: 'system', content: prepared.systemContext },
        ...priorTurns,
        { role: 'user', content: userForModel },
      ];

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        setStatusLine(
          currentModelId ? `Generating · ${currentModelId}…` : 'Generating…',
        );
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
          prepared.generation,
        );
        if (cancelRef.current) return;
        const cleaned = stripControlTokens(result.text).answer;
        historyRef.current.push({ role: 'assistant', content: cleaned });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, text: cleaned, status: 'done' }
              : m,
          ),
        );
        setStatusLine(
          currentModelId ? `Complete · ${currentModelId}` : 'Complete',
        );
        if (isSeed && fingerprint && cleaned.trim()) {
          setCachedExplainAnswer({
            fingerprint,
            title: effectiveCacheTitle,
            answer: cleaned,
            patientId: patientId ?? undefined,
          });
        }
        if (enableObservationHitl && !hitlResolved) {
          setShowHitl(true);
        }
      } catch (err) {
        if (cancelRef.current || controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, text: message, status: 'error' }
              : m,
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
      contextProfile,
      currentModelId,
      effectiveCacheTitle,
      enableObservationHitl,
      ensureModelAndLease,
      hitlResolved,
      isDeveloper,
      patientId,
      provider,
      retriever,
      settings.nluDevelopmentFallback,
      snapshot,
    ],
  );

  useEffect(() => {
    if (!visible) {
      cancelRef.current = true;
      abortRef.current?.abort();
      abortRef.current = null;
      releaseLease();
      seededRef.current = false;
      historyRef.current = [];
      const handle = setTimeout(() => {
        setMessages([]);
        setInput('');
        setBusy(false);
        setShowHitl(false);
        setHitlResolved(false);
        setObservationCodes([]);
        setStatusLine('Preparing…');
      }, 0);
      return () => clearTimeout(handle);
    }

    cancelRef.current = false;
    if (seededRef.current) return;
    seededRef.current = true;
    const handle = setTimeout(() => {
      void runTurn(seedPrompt, { isSeed: true, hidden: true });
    }, 0);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible || messages.length === 0) return;
    const handle = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 40);
    return () => clearTimeout(handle);
  }, [messages, visible, showHitl]);

  const requestClose = useCallback(() => {
    if (busy) {
      Alert.alert(
        'Stop Concierge?',
        'Concierge is still generating. Closing now will cancel this conversation.',
        [
          { text: 'Keep going', style: 'cancel' },
          {
            text: 'Stop',
            style: 'destructive',
            onPress: () => {
              cancelRef.current = true;
              abortRef.current?.abort();
              releaseLease();
              onClose();
            },
          },
        ],
      );
      return;
    }
    cancelRef.current = true;
    abortRef.current?.abort();
    releaseLease();
    onClose();
  }, [busy, onClose, releaseLease]);

  const handleSend = useCallback(() => {
    if (busy || !input.trim()) return;
    const text = input.trim();
    setInput('');
    void runTurn(text);
  }, [busy, input, runTurn]);

  const handleApplyHitl = useCallback(() => {
    setHitlResolved(true);
    setShowHitl(false);
    const codes =
      observationCodes.length > 0
        ? observationCodes.join(', ')
        : 'none selected';
    void runTurn(
      `Caregiver review notes (observations: ${codes}). Please refine your guidance with this ground truth.`,
    );
  }, [observationCodes, runTurn]);

  const handleSkipHitl = useCallback(() => {
    setHitlResolved(true);
    setShowHitl(false);
  }, []);

  if (!visible) return null;

  const visibleMessages = messages.filter((m) => !m.hidden);

  if (!optionalGate.ready) {
    return (
      <View
        style={[
          styles.card,
          themedStyles.card,
          embedded && styles.cardEmbedded,
          embedded && themedStyles.cardEmbedded,
        ]}
        accessibilityLabel={title}
      >
        <View style={styles.header}>
          <Text style={[styles.title, themedStyles.primaryText]} numberOfLines={2}>
            {title}
          </Text>
          <Pressable
            style={[styles.closeButton, themedStyles.controlSurface]}
            onPress={requestClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close mini Concierge"
          >
            <Text style={[styles.closeText, themedStyles.supportingText]}>×</Text>
          </Pressable>
        </View>
        <OptionalFeaturePrompt
          requirement="both"
          onDismiss={requestClose}
          simulatedMissing={optionalGate.simulatedMissing}
        />
      </View>
    );
  }

  return (
    <View
      style={[styles.card, themedStyles.card, embedded && styles.cardEmbedded, embedded && themedStyles.cardEmbedded]}
      accessibilityLabel={title}
    >
      <View style={styles.header}>
        <Text style={[styles.title, themedStyles.primaryText]} numberOfLines={2}>
          {title}
        </Text>
        <Pressable
          style={[styles.closeButton, themedStyles.controlSurface]}
          onPress={requestClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close mini Concierge"
        >
          <Text style={[styles.closeText, themedStyles.supportingText]}>×</Text>
        </Pressable>
      </View>

      <View style={[styles.statusRow, themedStyles.brandSoftSurface]}>
        {busy ? (
          <ActivityIndicator color={AppTheme.colors.brand} size="small" />
        ) : (
          <View style={[styles.statusDot, themedStyles.actionBackground]} />
        )}
        <Text style={[styles.statusText, themedStyles.actionText]} numberOfLines={2}>
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
              msg.role === 'user' ? themedStyles.controlSurface : themedStyles.brandSoftSurface,
            ]}
          >
            <Text style={[styles.bubbleLabel, themedStyles.mutedText]}>
              {msg.role === 'user' ? 'You' : 'Concierge'}
            </Text>
            {msg.role === 'assistant' && msg.status === 'done' ? (
              <MarkdownRenderer size="normal">{msg.text || '…'}</MarkdownRenderer>
            ) : (
              <Text
                style={[
                  styles.bubbleText,
                  themedStyles.primaryText,
                  msg.status === 'streaming' && styles.streamingText,
                  msg.status === 'streaming' && themedStyles.supportingText,
                  msg.status === 'error' && styles.errorText,
                ]}
              >
                {msg.text || (msg.status === 'streaming' ? '…' : '')}
              </Text>
            )}
          </View>
        ))}

        {showHitl && !hitlResolved ? (
          <View style={[styles.hitlCard, themedStyles.cardEmbedded]}>
            <Text style={[styles.hitlTitle, themedStyles.primaryText]}>Your review</Text>
            <Text style={[styles.hitlBody, themedStyles.supportingText]}>
              Select anything you observed so Concierge can refine this guidance.
              This is optional.
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
                style={[styles.hitlButton, styles.hitlSecondary, themedStyles.controlSurface]}
                onPress={handleSkipHitl}
                disabled={busy}
              >
                <Text style={[styles.hitlSecondaryText, themedStyles.supportingText]}>Skip review</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.inputRow}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Ask a follow-up…"
          placeholderTextColor={theme.appTextMuted}
          editable={!busy}
          multiline
          style={[styles.input, themedStyles.input]}
        />
        <Pressable
          style={[styles.sendButton, (!input.trim() || busy) && styles.sendDisabled]}
          onPress={handleSend}
          disabled={!input.trim() || busy}
          accessibilityRole="button"
          accessibilityLabel="Send follow-up"
        >
          <Text style={styles.sendText}>Ask</Text>
        </Pressable>
      </View>

      <Text style={[styles.footnote, themedStyles.mutedText]}>
        Concierge guidance — not a diagnosis. Confirm with the care team.
      </Text>
    </View>
  );
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  const isDark = theme.appBackground === '#000000';
  const actionText = isDark ? AppTheme.colors.brandPale : AppTheme.colors.brand;

  return StyleSheet.create({
    card: {
      backgroundColor: theme.appSurface,
      borderColor: actionText,
      ...(isDark ? { elevation: 0, shadowOpacity: 0 } : null),
    },
    cardEmbedded: { backgroundColor: theme.appSurface, borderColor: theme.appBorder },
    controlSurface: { backgroundColor: theme.appControlSurface },
    brandSoftSurface: { backgroundColor: theme.appBrandSoftSurface },
    primaryText: { color: theme.appText },
    supportingText: { color: theme.appTextSupporting },
    mutedText: { color: theme.appTextMuted },
    actionText: { color: actionText },
    actionBackground: { backgroundColor: actionText },
    input: {
      backgroundColor: theme.appInputBackground,
      borderColor: theme.appBorder,
      color: theme.appText,
    },
  });
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.brand,
    padding: 14,
    marginBottom: 14,
    ...AppTheme.shadow,
  },
  cardEmbedded: {
    marginBottom: 0,
    marginTop: 12,
    borderRadius: 14,
    borderColor: AppTheme.colors.border,
    shadowOpacity: 0,
    elevation: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  title: {
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
    maxHeight: 280,
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
  errorText: {
    color: AppTheme.colors.danger,
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
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  input: {
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
  sendDisabled: {
    opacity: 0.45,
  },
  sendText: {
    color: AppTheme.colors.white,
    fontSize: 13,
    fontWeight: '900',
  },
  footnote: {
    marginTop: 8,
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
});

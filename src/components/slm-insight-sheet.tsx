/**
 * SlmInsightSheet — reusable one-off Concierge bottom sheet (Care-style).
 *
 * Canonical UI for single-shot explains (care sections, meds, concerns, etc.).
 * Uses `prepareSlmTurn` so NLU + retrieval match main Concierge chat.
 * Prefer this over InCardMiniChat when no multi-turn follow-up is needed.
 *
 * Lifecycle:
 *   - On open: check explain answer cache; on hit, show without loading SLM.
 *   - On miss: NLU → lease → stream → cache final answer.
 *   - Regenerate + collapsible Sources (no chunk #).
 *   - YouTube-style minimize when allowMinimize; swipe to dismiss.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { MarkdownRenderer } from '@/components/markdown-renderer';
import { AppTheme } from '@/constants/theme';
import { usePatientRecord } from '@/contexts/patient-record-context';
import { useSettings } from '@/contexts/settings-context';
import { useSLM } from '@/contexts/slm-context';
import { DEFAULT_SLM_MODEL_ID, MODEL_CATALOG } from '@/inference/model-catalog';
import type { SlmTaskReason, SlmTaskLease } from '@/services/slm/slm-task-queue';
import { isModelInstalled } from '@/services/model-storage';
import {
  buildExplainFingerprint,
  getCachedExplainAnswer,
  invalidateExplainAnswer,
  setCachedExplainAnswer,
} from '@/services/slm/explainAnswerCache';
import { prepareSlmTurn } from '@/services/slm/prepareSlmTurn';
import { formatAnswerWithCollapsedSources } from '@/clinical-evidence/citation-display';
import { useOrchestratorRetriever } from '@/contexts/orchestrator-context';
import { stripControlTokens } from '@/utils/stripControlTokens';

export interface SlmInsightSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  prompt: string;
  reason?: SlmTaskReason;
  allowMinimize?: boolean;
}

type Phase = 'idle' | 'loading' | 'thinking' | 'streaming' | 'done' | 'error';
type Source = 'native' | 'cache';
type Presentation = 'full' | 'mini';

const WINDOW_H = Dimensions.get('window').height;
const BODY_MAX_HEIGHT = Math.round(WINDOW_H * 0.5);
const MINI_CONTENT_H = 0;
const FULL_SHEET_APPROX = Math.min(WINDOW_H * 0.72, BODY_MAX_HEIGHT + 180);
const DRAG_THRESHOLD = 80;
const OPEN_MS = 280;
const CLOSE_MS = 220;
const MINI_MS = 260;

export function SlmInsightSheet({
  visible,
  onClose,
  title,
  prompt,
  reason = 'safety_note_explain',
  allowMinimize = true,
}: SlmInsightSheetProps) {
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
  const retriever = useOrchestratorRetriever();
  const defaultModelId = settings.demoDefaultModelId ?? DEFAULT_SLM_MODEL_ID;

  const [phase, setPhase] = useState<Phase>('idle');
  const [answer, setAnswer] = useState('');
  const [finalText, setFinalText] = useState<string | null>(null);
  const [sourceLabels, setSourceLabels] = useState<string[]>([]);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [presentation, setPresentation] = useState<Presentation>('full');
  const [mounted, setMounted] = useState(false);
  const skipCacheRef = useRef(false);

  const leaseRef = useRef<SlmTaskLease | null>(null);
  const loadedBySheetRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const cancelRef = useRef(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const ranRef = useRef(false);
  const phaseRef = useRef<Phase>('idle');
  const presentationRef = useRef<Presentation>('full');
  const fingerprintRef = useRef<string>('');
  const titleRef = useRef(title);
  const promptRef = useRef(prompt);
  const closingRef = useRef(false);

  const [backdropOpacity] = useState(() => new Animated.Value(0));
  const [sheetTranslateY] = useState(() => new Animated.Value(FULL_SHEET_APPROX));
  const [bodyHeight] = useState(() => new Animated.Value(BODY_MAX_HEIGHT));
  const [bodyOpacity] = useState(() => new Animated.Value(1));
  const [dragY] = useState(() => new Animated.Value(0));

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    presentationRef.current = presentation;
  }, [presentation]);
  useEffect(() => {
    titleRef.current = title;
    promptRef.current = prompt;
  }, [title, prompt]);

  const ensureModelAndLease = useCallback(async (): Promise<SlmTaskLease | null> => {
    loadedBySheetRef.current = false;
    try {
      return await acquireSlm(reason);
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
      return await acquireSlm(reason);
    } catch {
      return null;
    }
  }, [acquireSlm, reason, defaultModelId, slmLoadModel]);

  const runExplain = useCallback(async () => {
    const activeTitle = titleRef.current;
    const activePrompt = promptRef.current;
    const fingerprint = buildExplainFingerprint({
      title: activeTitle,
      prompt: activePrompt,
      patientId,
    });
    fingerprintRef.current = fingerprint;

    const forceFresh = skipCacheRef.current;
    skipCacheRef.current = false;

    if (!forceFresh) {
      const cached = getCachedExplainAnswer(fingerprint);
      if (cached?.answer) {
        setSource('cache');
        setAnswer(cached.answer);
        setFinalText(cached.answer);
        setSourceLabels(cached.sourceLabels ?? []);
        setSourcesOpen(false);
        setError(null);
        setActiveModelId(null);
        setPhase('done');
        return;
      }
    } else {
      invalidateExplainAnswer(fingerprint);
    }

    setPhase('loading');
    setAnswer('');
    setFinalText(null);
    setSourceLabels([]);
    setSourcesOpen(false);
    setError(null);
    setSource(null);
    setActiveModelId(currentModelId);
    cancelRef.current = false;

    const lease = await ensureModelAndLease();
    if (cancelRef.current) {
      lease?.release();
      return;
    }
    leaseRef.current = lease;
    setActiveModelId(currentModelId);

    const allowDevNlu =
      __DEV__ && isDeveloper && settings.nluDevelopmentFallback === true;

    const prepared = await prepareSlmTurn({
      userText: activePrompt,
      snapshot,
      retriever,
      forceDeep: true,
      allowDevelopmentNluFallback: allowDevNlu,
      logTag: 'SlmInsightSheet',
    });
    if (cancelRef.current) return;

    if (provider.getModelInfo()) {
      setSource('native');
      setPhase('thinking');
      const controller = new AbortController();
      abortRef.current = controller;
      let firstTokenSeen = false;
      try {
        const result = await provider.chat(
          [
            { role: 'system', content: prepared.systemContext },
            { role: 'user', content: prepared.userContent },
          ],
          (token) => {
            if (!firstTokenSeen) {
              firstTokenSeen = true;
              setPhase('streaming');
            }
            setAnswer((prev) => prev + token);
          },
          controller.signal,
          prepared.generation,
        );
        if (cancelRef.current) return;
        const cleaned = stripControlTokens(result.text).answer;
        const collapsed = formatAnswerWithCollapsedSources(
          cleaned,
          prepared.citationChunks,
        );
        setAnswer(collapsed.displayText);
        setFinalText(collapsed.displayText);
        setSourceLabels(collapsed.sourceLabels);
        setPhase('done');
        setCachedExplainAnswer({
          fingerprint,
          title: activeTitle,
          answer: collapsed.displayText,
          sourceLabels: collapsed.sourceLabels,
          patientId: patientId ?? undefined,
        });
      } catch (err) {
        if (cancelRef.current || controller.signal.aborted) {
          setPhase('done');
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      } finally {
        abortRef.current = null;
      }
      return;
    }

    const installed = MODEL_CATALOG.filter(isModelInstalled);
    setError(
      installed.length === 0
        ? 'Concierge is unavailable — no model is installed. Open Models to download one, then retry.'
        : 'Concierge could not load a model. Open Models, load Concierge, then retry.',
    );
    setPhase('error');
  }, [
    ensureModelAndLease,
    provider,
    snapshot,
    patientId,
    currentModelId,
    retriever,
    isDeveloper,
    settings.nluDevelopmentFallback,
  ]);

  const handleRegenerate = useCallback(() => {
    if (phase === 'loading' || phase === 'thinking' || phase === 'streaming') return;
    skipCacheRef.current = true;
    cancelRef.current = false;
    void runExplain();
  }, [phase, runExplain]);

  const releaseResources = useCallback(() => {
    cancelRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
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

  const animateOpen = useCallback(() => {
    closingRef.current = false;
    sheetTranslateY.setValue(FULL_SHEET_APPROX);
    backdropOpacity.setValue(0);
    bodyHeight.setValue(BODY_MAX_HEIGHT);
    bodyOpacity.setValue(1);
    dragY.setValue(0);
    setPresentation('full');
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: OPEN_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(sheetTranslateY, {
        toValue: 0,
        duration: OPEN_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [backdropOpacity, sheetTranslateY, bodyHeight, bodyOpacity, dragY]);

  const animateToMini = useCallback(() => {
    if (!allowMinimize) return;
    setPresentation('mini');
    dragY.setValue(0);
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: MINI_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(bodyHeight, {
        toValue: MINI_CONTENT_H,
        duration: MINI_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(bodyOpacity, {
        toValue: 0,
        duration: MINI_MS * 0.7,
        useNativeDriver: false,
      }),
      Animated.timing(sheetTranslateY, {
        toValue: 0,
        duration: MINI_MS,
        useNativeDriver: true,
      }),
    ]).start();
  }, [allowMinimize, backdropOpacity, bodyHeight, bodyOpacity, sheetTranslateY, dragY]);

  const animateToFull = useCallback(() => {
    setPresentation('full');
    dragY.setValue(0);
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: MINI_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(bodyHeight, {
        toValue: BODY_MAX_HEIGHT,
        duration: MINI_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(bodyOpacity, {
        toValue: 1,
        duration: MINI_MS,
        useNativeDriver: false,
      }),
      Animated.timing(sheetTranslateY, {
        toValue: 0,
        duration: MINI_MS,
        useNativeDriver: true,
      }),
    ]).start();
  }, [backdropOpacity, bodyHeight, bodyOpacity, sheetTranslateY, dragY]);

  const finishClose = useCallback(() => {
    releaseResources();
    ranRef.current = false;
    setMounted(false);
    setPresentation('full');
    setPhase('idle');
    setAnswer('');
    setFinalText(null);
    setError(null);
    setSource(null);
    closingRef.current = false;
    onClose();
  }, [onClose, releaseResources]);

  const animateClose = useCallback(
    (after?: () => void) => {
      if (closingRef.current) return;
      closingRef.current = true;
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: CLOSE_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(sheetTranslateY, {
          toValue: FULL_SHEET_APPROX,
          duration: CLOSE_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) {
          finishClose();
          after?.();
        } else {
          closingRef.current = false;
        }
      });
    },
    [backdropOpacity, sheetTranslateY, finishClose],
  );

  const performClose = useCallback(() => {
    animateClose();
  }, [animateClose]);

  const requestClose = useCallback(() => {
    const inProgress =
      phaseRef.current === 'loading' ||
      phaseRef.current === 'thinking' ||
      phaseRef.current === 'streaming';
    if (inProgress) {
      Alert.alert(
        'Stop Concierge?',
        'Concierge is still generating. Closing now will cancel this explanation.',
        [
          { text: 'Keep going', style: 'cancel' },
          { text: 'Stop', style: 'destructive', onPress: performClose },
        ],
      );
      return;
    }
    performClose();
  }, [performClose]);

  const minimize = useCallback(() => {
    if (!allowMinimize) {
      requestClose();
      return;
    }
    animateToMini();
  }, [allowMinimize, requestClose, animateToMini]);

  const expand = useCallback(() => {
    animateToFull();
  }, [animateToFull]);

  // Mount / unmount with open animation (defer setState out of effect body).
  useEffect(() => {
    if (visible) {
      cancelRef.current = false;
      const handle = setTimeout(() => {
        setMounted(true);
        animateOpen();
        if (!ranRef.current) {
          ranRef.current = true;
          void runExplain();
        }
      }, 0);
      return () => clearTimeout(handle);
    }
    if (mounted) {
      animateClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!mounted || presentation !== 'full') return;
    if (phase !== 'streaming' && phase !== 'done') return;
    const text = finalText ?? answer;
    if (!text) return;
    const handle = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: phase === 'streaming' });
    }, 16);
    return () => clearTimeout(handle);
  }, [mounted, phase, answer, finalText, presentation]);

  useEffect(() => {
    return () => {
      cancelRef.current = true;
      abortRef.current?.abort();
      leaseRef.current?.release();
      leaseRef.current = null;
    };
  }, []);

  /* eslint-disable react-hooks/refs -- pan handlers fire at event time */
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_evt, g) =>
          Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx) * 1.1,
        onPanResponderMove: (_evt, g) => {
          const mode = presentationRef.current;
          if (mode === 'full' && g.dy > 0) {
            dragY.setValue(g.dy);
          } else if (mode === 'mini') {
            // allow both directions while mini
            dragY.setValue(g.dy);
          }
        },
        onPanResponderRelease: (_evt, g) => {
          const mode = presentationRef.current;
          if (mode === 'full') {
            if (g.dy > DRAG_THRESHOLD || g.vy > 0.9) {
              if (allowMinimize) {
                dragY.setValue(0);
                minimize();
              } else {
                dragY.setValue(0);
                requestClose();
              }
            } else {
              Animated.spring(dragY, {
                toValue: 0,
                useNativeDriver: true,
                bounciness: 4,
              }).start();
            }
            return;
          }
          // mini
          if (g.dy < -DRAG_THRESHOLD || g.vy < -0.9) {
            dragY.setValue(0);
            expand();
          } else if (g.dy > DRAG_THRESHOLD || g.vy > 0.9) {
            dragY.setValue(0);
            requestClose();
          } else {
            Animated.spring(dragY, {
              toValue: 0,
              useNativeDriver: true,
              bounciness: 4,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 4,
          }).start();
        },
      }),
    [allowMinimize, minimize, expand, requestClose, dragY],
  );
  /* eslint-enable react-hooks/refs */

  const statusLabel = deriveStatusLabel(
    phase,
    source,
    activeModelId,
    currentModelId,
    error,
  );
  const statusTone = deriveStatusTone(phase, source);
  const inProgress =
    phase === 'loading' || phase === 'thinking' || phase === 'streaming';
  const isMini = presentation === 'mini';

  if (!mounted) return null;

  const sheetContent = (
    <Animated.View
      style={[
        styles.sheet,
        isMini && styles.sheetMini,
        {
          transform: [
            {
              translateY: Animated.add(sheetTranslateY, dragY),
            },
          ],
        },
      ]}
    >
      <View style={styles.dragArea} {...panResponder.panHandlers}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Pressable
            style={styles.titlePress}
            onPress={isMini ? expand : undefined}
            disabled={!isMini}
          >
            <Text style={styles.title} numberOfLines={isMini ? 1 : 2}>
              {title}
            </Text>
          </Pressable>
          <View style={styles.headerActions}>
            {allowMinimize && !isMini ? (
              <Pressable
                style={styles.iconButton}
                onPress={minimize}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Minimize Concierge"
              >
                <Text style={styles.iconButtonText}>–</Text>
              </Pressable>
            ) : null}
            {isMini ? (
              <Pressable
                style={styles.iconButton}
                onPress={expand}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Expand Concierge"
              >
                <Text style={styles.iconButtonText}>▴</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={styles.closeButton}
              onPress={requestClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close Concierge"
            >
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <View style={[styles.statusRow, { backgroundColor: statusTone.bg }]}>
        {inProgress ? (
          <ActivityIndicator color={statusTone.fg} size="small" />
        ) : (
          <View style={[styles.statusDot, { backgroundColor: statusTone.fg }]} />
        )}
        <Text style={[styles.statusText, { color: statusTone.fg }]} numberOfLines={2}>
          {statusLabel}
        </Text>
      </View>

      <Animated.View
        style={{
          maxHeight: bodyHeight,
          opacity: bodyOpacity,
          overflow: 'hidden',
        }}
        pointerEvents={isMini ? 'none' : 'auto'}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          <Text style={styles.answerLabel}>Concierge response</Text>

          {phase === 'error' ? (
            <Text style={styles.errorText}>
              Couldn&apos;t generate an explanation: {error}
            </Text>
          ) : null}

          {(phase === 'loading' || phase === 'thinking') && source !== 'cache' ? (
            <Text style={styles.thinkingText}>Thinking…</Text>
          ) : null}

          {phase === 'streaming' ? (
            <Text style={styles.streamingText}>{answer || '…'}</Text>
          ) : null}

          {phase === 'done' ? (
            finalText ? (
              <MarkdownRenderer size="large">{finalText}</MarkdownRenderer>
            ) : answer ? (
              <Text style={styles.answerText}>{answer}</Text>
            ) : (
              <Text style={styles.emptyText}>No response.</Text>
            )
          ) : null}

          {phase === 'done' && sourceLabels.length > 0 ? (
            <View style={styles.sourcesBlock}>
              <Pressable
                style={styles.sourcesToggle}
                onPress={() => setSourcesOpen((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded: sourcesOpen }}
                accessibilityLabel={`Sources, ${sourceLabels.length}`}
              >
                <Text style={styles.sourcesToggleText}>
                  Sources ({sourceLabels.length})
                </Text>
                <Text style={styles.sourcesChevron}>{sourcesOpen ? '▾' : '▸'}</Text>
              </Pressable>
              {sourcesOpen
                ? sourceLabels.map((label) => (
                    <Text key={label} style={styles.sourceRow}>
                      {'\u2022'} {label}
                    </Text>
                  ))
                : null}
            </View>
          ) : null}

          {phase === 'done' || phase === 'error' ? (
            <Pressable
              style={styles.regenerateButton}
              onPress={handleRegenerate}
              accessibilityRole="button"
              accessibilityLabel="Regenerate explanation"
            >
              <Text style={styles.regenerateButtonText}>Regenerate</Text>
            </Pressable>
          ) : null}
        </ScrollView>

        {phase === 'streaming' || phase === 'done' ? (
          <Text style={styles.footnote}>
            {source === 'cache'
              ? 'Saved explanation — still guidance, not a diagnosis. Confirm with the care team.'
              : 'Concierge guidance — not a diagnosis. Confirm with the care team.'}
          </Text>
        ) : null}
      </Animated.View>
    </Animated.View>
  );

  // When minimize is allowed, stay on one absolute overlay so full↔mini does not
  // remount (smooth height/opacity animation). Modal only when blocking.
  const overlay = (
    <View
      style={allowMinimize ? styles.miniHost : styles.overlay}
      pointerEvents={isMini ? 'box-none' : 'auto'}
    >
      <Animated.View
        style={[styles.backdropFill, { opacity: backdropOpacity }]}
        pointerEvents="none"
      />
      {!isMini ? (
        <Pressable
          style={styles.backdropHit}
          onPress={allowMinimize ? minimize : requestClose}
        />
      ) : null}
      {sheetContent}
    </View>
  );

  if (allowMinimize) {
    return overlay;
  }

  return (
    <Modal visible transparent animationType="none" onRequestClose={requestClose}>
      {overlay}
    </Modal>
  );
}

function deriveStatusLabel(
  phase: Phase,
  source: Source | null,
  activeModelId: string | null,
  currentModelId: string | null,
  error: string | null,
): string {
  if (source === 'cache' && phase === 'done') {
    return 'Saved explanation · unchanged since last run';
  }
  const modelId = activeModelId ?? currentModelId;
  const modelTag = modelId ? ` · ${modelId}` : '';
  switch (phase) {
    case 'idle':
      return 'Preparing…';
    case 'loading':
      return modelId ? `Loading model · ${modelId}…` : 'Loading Concierge…';
    case 'thinking':
      return `Thinking${modelTag}…`;
    case 'streaming':
      return `Generating${modelTag}…`;
    case 'done':
      return `Complete${modelTag}`;
    case 'error':
      return `Error: ${error ?? 'unknown'}`;
    default:
      return '';
  }
}

function deriveStatusTone(
  phase: Phase,
  source: Source | null,
): { fg: string; bg: string } {
  if (source === 'cache' && phase === 'done') {
    return { fg: AppTheme.colors.brandDark, bg: AppTheme.colors.brandSoft };
  }
  switch (phase) {
    case 'error':
      return { fg: AppTheme.colors.danger, bg: AppTheme.colors.dangerLight };
    case 'done':
      return { fg: AppTheme.colors.brandDark, bg: AppTheme.colors.brandSoft };
    default:
      return { fg: AppTheme.colors.brand, bg: AppTheme.colors.brandSoft };
  }
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdropFill: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  backdropHit: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    backgroundColor: AppTheme.colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    paddingBottom: 24,
  },
  sheetMini: {
    borderTopWidth: 1,
    borderColor: AppTheme.colors.border,
    ...AppTheme.shadow,
  },
  miniHost: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    zIndex: 50,
    elevation: 50,
  },
  dragArea: {
    paddingHorizontal: 20,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: AppTheme.colors.border,
    alignSelf: 'center',
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  titlePress: {
    flex: 1,
  },
  title: {
    color: AppTheme.colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: AppTheme.colors.softSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonText: {
    color: AppTheme.colors.textSoft,
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 20,
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
    marginHorizontal: 20,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '800',
    flex: 1,
  },
  body: {
    maxHeight: BODY_MAX_HEIGHT,
    paddingHorizontal: 20,
  },
  bodyContent: {
    paddingBottom: 12,
  },
  answerLabel: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  thinkingText: {
    color: AppTheme.colors.textMuted,
    fontSize: 14,
    fontStyle: 'italic',
  },
  streamingText: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  answerText: {
    color: AppTheme.colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  emptyText: {
    color: AppTheme.colors.textMuted,
    fontSize: 14,
    fontStyle: 'italic',
  },
  errorText: {
    color: AppTheme.colors.danger,
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: 8,
  },
  footnote: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  sourcesBlock: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
    paddingTop: 12,
  },
  sourcesToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  sourcesToggleText: {
    color: AppTheme.colors.brandDark,
    fontSize: 13,
    fontWeight: '900',
  },
  sourcesChevron: {
    color: AppTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: '900',
  },
  sourceRow: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
    fontWeight: '600',
  },
  regenerateButton: {
    marginTop: 16,
    alignSelf: 'flex-start',
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  regenerateButtonText: {
    color: AppTheme.colors.brandDark,
    fontSize: 13,
    fontWeight: '900',
  },
});

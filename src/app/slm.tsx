/**
 * Caregiver SLM chat screen.
 *
 * Combines Sebastian's service-layer context (onboarding profile, safety note,
 * download helper) with Ethan's streaming playground UX (model selector, memory
 * bar, markdown rendering, control-token stripping, stop/new-conversation).
 */

import { router } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
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

import { MarkdownRenderer } from '@/components/markdown-renderer';
import { MaxContentWidth } from '@/constants/theme';
import { usePatientRecord } from '@/contexts/patient-record-context';
import { useSLM } from '@/contexts/slm-context';
import { useTheme } from '@/hooks/use-theme';
import type { ChatMessage as ProviderChatMessage } from '@/inference/inference-provider';
import { MODEL_CATALOG } from '@/inference/model-catalog';
import { useMemoryInfo, isNativeMemoryAvailable } from '@/services/device-memory';
import { getOnboardingProfile } from '@/services/onboarding/onboardingService';
import {
  askCaregiverAssistantMock,
  buildCaregiverAssistantContextFromSnapshot,
  buildCaregiverSystemContext,
  CAREGIVER_SLM_MODEL_ID,
  downloadCaregiverSLMModel,
  isCaregiverSLMModelInstalled,
} from '@/services/slm/slmService';
import {
  retrieveClinicalChunks,
  formatCitationsForPrompt,
  messageHasClinicalKeywords,
} from '@/clinical-evidence/retrieval-helper';
import { isModelInstalled } from '@/services/model-storage';
import { stripControlTokens } from '@/utils/stripControlTokens';

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
      const answer = parsed.answer;

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
              }
            : m,
        ),
      };

    case 'append-token':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.payload.assistantId
            ? { ...m, text: m.text + action.payload.token }
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
  const profile = useMemo(() => getOnboardingProfile(), []);
  const { snapshot } = usePatientRecord();
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [inputText, setInputText] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [inputHeight, setInputHeight] = useState(PROMPT_INPUT_MIN_HEIGHT);

  const handleInputChange = useCallback((text: string) => {
    setInputText(text);
    setInputHeight(getPromptInputHeight(text));
  }, []);
  const abortControllerRef = useRef<AbortController | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const memoryInfo = useMemoryInfo(2000);
  const hasNativeMemory = isNativeMemoryAvailable();

  const caregiverContext = useMemo(
    () =>
      snapshot
        ? buildCaregiverAssistantContextFromSnapshot(snapshot)
        : {
            // Fallback to onboarding profile if snapshot not ready yet.
            patientName: profile.patient.name,
            patientAge: profile.patient.age,
            patientConditions: profile.patient.conditions,
            patientBaselineDailyRoutine:
              profile.patient.baselineDailyRoutine ?? 'No routine provided',
            patientCurrentMedications:
              profile.patient.currentMedications ?? 'No medications provided',
            patientSpo2Cutoff: profile.patient.spo2Cutoff,
            patientBaselineHeartRate: profile.patient.baselineHeartRate,
            caregiverName: profile.caregiver.name,
            caregiverRelationship: profile.caregiver.relationship,
            caregiverExperience: profile.caregiver.experience,
            caregiverAvailability: profile.caregiver.availability,
            caregiverLanguagePreference: profile.caregiver.languagePreference,
            caregiverMedicalComfortLevel: profile.caregiver.medicalComfortLevel,
            caregiverHobbiesOrRoutines: profile.caregiver.hobbiesOrRoutines,
            caregiverMainConcern:
              profile.caregiver.mainConcern ?? 'No active concern provided',
            caregiverStressOrSupportNeeds: profile.caregiver.stressOrSupportNeeds,
            caregiverBackup: profile.caregiver.backupCaregiver,
            primaryCareProviderName: profile.primaryCareProvider.name,
            primaryCareProviderPhone: profile.primaryCareProvider.phone,
            primaryCareProviderEmail: profile.primaryCareProvider.email,
            emergencyContact: profile.safety?.emergencyContact,
            safetyNotes: profile.safety?.safetyNotes,
          },
    [snapshot, profile],
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
            : 'Failed to download or load the native SLM model.';
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

    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      text: trimmed,
      finalText: trimmed,
      thinking: null,
      status: 'done',
      startedAt: Date.now(),
      finishedAt: Date.now(),
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
    };

    dispatch({ type: 'send-start', payload: { userMessage, assistantMessage } });
    setInputText('');

    // Mock fallback when no model is loaded.
    if (slm.loadStatus !== 'ready') {
      try {
        const response = await askCaregiverAssistantMock(trimmed, caregiverContext);
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
                : 'Something went wrong while asking the caregiver assistant.',
          },
        });
      }
      return;
    }

    const systemContext = buildCaregiverSystemContext(caregiverContext);
    const messages: ProviderChatMessage[] = [
      { role: 'system', content: systemContext },
      ...state.messages.map((m) => ({ role: m.role, content: m.text })),
      { role: 'user', content: trimmed },
    ];

    abortControllerRef.current = new AbortController();

    try {
      const result = await slm.chat(
        messages,
        (token) => {
          dispatch({
            type: 'append-token',
            payload: { assistantId: assistantMessage.id, token },
          });
        },
        abortControllerRef.current.signal,
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
  }, [inputText, state.runStatus, state.messages, slm, caregiverContext]);

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

    return (
      <View style={styles.assistantBubble}>
        {item.status === 'streaming' && (
          <Text style={[styles.streamingText, { color: theme.textSecondary }]}>
            {item.text || '...'}
          </Text>
        )}

        {(item.status === 'done' || item.status === 'stopped' || item.status === 'error') && (
          <>
            {item.finalText ? (
              <View style={styles.answerContainer}>
                <MarkdownRenderer size="large">{item.finalText}</MarkdownRenderer>
              </View>
            ) : (
              <Text style={[styles.answerText, { color: theme.text }]}>{item.text}</Text>
            )}
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

  const isInputDisabled = slm.loadStatus !== 'ready' && slm.loadStatus !== 'idle';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#EEF7F6' }]} edges={['top', 'bottom']}>
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
            <Text style={styles.headerTabTitle}>Assistant</Text>
          )}
          <Pressable onPress={handleNewConversation} style={styles.newConvButton}>
            <Text style={styles.newConvButtonText}>New conversation</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          <View style={styles.headerCard}>
            <Text style={styles.eyebrow}>Caregiver Assistant</Text>
            <Text style={styles.title}>SLM Support</Text>
            <Text style={styles.subtitle}>
              Ask practical questions using the caregiver profile and patient context.
            </Text>
          </View>

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
                    <Text style={styles.secondaryButtonText}>Unload Native SLM Model</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => handleLoadNativeModel(CAREGIVER_SLM_MODEL_ID)}
                    style={[styles.secondaryButton, isDownloading && styles.disabledButton]}
                    disabled={isDownloading}>
                    <Text style={styles.secondaryButtonText}>
                      {isDownloading
                        ? `Downloading${downloadProgress !== null ? ` ${downloadProgress}%` : ''}`
                        : 'Download / Load Native SLM Model'}
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
            <Text style={styles.contextSection}>Patient</Text>
            <Text style={styles.contextText}>
              {profile.patient.name} · age {profile.patient.age}
            </Text>
            <Text style={styles.contextText}>
              Conditions: {profile.patient.conditions}
            </Text>
            <Text style={styles.contextText}>
              Medications: {profile.patient.currentMedications ?? 'Not provided'}
            </Text>
            <Text style={styles.contextText}>
              Baseline routine: {profile.patient.baselineDailyRoutine ?? 'Not provided'}
            </Text>
            <Text style={styles.contextText}>
              SpO2 cutoff: {profile.patient.spo2Cutoff ?? '—'} · Baseline HR: {profile.patient.baselineHeartRate ?? '—'}
            </Text>

            <Text style={styles.contextSection}>Caregiver</Text>
            <Text style={styles.contextText}>
              {profile.caregiver.name} ({profile.caregiver.relationship}) · {profile.caregiver.experience ?? '—'} · {profile.caregiver.availability ?? '—'}
            </Text>
            <Text style={styles.contextText}>
              Language: {profile.caregiver.languagePreference ?? '—'} · Comfort: {profile.caregiver.medicalComfortLevel ?? '—'}
            </Text>
            <Text style={styles.contextText}>
              Active concern: {profile.caregiver.mainConcern ?? 'Not provided'}
            </Text>
            <Text style={styles.contextText}>
              Backup: {profile.caregiver.backupCaregiver ?? 'Not provided'}
            </Text>

            <Text style={styles.contextSection}>Care Team</Text>
            <Text style={styles.contextText}>
              {profile.primaryCareProvider.name} · {profile.primaryCareProvider.phone}
            </Text>

            {profile.safety ? (
              <>
                <Text style={styles.contextSection}>Safety</Text>
                <Text style={styles.contextText}>
                  Emergency contact: {profile.safety.emergencyContact ?? 'Not provided'}
                </Text>
                <Text style={styles.contextText}>
                  Notes: {profile.safety.safetyNotes ?? 'Not provided'}
                </Text>
              </>
            ) : null}
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
              This assistant is a caregiver support prototype and does not replace emergency care
              or professional medical advice.
            </Text>
          </View>
        </ScrollView>

        <View style={[styles.inputRow, { borderTopColor: theme.textSecondary + '30' }]}>
          <TextInput
            value={inputText}
            onChangeText={handleInputChange}
            placeholder="Ask the caregiver assistant..."
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
    padding: 20,
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
  headerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 22,
    marginBottom: 16,
  },
  eyebrow: {
    color: '#0E6F68',
    fontWeight: '800',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#123433',
    marginBottom: 8,
  },
  subtitle: {
    color: '#526866',
    fontSize: 15,
    lineHeight: 22,
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

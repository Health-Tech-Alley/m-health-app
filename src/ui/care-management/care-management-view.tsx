import { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { MODEL_CATALOG } from '@/inference/model-catalog';
import { isModelInstalled } from '@/services/model-storage';
import { useMemoryInfo, isNativeMemoryAvailable } from '@/services/device-memory';
import { SCENARIOS } from '@/ml-models/alert-autoencoder/mock-scenarios';
import { VITALS_RANGES } from '@/ml-models/alert-autoencoder/types';
import type { CoreVitals } from '@/ml-models/alert-autoencoder/types';
import type { SLMStatus } from '@/contexts/slm-context';
import type { CareManagementAction, CareManagementState } from './types';

type CareManagementViewProps = {
  state: CareManagementState;
  dispatch: (action: CareManagementAction) => void;
  controller: ReturnType<typeof import('./care-management-controller').createCareManagementController>;
  slmStatus: SLMStatus;
  slmModelId: string | null;
  slmModelSizeGB: number | null;
  slmLoadError: string | null;
  onLoadSLM: (modelId: string) => Promise<void>;
  onUnloadSLM: () => Promise<void>;
  mlModelLoaded: boolean;
};

export function CareManagementView({
  state,
  dispatch,
  controller,
  slmStatus,
  slmModelId,
  slmModelSizeGB,
  slmLoadError,
  onLoadSLM,
  onUnloadSLM,
  mlModelLoaded,
}: CareManagementViewProps) {
  const theme = useTheme();
  const memoryInfo = useMemoryInfo(2000);
  const hasNativeMemory = isNativeMemoryAvailable();
  const [scenarioPickerOpen, setScenarioPickerOpen] = useState(false);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);

  const installedModels = MODEL_CATALOG.filter(isModelInstalled);

  const handleScenarioSelect = useCallback(
    (scenarioId: string) => {
      const action = controller.selectScenario(scenarioId);
      dispatch(action);
      setScenarioPickerOpen(false);
    },
    [controller, dispatch],
  );

  const handleVitalsChange = useCallback(
    (field: keyof CoreVitals, text: string) => {
      const num = parseFloat(text);
      if (!isNaN(num)) {
        dispatch(controller.updateVitals(field, num));
      }
    },
    [controller, dispatch],
  );

  const handleRunML = useCallback(() => {
    const action = controller.runMLInference(state);
    dispatch(action);
  }, [controller, state, dispatch]);

  const handleAskSLM = useCallback(() => {
    const action = controller.requestSLMExplanation(state, () => Promise.resolve(null));
    dispatch(action);
  }, [controller, state, dispatch]);

  const handleStopSLM = useCallback(() => {
    controller.stopSLM();
  }, [controller]);

  const handleReset = useCallback(() => {
    dispatch(controller.reset());
  }, [controller, dispatch]);

  const selectedScenario = SCENARIOS.find((s) => s.id === state.selectedScenarioId);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
        <KeyboardAvoidingView
          style={styles.keyboardView}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 120 : 0}>
          <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
            <View style={styles.headerRow}>
              <ThemedText type="subtitle">Care Management</ThemedText>
              <Pressable onPress={handleReset} style={styles.resetButton}>
                <ThemedText type="small">Reset</ThemedText>
              </Pressable>
            </View>

            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="smallBold" style={styles.sectionTitle}>SLM Model</ThemedText>
              <View style={styles.slmRow}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.modelChips}>
                  {installedModels.length === 0 ? (
                    <ThemedText type="small" themeColor="textSecondary">No models installed</ThemedText>
                  ) : (
                    installedModels.map((entry) => (
                      <Pressable
                        key={entry.id}
                        onPress={() => onLoadSLM(entry.id)}
                        disabled={slmStatus === 'loading'}
                        style={[
                          styles.chip,
                          slmModelId === entry.id && styles.chipSelected,
                          {
                            borderColor: slmModelId === entry.id ? '#3c87f7' : theme.textSecondary + '30',
                            backgroundColor: slmModelId === entry.id ? '#3c87f7' : theme.backgroundElement,
                          },
                        ]}>
                        <ThemedText
                          type="small"
                          style={{
                            color: slmModelId === entry.id ? '#ffffff' : theme.text,
                            fontWeight: slmModelId === entry.id ? '600' : '400',
                          }}>
                          {entry.displayName}
                        </ThemedText>
                      </Pressable>
                    ))
                  )}
                </ScrollView>
                {slmModelId ? (
                  <Pressable
                    onPress={() => onUnloadSLM()}
                    style={[styles.slmButton, { backgroundColor: '#d9534f' }]}>
                    <ThemedText style={{ color: '#ffffff', fontWeight: '600' }}>Unload</ThemedText>
                  </Pressable>
                ) : null}
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {slmStatus === 'idle' && 'No model loaded'}
                {slmStatus === 'loading' && 'Loading model\u2026'}
                {slmStatus === 'ready' && `Ready \u2014 ${slmModelId ? MODEL_CATALOG.find((m) => m.id === slmModelId)?.displayName : ''}`}
                {slmStatus === 'error' && `Error: ${slmLoadError ?? 'Unknown'}`}
              </ThemedText>
              {memoryInfo && (slmStatus === 'ready' || slmStatus === 'loading') && (
                <View style={styles.memoryBar}>
                  <View style={styles.memoryHeader}>
                    <ThemedText type="small" themeColor="textSecondary">Device RAM</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.monoText}>
                      {memoryInfo.usedMB.toFixed(0)} / {memoryInfo.totalMB.toFixed(0)} MB
                    </ThemedText>
                  </View>
                  <View style={styles.progressBarBg}>
                    <View
                      style={[
                        styles.progressBarFill,
                        {
                          width: `${Math.min((memoryInfo.usedMB / memoryInfo.totalMB) * 100, 100)}%`,
                          backgroundColor: memoryInfo.usedMB / memoryInfo.totalMB > 0.8 ? '#d9534f' : '#3c87f7',
                        },
                      ]}
                    />
                  </View>
                  <View style={styles.memoryDetails}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Free: {memoryInfo.freeMB.toFixed(0)} MB
                    </ThemedText>
                    {slmModelSizeGB !== null && (
                      <ThemedText type="small" themeColor="textSecondary">
                        Model: {slmModelSizeGB.toFixed(2)} GB
                      </ThemedText>
                    )}
                    {hasNativeMemory && (
                      <ThemedText type="small" themeColor="textSecondary">
                        App: {memoryInfo.appMB.toFixed(0)} MB
                      </ThemedText>
                    )}
                  </View>
                </View>
              )}
            </ThemedView>

            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="smallBold" style={styles.sectionTitle}>Scenario</ThemedText>
              <Pressable
                onPress={() => setScenarioPickerOpen(!scenarioPickerOpen)}
                style={[styles.scenarioButton, { borderColor: theme.textSecondary + '30' }]}>
                <ThemedText type="small">
                  {selectedScenario ? selectedScenario.name : 'Select a scenario\u2026'}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {scenarioPickerOpen ? '\u25B2' : '\u25BC'}
                </ThemedText>
              </Pressable>
              {scenarioPickerOpen && (
                <View style={styles.scenarioList}>
                  {SCENARIOS.map((scenario) => (
                    <Pressable
                      key={scenario.id}
                      onPress={() => handleScenarioSelect(scenario.id)}
                      style={[
                        styles.scenarioItem,
                        state.selectedScenarioId === scenario.id && { backgroundColor: '#3c87f720' },
                      ]}>
                      <ThemedText type="smallBold">{scenario.name}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {scenario.description}
                      </ThemedText>
                      <ThemedText
                        type="small"
                        style={{ color: scenario.expectedAnomaly ? '#d9534f' : '#5cb85c' }}>
                        {scenario.expectedAnomaly ? 'Expected: Anomalous' : 'Expected: Normal'}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
              )}
            </ThemedView>

            {state.coreVitals && (
              <ThemedView type="backgroundElement" style={styles.section}>
                <ThemedText type="smallBold" style={styles.sectionTitle}>Vitals Input</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.editHint}>
                  Edit values below, then run ML inference
                </ThemedText>
                <View style={styles.vitalsGrid}>
                  {(Object.entries(VITALS_RANGES) as [keyof CoreVitals, typeof VITALS_RANGES[keyof CoreVitals]][]).map(
                    ([field, range]) => (
                      <View key={field} style={styles.vitalsField}>
                        <ThemedText type="small" themeColor="textSecondary">
                          {range.label}
                        </ThemedText>
                        <View style={styles.vitalsInputRow}>
                          <TextInput
                            value={String(state.coreVitals![field])}
                            onChangeText={(text) => handleVitalsChange(field, text)}
                            keyboardType="numeric"
                            style={[
                              styles.vitalsInput,
                              {
                                color: theme.text,
                                backgroundColor: theme.background,
                                borderColor: theme.textSecondary + '30',
                              },
                            ]}
                          />
                          <ThemedText type="small" themeColor="textSecondary">
                            {range.unit}
                          </ThemedText>
                        </View>
                        <ThemedText type="small" themeColor="textSecondary" style={styles.rangeHint}>
                          {range.min}\u2013{range.max}
                        </ThemedText>
                      </View>
                    ),
                  )}
                </View>

                <Pressable
                  onPress={handleRunML}
                  disabled={state.mlStatus === 'running' || !mlModelLoaded}
                  style={[
                    styles.primaryButton,
                    {
                      backgroundColor:
                        state.mlStatus === 'running' || !mlModelLoaded
                          ? theme.textSecondary + '40'
                          : '#3c87f7',
                    },
                  ]}>
                  <ThemedText style={{ color: '#ffffff', fontWeight: '600' }}>
                    {state.mlStatus === 'running'
                      ? 'Running\u2026'
                      : !mlModelLoaded
                        ? 'ML Model Loading\u2026'
                        : 'Run ML Inference'}
                  </ThemedText>
                </Pressable>
              </ThemedView>
            )}

            {state.mlStatus === 'error' && state.mlError && (
              <ThemedView type="backgroundElement" style={styles.section}>
                <ThemedText type="small" style={{ color: '#d9534f' }}>
                  ML Error: {state.mlError}
                </ThemedText>
              </ThemedView>
            )}

            {state.mlResult && (
              <ThemedView type="backgroundElement" style={styles.section}>
                <ThemedText type="smallBold" style={styles.sectionTitle}>ML Results</ThemedText>
                <View style={styles.mlResultRow}>
                  <View>
                    <ThemedText type="small" themeColor="textSecondary">Anomaly Score</ThemedText>
                    <ThemedText style={styles.monoText}>
                      {state.mlResult.anomalyScore.toFixed(3)}
                    </ThemedText>
                  </View>
                  <View>
                    <ThemedText type="small" themeColor="textSecondary">Threshold</ThemedText>
                    <ThemedText style={styles.monoText}>1.130</ThemedText>
                  </View>
                  <View
                    style={[
                      styles.anomalyBadge,
                      {
                        backgroundColor: state.mlResult.isAnomalous ? '#d9534f' : '#5cb85c',
                      },
                    ]}>
                    <ThemedText style={{ color: '#ffffff', fontWeight: '600' }}>
                      {state.mlResult.isAnomalous ? 'ANOMALOUS' : 'NORMAL'}
                    </ThemedText>
                  </View>
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  Reconstruction Error: {state.mlResult.reconstructionError.toFixed(3)}
                </ThemedText>

                {state.mlResult.isAnomalous && state.slmStatus !== 'streaming' && (
                  <Pressable
                    onPress={handleAskSLM}
                    disabled={slmStatus !== 'ready'}
                    style={[
                      styles.primaryButton,
                      {
                        backgroundColor: slmStatus === 'ready' ? '#3c87f7' : theme.textSecondary + '40',
                        marginTop: Spacing.two,
                      },
                    ]}>
                    <ThemedText style={{ color: '#ffffff', fontWeight: '600' }}>
                      {slmStatus === 'ready' ? 'Ask SLM to Explain' : 'Load SLM to Explain'}
                    </ThemedText>
                  </Pressable>
                )}
              </ThemedView>
            )}

            {(state.slmStatus === 'streaming' || state.slmStatus === 'done' || state.slmStatus === 'error') && (
              <ThemedView type="backgroundElement" style={styles.section}>
                <View style={styles.slmHeader}>
                  <ThemedText type="smallBold" style={styles.sectionTitle}>SLM Explanation</ThemedText>
                  {state.slmStatus === 'streaming' && (
                    <Pressable onPress={handleStopSLM} style={[styles.stopButton]}>
                      <ThemedText style={{ color: '#ffffff', fontWeight: '600' }}>Stop</ThemedText>
                    </Pressable>
                  )}
                </View>

                {state.slmStatus === 'streaming' && !state.slmExplanation && (
                  <ThemedText style={styles.slmText}>...</ThemedText>
                )}

                {state.slmStatus === 'done' && state.slmFinalExplanation && (
                  <>
                    <MarkdownRenderer size="large">{state.slmFinalExplanation}</MarkdownRenderer>

                    {state.slmThinking && (
                      <View style={styles.thinkingSection}>
                        <Pressable
                          onPress={() => setThinkingExpanded(!thinkingExpanded)}
                          style={styles.thinkingToggle}>
                          <ThemedText type="small" themeColor="textSecondary">
                            {thinkingExpanded ? '▼' : '▶'} Show reasoning process
                          </ThemedText>
                        </Pressable>
                        {thinkingExpanded && (
                          <View style={styles.thinkingContent}>
                            <MarkdownRenderer>{state.slmThinking}</MarkdownRenderer>
                          </View>
                        )}
                      </View>
                    )}
                  </>
                )}

                {state.slmStatus === 'done' && !state.slmFinalExplanation && state.slmExplanation && (
                  <MarkdownRenderer size="large">{state.slmExplanation}</MarkdownRenderer>
                )}

                {state.slmError && (
                  <ThemedText type="small" style={{ color: '#d9534f', marginTop: Spacing.one }}>
                    {state.slmError}
                  </ThemedText>
                )}
              </ThemedView>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.four,
    gap: Spacing.three,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  resetButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  section: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.two,
  },
  sectionTitle: {
    marginBottom: Spacing.half,
  },
  slmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  modelChips: {
    flex: 1,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    marginRight: Spacing.two,
  },
  chipSelected: {
    backgroundColor: '#3c87f7',
    borderColor: '#3c87f7',
  },
  slmButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    minWidth: 70,
    alignItems: 'center',
  },
  memoryBar: {
    gap: Spacing.one,
    marginTop: Spacing.one,
  },
  memoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  memoryDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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
  scenarioButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  scenarioList: {
    gap: Spacing.one,
  },
  scenarioItem: {
    padding: Spacing.two,
    borderRadius: Spacing.two,
    gap: Spacing.half,
  },
  editHint: {
    fontStyle: 'italic',
  },
  vitalsGrid: {
    gap: Spacing.two,
  },
  vitalsField: {
    gap: Spacing.half,
  },
  vitalsInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  vitalsInput: {
    flex: 1,
    height: 40,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rangeHint: {
    fontSize: 11,
  },
  primaryButton: {
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  mlResultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  anomalyBadge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.one,
  },
  monoText: {
    fontFamily: 'monospace',
  },
  slmHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  slmText: {
    lineHeight: 22,
  },
  stopButton: {
    backgroundColor: '#d9534f',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
  },
  thinkingSection: {
    marginTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#88888830',
    paddingTop: Spacing.two,
  },
  thinkingToggle: {
    paddingVertical: Spacing.one,
  },
  thinkingContent: {
    marginTop: Spacing.two,
    padding: Spacing.two,
    backgroundColor: '#88888810',
    borderRadius: Spacing.two,
  },
});

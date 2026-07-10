import { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MarkdownRenderer } from '@/components/markdown-renderer';
import { ObservationPicker } from '@/components/ObservationPicker';
import { AppTheme, MaxContentWidth, Spacing } from '@/constants/theme';
import { MODEL_CATALOG } from '@/inference/model-catalog';
import { SCENARIOS } from '@/ml-models/alert-autoencoder/mock-scenarios';
import { VITALS_RANGES } from '@/ml-models/alert-autoencoder/types';
import type { CoreVitals } from '@/ml-models/alert-autoencoder/types';
import type { CaregiverFinalAction } from '@/ml-models/uc2-decision-layer';
import { isModelInstalled } from '@/services/model-storage';
import { useMemoryInfo, isNativeMemoryAvailable } from '@/services/device-memory';
import type { SLMStatus } from '@/contexts/slm-context';

import { BatchParityRunner } from './batch-parity-runner';
import { DecisionResultPanel } from './decision-result-panel';
import { UC2FeatureInput } from './uc2-feature-input';
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

const CAREGIVER_ACTIONS: { id: CaregiverFinalAction; label: string }[] = [
  { id: 'no_prompt_shown', label: 'No prompt' },
  { id: 'confirm_concern', label: 'Confirm concern' },
  { id: 'continue_monitoring', label: 'Continue monitoring' },
  { id: 'dismiss', label: 'Dismiss' },
];

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
  const memoryInfo = useMemoryInfo(2000);
  const hasNativeMemory = isNativeMemoryAvailable();
  const [scenarioPickerOpen, setScenarioPickerOpen] = useState(false);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);

  const installedModels = MODEL_CATALOG.filter(isModelInstalled);
  const running = state.mlStatus === 'running';
  const [advancedEditor, setAdvancedEditor] = useState(false);

  const handleScenarioSelect = useCallback(
    (scenarioId: string) => {
      dispatch(controller.selectScenario(scenarioId));
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
    dispatch(controller.runMLInference(state));
  }, [controller, state, dispatch]);

  const handleApplyHITL = useCallback(() => {
    dispatch({ type: 'hitl-apply' });
  }, [dispatch]);

  const handleAskSLM = useCallback(() => {
    dispatch(controller.requestSLMExplanation(state));
  }, [controller, state, dispatch]);

  const handleStopSLM = useCallback(() => {
    controller.stopSLM();
  }, [controller]);

  const handleClearSLM = useCallback(() => {
    dispatch({ type: 'slm-clear' });
  }, [dispatch]);

  const handleReset = useCallback(() => {
    dispatch(controller.reset());
  }, [controller, dispatch]);

  const selectedScenario = SCENARIOS.find((s) => s.id === state.selectedScenarioId);
  const uc2 = state.uc2Result;
  const hitlApplicable =
    !!uc2 && !uc2.emergencyResult.emergency && uc2.promptShown;
  const hitlUnavailableMessage = !uc2
    ? ''
    : uc2.emergencyResult.emergency
      ? 'HITL not applicable — emergency fast path bypassed the prompt.'
      : !uc2.isAnomaly
        ? 'No caregiver prompt was shown for this result (not anomalous).'
        : 'Anomaly detected, but no caregiver prompt was shown for this run.';

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
        <KeyboardAvoidingView
          style={styles.keyboardView}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 120 : 0}>
          <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
            <View style={styles.headerRow}>
              <Text style={styles.title}>Care Analysis</Text>
              <Pressable onPress={handleReset} style={styles.resetButton}>
                <Text style={styles.resetText}>Reset</Text>
              </Pressable>
            </View>
            <Text style={styles.subtitle}>
              Run the full UC2 decision layer (rule engine → ML → contextual
              routing → caregiver HITL → final decision) on simulated
              scenarios and inspect every stage.
            </Text>

            {/* Concierge model */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Concierge model</Text>
              <View style={styles.slmRow}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.modelChips}>
                  {installedModels.length === 0 ? (
                    <Text style={styles.muted}>No models installed</Text>
                  ) : (
                    installedModels.map((entry) => {
                      const selected = slmModelId === entry.id;
                      return (
                        <Pressable
                          key={entry.id}
                          onPress={() => onLoadSLM(entry.id)}
                          disabled={slmStatus === 'loading'}
                          style={[
                            styles.chip,
                            selected && styles.chipSelected,
                          ]}>
                          <Text
                            style={[
                              styles.chipText,
                              selected && styles.chipTextSelected,
                            ]}>
                            {entry.displayName}
                          </Text>
                        </Pressable>
                      );
                    })
                  )}
                </ScrollView>
                {slmModelId ? (
                  <Pressable onPress={() => onUnloadSLM()} style={styles.unloadButton}>
                    <Text style={styles.unloadText}>Unload</Text>
                  </Pressable>
                ) : null}
              </View>
              <Text style={styles.muted}>
                {slmStatus === 'idle' && 'No model loaded'}
                {slmStatus === 'loading' && 'Loading model\u2026'}
                {slmStatus === 'ready' && `Ready \u2014 ${slmModelId ? MODEL_CATALOG.find((m) => m.id === slmModelId)?.displayName : ''}`}
                {slmStatus === 'error' && `Error: ${slmLoadError ?? 'Unknown'}`}
              </Text>
              {memoryInfo && (slmStatus === 'ready' || slmStatus === 'loading') && (
                <View style={styles.memoryBar}>
                  <View style={styles.memoryHeader}>
                    <Text style={styles.muted}>Device RAM</Text>
                    <Text style={styles.monoMuted}>
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
                            memoryInfo.usedMB / memoryInfo.totalMB > 0.8
                              ? AppTheme.colors.danger
                              : AppTheme.colors.brand,
                        },
                      ]}
                    />
                  </View>
                  <View style={styles.memoryDetails}>
                    <Text style={styles.muted}>Free: {memoryInfo.freeMB.toFixed(0)} MB</Text>
                    {slmModelSizeGB !== null && (
                      <Text style={styles.muted}>Model: {slmModelSizeGB.toFixed(2)} GB</Text>
                    )}
                    {hasNativeMemory && (
                      <Text style={styles.muted}>App: {memoryInfo.appMB.toFixed(0)} MB</Text>
                    )}
                  </View>
                </View>
              )}
            </View>

            {/* Scenario */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Scenario</Text>
              <Pressable
                onPress={() => setScenarioPickerOpen(!scenarioPickerOpen)}
                style={styles.scenarioButton}>
                <Text style={styles.scenarioButtonText}>
                  {selectedScenario ? selectedScenario.name : 'Select a scenario\u2026'}
                </Text>
                <Text style={styles.muted}>
                  {scenarioPickerOpen ? '\u25B2' : '\u25BC'}
                </Text>
              </Pressable>
              {scenarioPickerOpen && (
                <View style={styles.scenarioList}>
                  {SCENARIOS.map((scenario) => {
                    const active = state.selectedScenarioId === scenario.id;
                    return (
                      <Pressable
                        key={scenario.id}
                        onPress={() => handleScenarioSelect(scenario.id)}
                        style={[styles.scenarioItem, active && styles.scenarioItemActive]}>
                        <Text style={styles.scenarioName}>{scenario.name}</Text>
                        <Text style={styles.muted}>{scenario.description}</Text>
                        <View style={styles.scenarioTags}>
                          <Text style={styles.scenarioTag}>{scenario.expectedPipelinePath}</Text>
                          {scenario.expectedEmergencyReason && (
                            <Text style={[styles.scenarioTag, styles.scenarioTagDanger]}>
                              {scenario.expectedEmergencyReason}
                            </Text>
                          )}
                          {scenario.missingFields && scenario.missingFields.length > 0 && (
                            <Text style={[styles.scenarioTag, styles.scenarioTagWarn]}>
                              imputation
                            </Text>
                          )}
                          <Text
                            style={[
                              styles.scenarioTag,
                              scenario.expectedAnomaly ? styles.scenarioTagDanger : styles.scenarioTagOk,
                            ]}>
                            {scenario.expectedAnomaly ? 'anomalous' : 'normal'}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>

            {/* Vitals input — simple (core 6) or advanced (all 18 + time-of-day) */}
            {state.coreVitals && state.extendedVitals && (
              <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>Vitals Input</Text>
                  <View style={styles.toggleRow}>
                    <Text style={styles.muted}>Advanced</Text>
                    <Switch
                      value={advancedEditor}
                      onValueChange={setAdvancedEditor}
                      trackColor={{ false: AppTheme.colors.chip, true: AppTheme.colors.brand }}
                    />
                  </View>
                </View>

                {advancedEditor ? (
                  <UC2FeatureInput
                    extended={state.extendedVitals}
                    hour={state.hour}
                    missingFields={state.missingFields}
                    onUpdateField={(field, value) =>
                      dispatch(controller.updateExtended(field, value))
                    }
                    onToggleMissing={(field) => dispatch(controller.toggleMissing(field))}
                    onSetHour={(hour) => dispatch(controller.setHour(hour))}
                  />
                ) : (
                  <>
                    <Text style={styles.editHint}>
                      Edit the core vitals below, then run the UC2 decision
                      layer. Toggle Advanced to edit all 18 features + time of
                      day and to mark fields missing for imputation testing.
                    </Text>
                    <View style={styles.vitalsGrid}>
                      {(Object.entries(VITALS_RANGES) as [keyof CoreVitals, typeof VITALS_RANGES[keyof CoreVitals]][]).map(
                        ([field, range]) => (
                          <View key={field} style={styles.vitalsField}>
                            <Text style={styles.muted}>{range.label}</Text>
                            <View style={styles.vitalsInputRow}>
                              <TextInput
                                value={String(state.coreVitals![field])}
                                onChangeText={(text) => handleVitalsChange(field, text)}
                                keyboardType="numeric"
                                style={styles.vitalsInput}
                              />
                              <Text style={styles.muted}>{range.unit}</Text>
                            </View>
                            <Text style={styles.rangeHint}>{range.min}\u2013{range.max}</Text>
                          </View>
                        ),
                      )}
                    </View>
                  </>
                )}

                {/* Publish-to-Concierge toggle */}
                <View style={styles.publishRow}>
                  <View style={styles.publishLabelBlock}>
                    <Text style={styles.publishLabel}>Publish to Concierge</Text>
                    <Text style={styles.muted}>
                      Creates a real alert + notification from this run.
                    </Text>
                  </View>
                  <Switch
                    value={state.publishToOrchestrator}
                    onValueChange={(v) => dispatch(controller.setPublish(v))}
                    trackColor={{ false: AppTheme.colors.chip, true: AppTheme.colors.brand }}
                  />
                </View>

                <Pressable
                  onPress={handleRunML}
                  disabled={running || !mlModelLoaded}
                  style={[
                    styles.primaryButton,
                    (running || !mlModelLoaded) && styles.primaryButtonDisabled,
                  ]}>
                  <Text style={styles.primaryButtonText}>
                    {running
                      ? 'Running\u2026'
                      : !mlModelLoaded
                        ? 'ML Model Loading\u2026'
                        : 'Run UC2 decision layer'}
                  </Text>
                </Pressable>
              </View>
            )}

            {/* Batch parity runner */}
            <View style={styles.section}>
              <BatchParityRunner
                running={state.batchRunning}
                rows={state.batchRows}
                onRun={() => dispatch({ type: 'batch-start' })}
              />
            </View>

            {/* Error */}
            {state.mlStatus === 'error' && state.mlError && (
              <View style={styles.section}>
                <Text style={styles.errorText}>ML Error: {state.mlError}</Text>
              </View>
            )}

            {/* UC2 decision result */}
            {uc2 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>UC2 Decision Result</Text>
                <DecisionResultPanel
                  result={uc2}
                  initialResult={state.initialUc2Result}
                />
              </View>
            )}

            {/* Caregiver Review simulator */}
            {uc2 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Caregiver Review</Text>
                {hitlApplicable ? (
                  <>
                    <Text style={styles.editHint}>
                      Simulate caregiver ground truth, then apply to reclassify
                      the anomaly type and recompute the final decision.
                    </Text>
                    <ObservationPicker
                      selected={state.observationCodes}
                      onChange={(codes) => dispatch(controller.setObservationCodes(codes))}
                    />
                    <Text style={styles.pickerLabel}>Caregiver action</Text>
                    <View style={styles.actionRow}>
                      {CAREGIVER_ACTIONS.map((a) => {
                        const selected = state.caregiverAction === a.id;
                        return (
                          <Pressable
                            key={a.id}
                            onPress={() => dispatch(controller.setCaregiverAction(a.id))}
                            style={[
                              styles.actionChip,
                              selected && styles.actionChipSelected,
                            ]}>
                            <Text
                              style={[
                                styles.actionChipText,
                                selected && styles.actionChipTextSelected,
                              ]}>
                              {a.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Pressable
                      onPress={handleApplyHITL}
                      disabled={running}
                      style={[styles.primaryButton, running && styles.primaryButtonDisabled]}>
                      <Text style={styles.primaryButtonText}>
                        {running ? 'Applying\u2026' : 'Apply Review'}
                      </Text>
                    </Pressable>
                  </>
                ) : (
                  <Text style={styles.muted}>{hitlUnavailableMessage}</Text>
                )}
              </View>
            )}

            {/* Concierge explanation */}
            {(state.slmStatus === 'streaming' || state.slmStatus === 'done' || state.slmStatus === 'error') && (
              <View style={styles.section}>
                <View style={styles.slmHeader}>
                  <Text style={styles.sectionTitle}>Concierge explanation</Text>
                  {state.slmStatus === 'streaming' && (
                    <Pressable onPress={handleStopSLM} style={styles.stopButton}>
                      <Text style={styles.stopText}>Stop</Text>
                    </Pressable>
                  )}
                  {(state.slmStatus === 'done' || state.slmStatus === 'error') && (
                    <Pressable onPress={handleClearSLM} style={styles.clearButton}>
                      <Text style={styles.clearText}>Clear</Text>
                    </Pressable>
                  )}
                </View>

                {state.slmStatus === 'streaming' ? (
                  state.slmExplanation ? (
                    <Text style={styles.streamingText}>{state.slmExplanation}</Text>
                  ) : (
                    <Text style={styles.muted}>Thinking\u2026</Text>
                  )
                ) : null}

                {state.slmStatus === 'done' && state.slmFinalExplanation && (
                  <>
                    <MarkdownRenderer size="large">{state.slmFinalExplanation}</MarkdownRenderer>
                    {state.slmThinking && (
                      <View style={styles.thinkingSection}>
                        <Pressable
                          onPress={() => setThinkingExpanded(!thinkingExpanded)}
                          style={styles.thinkingToggle}>
                          <Text style={styles.muted}>
                            {thinkingExpanded ? '\u25BC' : '\u25B6'} Show reasoning process
                          </Text>
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
                  <Text style={styles.errorText}>{state.slmError}</Text>
                )}
              </View>
            )}

            {/* Ask Concierge entry point */}
            {uc2 && state.slmStatus === 'idle' && (
              <Pressable
                onPress={handleAskSLM}
                disabled={slmStatus !== 'ready'}
                style={[
                  styles.primaryButton,
                  slmStatus !== 'ready' && styles.primaryButtonDisabled,
                ]}>
                <Text style={styles.primaryButtonText}>
                  {slmStatus === 'ready' ? 'Ask Concierge to explain' : 'Load Concierge to explain'}
                </Text>
              </Pressable>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: AppTheme.colors.screen,
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
  title: {
    fontSize: 26,
    fontWeight: '900',
    color: AppTheme.colors.text,
  },
  subtitle: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 19,
  },
  resetButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: AppTheme.radius.md,
    backgroundColor: AppTheme.colors.chip,
  },
  resetText: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  section: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.lg,
    padding: Spacing.three,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
  },
  sectionTitle: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  publishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    marginTop: 4,
  },
  publishLabelBlock: {
    flex: 1,
    gap: 2,
  },
  publishLabel: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  muted: {
    color: AppTheme.colors.textMuted,
    fontSize: 13,
  },
  monoMuted: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontFamily: 'monospace',
  },
  errorText: {
    color: AppTheme.colors.danger,
    fontSize: 13,
    fontWeight: '700',
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
    borderRadius: AppTheme.radius.pill,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.chip,
    marginRight: Spacing.two,
  },
  chipSelected: {
    backgroundColor: AppTheme.colors.brand,
    borderColor: AppTheme.colors.brand,
  },
  chipText: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextSelected: {
    color: AppTheme.colors.white,
    fontWeight: '800',
  },
  unloadButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: AppTheme.radius.md,
    backgroundColor: AppTheme.colors.danger,
    minWidth: 70,
    alignItems: 'center',
  },
  unloadText: {
    color: AppTheme.colors.white,
    fontWeight: '800',
    fontSize: 13,
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
    backgroundColor: AppTheme.colors.border,
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
    borderRadius: AppTheme.radius.md,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.chip,
  },
  scenarioButtonText: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  scenarioList: {
    gap: Spacing.one,
  },
  scenarioItem: {
    padding: Spacing.two,
    borderRadius: AppTheme.radius.md,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    gap: 2,
  },
  scenarioItemActive: {
    borderColor: AppTheme.colors.brand,
    backgroundColor: AppTheme.colors.brandSoft,
  },
  scenarioName: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  scenarioTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  scenarioTag: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: AppTheme.colors.textMuted,
    backgroundColor: AppTheme.colors.chip,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: AppTheme.radius.sm,
  },
  scenarioTagDanger: {
    color: AppTheme.colors.danger,
    backgroundColor: AppTheme.colors.dangerLight,
  },
  scenarioTagWarn: {
    color: AppTheme.colors.warning,
    backgroundColor: AppTheme.colors.warningSoft,
  },
  scenarioTagOk: {
    color: AppTheme.colors.brand,
    backgroundColor: AppTheme.colors.brandSoft,
  },
  editHint: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
  },
  vitalsGrid: {
    gap: Spacing.two,
  },
  vitalsField: {
    gap: 2,
  },
  vitalsInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  vitalsInput: {
    flex: 1,
    height: 40,
    borderRadius: AppTheme.radius.md,
    paddingHorizontal: Spacing.three,
    fontSize: 15,
    color: AppTheme.colors.text,
    backgroundColor: AppTheme.colors.screen,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
  },
  rangeHint: {
    fontSize: 11,
    color: AppTheme.colors.textMuted,
  },
  primaryButton: {
    paddingVertical: Spacing.three,
    borderRadius: AppTheme.radius.md,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
    backgroundColor: AppTheme.colors.brand,
    marginTop: 4,
  },
  primaryButtonDisabled: {
    backgroundColor: AppTheme.colors.chip,
  },
  primaryButtonText: {
    color: AppTheme.colors.white,
    fontWeight: '800',
    fontSize: 15,
  },
  pickerLabel: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 4,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  actionChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: AppTheme.radius.pill,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.chip,
  },
  actionChipSelected: {
    backgroundColor: AppTheme.colors.brand,
    borderColor: AppTheme.colors.brand,
  },
  actionChipText: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    fontWeight: '700',
  },
  actionChipTextSelected: {
    color: AppTheme.colors.white,
    fontWeight: '800',
  },
  slmHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stopButton: {
    backgroundColor: AppTheme.colors.danger,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: AppTheme.radius.md,
  },
  stopText: {
    color: AppTheme.colors.white,
    fontWeight: '800',
    fontSize: 13,
  },
  clearButton: {
    backgroundColor: AppTheme.colors.chip,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: AppTheme.radius.md,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
  },
  clearText: {
    color: AppTheme.colors.textSoft,
    fontWeight: '800',
    fontSize: 13,
  },
  streamingText: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    lineHeight: 21,
    fontStyle: 'italic',
  },
  thinkingSection: {
    marginTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: AppTheme.colors.border,
    paddingTop: Spacing.two,
  },
  thinkingToggle: {
    paddingVertical: Spacing.one,
  },
  thinkingContent: {
    marginTop: Spacing.two,
    padding: Spacing.two,
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: AppTheme.radius.md,
  },
});

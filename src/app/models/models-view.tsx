import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { SlmModelCarousel } from '@/components/models/SlmModelCarousel';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AppTheme, MaxContentWidth, Spacing } from '@/constants/theme';
import { useSettings } from '@/contexts/settings-context';
import { useTheme } from '@/hooks/use-theme';
import { useModelDownloadQueue } from '@/hooks/useModelDownloadQueue';
import { MODEL_CATALOG, resolveActiveModelId } from '@/inference/model-catalog';
import type { ModelsState } from './types';

type ModelsViewProps = {
  state: ModelsState;
  dispatch: (action: import('./types').ModelsAction) => void;
  controller: ReturnType<typeof import('./models-controller').createModelsController>;
  onBack: () => void;
};

export function ModelsView({ state, dispatch, controller, onBack }: ModelsViewProps) {
  const theme = useTheme();
  const { settings, setDemoDefaultModelId } = useSettings();
  const queue = useModelDownloadQueue();
  // Effective default — a single installed model is always the default.
  const defaultModelId = resolveActiveModelId(settings.demoDefaultModelId, (id) =>
    queue.rows.some((r) => r.id === id && r.status === 'installed'),
  );
  const [tokenInput, setTokenInput] = useState('');
  const [tokenSectionOpen, setTokenSectionOpen] = useState(false);

  useEffect(() => {
    const tag = 'models-screen-download';
    if (queue.anyDownloading) {
      void activateKeepAwakeAsync(tag).catch(() => undefined);
    } else {
      void deactivateKeepAwake(tag).catch(() => undefined);
    }
    return () => {
      void deactivateKeepAwake(tag).catch(() => undefined);
    };
  }, [queue.anyDownloading]);

  const handleSaveToken = useCallback(async () => {
    const action = await controller.saveHfToken(tokenInput);
    dispatch(action);
  }, [controller, tokenInput, dispatch]);

  const handleCleanModelsFolder = useCallback(() => {
    Alert.alert(
      'Clean models folder',
      'Removes any file in the models folder that is not a complete download of a supported model (orphaned files, interrupted downloads, leftover temp files). Installed models are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clean',
          style: 'destructive',
          onPress: () => {
            const removed = queue.cleanFolder();
            const detail =
              removed > 0
                ? `Removed ${removed} file${removed === 1 ? '' : 's'}.`
                : 'The models folder is already clean.';
            Alert.alert('Models folder cleaned', detail);
          },
        },
      ],
    );
  }, [queue]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          <Pressable
            onPress={onBack}
            hitSlop={12}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Back to Concierge">
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.backText}>
              ← Back
            </ThemedText>
          </Pressable>

          <ThemedText type="subtitle" style={styles.title}>
            Models
          </ThemedText>

          <Pressable
            onPress={() => setTokenSectionOpen(!tokenSectionOpen)}
            style={styles.tokenToggle}>
            <ThemedText type="small">
              {tokenSectionOpen ? '\u25BC' : '\u25B6'} HuggingFace Token
            </ThemedText>
            {state.hfTokenSaved && (
              <ThemedText type="small" themeColor="textSecondary">
                {'\u2713 saved'}
              </ThemedText>
            )}
          </Pressable>

          {tokenSectionOpen && (
            <ThemedView type="backgroundElement" style={styles.tokenSection}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.tokenHint}>
                Required for gated models. Leave empty for public models.
              </ThemedText>
              <View style={styles.tokenRow}>
                <TextInput
                  value={tokenInput}
                  onChangeText={setTokenInput}
                  placeholder="hf_xxxxxxxxxxxx"
                  placeholderTextColor={theme.textSecondary}
                  secureTextEntry={state.hfTokenMasked}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[
                    styles.tokenInput,
                    {
                      color: theme.text,
                      backgroundColor: theme.background,
                      borderColor: theme.textSecondary + '30',
                    },
                  ]}
                />
                <Pressable
                  onPress={() => dispatch({ type: 'toggle-hf-token-mask' })}
                  style={[styles.actionButton, { backgroundColor: theme.backgroundSelected }]}>
                  <ThemedText type="small">{state.hfTokenMasked ? 'Show' : 'Hide'}</ThemedText>
                </Pressable>
              </View>
              <Pressable
                onPress={handleSaveToken}
                style={[styles.actionButton, { backgroundColor: '#3c87f7', alignSelf: 'flex-start' }]}>
                <ThemedText style={{ color: '#ffffff', fontWeight: '600' }}>Save Token</ThemedText>
              </Pressable>
            </ThemedView>
          )}

          <SlmModelCarousel showDelete />

          <ThemedView type="backgroundElement" style={styles.defaultSection}>
            <ThemedText type="smallBold">Model storage</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Delete leftover files that are not complete downloads of supported
              models (e.g. files left behind after removing a model).
            </ThemedText>
            <Pressable
              onPress={handleCleanModelsFolder}
              disabled={queue.anyDownloading}
              style={[
                styles.actionButton,
                {
                  backgroundColor: AppTheme.colors.dangerSoft,
                  alignSelf: 'flex-start',
                  opacity: queue.anyDownloading ? 0.5 : 1,
                },
              ]}>
              <ThemedText style={{ color: '#ffffff', fontWeight: '600' }}>
                Clean models folder
              </ThemedText>
            </Pressable>
            {queue.anyDownloading ? (
              <ThemedText type="small" themeColor="textSecondary">
                Cleaning is disabled while a model is downloading.
              </ThemedText>
            ) : null}
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.defaultSection}>
            <ThemedText type="smallBold">Default Concierge model</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Used when Demo mode auto-loads a model.
            </ThemedText>
            <View style={styles.defaultRow}>
              {MODEL_CATALOG.map((m) => {
                const active = defaultModelId === m.id;
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => setDemoDefaultModelId(m.id)}
                    style={[
                      styles.actionButton,
                      {
                        backgroundColor: active ? '#3c87f7' : theme.backgroundSelected,
                      },
                    ]}>
                    <ThemedText
                      type="small"
                      style={active ? { color: '#fff', fontWeight: '600' } : undefined}>
                      {active ? '✓ ' : ''}
                      {m.displayName}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  scrollView: { flex: 1 },
  scrollContent: {
    padding: Spacing.three,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingRight: 12,
  },
  backText: {
    fontWeight: '900',
  },
  title: { marginBottom: Spacing.two },
  tokenToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
  tokenSection: {
    padding: Spacing.three,
    borderRadius: 12,
    gap: Spacing.two,
  },
  tokenHint: { marginBottom: Spacing.one },
  tokenRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  tokenInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  actionButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  defaultSection: {
    padding: Spacing.three,
    borderRadius: 12,
    gap: Spacing.two,
  },
  defaultRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});

import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { SlmDownloadCard } from '@/components/models/SlmDownloadCard';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useSettings } from '@/contexts/settings-context';
import { useTheme } from '@/hooks/use-theme';
import { useModelDownloadQueue } from '@/hooks/useModelDownloadQueue';
import { MODEL_CATALOG } from '@/inference/model-catalog';
import type { ModelsState } from './types';

type ModelsViewProps = {
  state: ModelsState;
  dispatch: (action: import('./types').ModelsAction) => void;
  controller: ReturnType<typeof import('./models-controller').createModelsController>;
};

export function ModelsView({ state, dispatch, controller }: ModelsViewProps) {
  const theme = useTheme();
  const { settings, setDemoDefaultModelId } = useSettings();
  const defaultModelId = settings.demoDefaultModelId ?? 'gemma-4-e2b';
  const [tokenInput, setTokenInput] = useState('');
  const [tokenSectionOpen, setTokenSectionOpen] = useState(false);
  const queue = useModelDownloadQueue();

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

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
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

          <SlmDownloadCard showDelete />

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

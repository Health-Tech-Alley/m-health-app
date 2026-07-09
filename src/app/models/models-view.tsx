import { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useSettings } from '@/contexts/settings-context';
import { useTheme } from '@/hooks/use-theme';
import type { ModelItem, ModelsState } from './types';

type ModelsViewProps = {
  state: ModelsState;
  dispatch: (action: import('./types').ModelsAction) => void;
  controller: ReturnType<typeof import('./models-controller').createModelsController>;
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function ModelRow({
  item,
  onDownload,
  onDelete,
  onCancel,
}: {
  item: ModelItem;
  onDownload: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const progress =
    item.downloadTotal > 0
      ? Math.round((item.downloadProgress / item.downloadTotal) * 100)
      : 0;

  return (
    <ThemedView type="backgroundElement" style={styles.modelRow}>
      <View style={styles.modelInfo}>
        <ThemedText type="smallBold">{item.displayName}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {item.file}
        </ThemedText>
        {item.status === 'error' && item.error && (
          <ThemedText type="small" style={{ color: '#d9534f' }}>
            {item.error}
          </ThemedText>
        )}
      </View>

      <View style={styles.modelActions}>
        {item.status === 'not-installed' && (
          <Pressable
            onPress={onDownload}
            style={[styles.actionButton, { backgroundColor: '#3c87f7' }]}>
            <ThemedText style={{ color: '#ffffff', fontWeight: '600' }}>Download</ThemedText>
          </Pressable>
        )}

        {item.status === 'downloading' && (
          <View style={styles.progressContainer}>
            <View style={styles.progressBarOuter}>
              <View
                style={[
                  styles.progressBarInner,
                  {
                    width: `${progress}%`,
                    backgroundColor: '#3c87f7',
                  },
                ]}
              />
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={styles.progressText}>
              {progress}% ({formatBytes(item.downloadProgress)} / {formatBytes(item.downloadTotal)})
            </ThemedText>
            <Pressable
              onPress={onCancel}
              style={[styles.actionButton, { backgroundColor: '#d9534f' }]}>
              <ThemedText style={{ color: '#ffffff', fontWeight: '600' }}>Cancel</ThemedText>
            </Pressable>
          </View>
        )}

        {item.status === 'installed' && (
          <Pressable
            onPress={() => {
              Alert.alert('Delete Model', `Delete ${item.displayName}?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: onDelete },
              ]);
            }}
            style={[styles.actionButton, { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type="small">Delete</ThemedText>
          </Pressable>
        )}

        {item.status === 'error' && (
          <Pressable
            onPress={onDownload}
            style={[styles.actionButton, { backgroundColor: '#3c87f7' }]}>
            <ThemedText style={{ color: '#ffffff', fontWeight: '600' }}>Retry</ThemedText>
          </Pressable>
        )}
      </View>
    </ThemedView>
  );
}

export function ModelsView({ state, dispatch, controller }: ModelsViewProps) {
  const theme = useTheme();
  const { settings, setDemoDefaultModelId } = useSettings();
  const defaultModelId = settings.demoDefaultModelId ?? 'healthgpt-pro-4b';
  const [tokenInput, setTokenInput] = useState('');
  const [tokenSectionOpen, setTokenSectionOpen] = useState(false);

  const handleSaveToken = useCallback(async () => {
    const action = await controller.saveHfToken(tokenInput);
    dispatch(action);
  }, [controller, tokenInput, dispatch]);

  const handleDownload = useCallback(
    (modelId: string) => {
      const action = controller.startDownload(modelId, state.hfToken || null);
      dispatch(action);
    },
    [controller, state.hfToken, dispatch],
  );

  const handleDelete = useCallback(
    (modelId: string) => {
      const action = controller.removeModel(modelId);
      dispatch(action);
    },
    [controller, dispatch],
  );

  const handleCancel = useCallback(
    (modelId: string) => {
      const action = controller.cancelDownload(modelId);
      dispatch(action);
    },
    [controller, dispatch],
  );

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

          <View style={styles.modelsList}>
            {state.items.map((item) => (
              <ModelRow
                key={item.id}
                item={item}
                onDownload={() => handleDownload(item.id)}
                onDelete={() => handleDelete(item.id)}
                onCancel={() => handleCancel(item.id)}
              />
            ))}
          </View>

          <ThemedView type="backgroundElement" style={styles.defaultSection}>
            <ThemedText type="smallBold">Default SLM Model</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.defaultHint}>
              Auto-loaded when an assistant task (safety-note explain, custom-med
              check) runs in Demo mode. Current: {defaultModelId}. Only installed
              models are selectable.
            </ThemedText>
            <View style={styles.defaultActions}>
              {state.items.map((item) => {
                const isDefault = defaultModelId === item.id;
                const selectable = item.status === 'installed';
                const active = isDefault && selectable;
                return (
                  <Pressable
                    key={item.id}
                    style={[
                      styles.actionButton,
                      styles.defaultButton,
                      active && styles.defaultActiveButton,
                      !selectable && styles.defaultDisabledButton,
                    ]}
                    disabled={!selectable}
                    onPress={() => setDemoDefaultModelId(item.id)}>
                    <ThemedText
                      type="small"
                      style={{
                        color: active ? '#ffffff' : theme.text,
                        fontWeight: '600',
                      }}>
                      {isDefault ? '✓ ' : ''}
                      {item.displayName}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </ThemedView>

          <Pressable
            onPress={() => {
              Alert.alert(
                'Clear All Models',
                'Delete all downloaded models and partial downloads? This cannot be undone.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Clear All',
                    style: 'destructive',
                    onPress: () => dispatch(controller.clearAllModels()),
                  },
                ],
              );
            }}
            style={[styles.actionButton, styles.clearAllButton, { borderColor: '#d9534f' }]}>
            <ThemedText style={{ color: '#d9534f', fontWeight: '600' }}>Clear All Models</ThemedText>
          </Pressable>
        </ScrollView>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.four,
    gap: Spacing.three,
  },
  title: {
    marginBottom: Spacing.two,
  },
  tokenToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
  tokenSection: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.two,
  },
  tokenHint: {
    marginBottom: Spacing.one,
  },
  tokenRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'center',
  },
  tokenInput: {
    flex: 1,
    height: 40,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  modelsList: {
    gap: Spacing.two,
  },
  defaultSection: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.two,
  },
  defaultHint: {
    marginBottom: Spacing.one,
  },
  defaultActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  defaultButton: {
    minWidth: 100,
  },
  defaultActiveButton: {
    backgroundColor: '#3c87f7',
  },
  defaultDisabledButton: {
    opacity: 0.45,
  },
  modelRow: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.two,
  },
  modelInfo: {
    gap: Spacing.half,
  },
  modelActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  actionButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearAllButton: {
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: Spacing.two,
    alignSelf: 'center',
  },
  progressContainer: {
    flex: 1,
    gap: Spacing.one,
  },
  progressBarOuter: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#88888830',
    overflow: 'hidden',
  },
  progressBarInner: {
    height: '100%',
    borderRadius: 4,
  },
  progressText: {
    textAlign: 'center',
  },
});

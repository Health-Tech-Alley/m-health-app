import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ListRenderItem,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { MODEL_CATALOG } from '@/inference/model-catalog';
import { isModelInstalled } from '@/services/model-storage';
import type { ChatMessage, PlaygroundState } from './types';
import { useMemoryInfo, isNativeMemoryAvailable } from '@/services/device-memory';
import type { SLMStatus } from '@/contexts/slm-context';

type PlaygroundViewProps = {
  state: PlaygroundState;
  dispatch: (action: import('./types').PlaygroundAction) => void;
  controller: ReturnType<typeof import('./playground-controller').createController>;
  slmLoadStatus: SLMStatus;
  slmLoadError: string | null;
  slmCurrentModelId: string | null;
  slmModelSizeGB: number | null;
  onLoadModel: (modelId: string) => Promise<void>;
  onUnloadModel: () => Promise<void>;
};

export function PlaygroundView({
  state,
  dispatch,
  controller,
  slmLoadStatus,
  slmLoadError,
  slmCurrentModelId,
  slmModelSizeGB,
  onLoadModel,
  onUnloadModel,
}: PlaygroundViewProps) {
  const theme = useTheme();
  const flatListRef = useRef<FlatList>(null);
  const [inputText, setInputText] = useState('');
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const memoryInfo = useMemoryInfo(2000);
  const hasNativeMemory = isNativeMemoryAvailable();
  const [, setFocusTick] = useState(0);

  useFocusEffect(
    useCallback(() => {
      setFocusTick((t) => t + 1);
    }, []),
  );

  const isInputDisabled =
    slmLoadStatus !== 'ready' || state.runStatus === 'streaming';

  const handleSend = useCallback(async () => {
    const trimmed = inputText.trim();
    if (!trimmed || isInputDisabled) return;

    setInputText('');
    setUserScrolledUp(false);

    const action = await controller.send(state, trimmed);
    if (action.type !== 'noop') {
      dispatch(action);
    }
  }, [inputText, isInputDisabled, controller, state, dispatch]);

  const handleStop = useCallback(() => {
    controller.stop();
  }, [controller]);

  const handleNewConversation = useCallback(() => {
    dispatch(controller.newConversation());
  }, [controller, dispatch]);

  useEffect(() => {
    if (!userScrolledUp) {
      flatListRef.current?.scrollToEnd({ animated: true });
    }
  }, [state.messages, userScrolledUp]);

  const renderMessage: ListRenderItem<ChatMessage> = ({ item }) => {
    if (item.role === 'user') {
      return (
        <View style={styles.userBubbleWrapper}>
          <ThemedView type="backgroundElement" style={styles.userBubble}>
            <ThemedText>{item.text}</ThemedText>
          </ThemedView>
        </View>
      );
    }

    return (
      <View style={styles.assistantBubble}>
        {item.status === 'streaming' && (
          <ThemedText themeColor="textSecondary" style={styles.thinkingText}>
            {item.text || '...'}
          </ThemedText>
        )}
        
        {item.status === 'done' && (
          <>
            {item.thinking && (
              <ThemedText themeColor="textSecondary" style={styles.thinkingText}>
                {item.thinking}
              </ThemedText>
            )}
            {item.finalText && (
              <View style={styles.finalTextContainer}>
                <MarkdownRenderer size="large">{item.finalText}</MarkdownRenderer>
              </View>
            )}
          </>
        )}
        
        {item.status === 'stopped' && (
          <>
            {item.thinking && (
              <ThemedText themeColor="textSecondary" style={styles.thinkingText}>
                {item.thinking}
              </ThemedText>
            )}
            {item.text && (
              <View style={styles.finalTextContainer}>
                <MarkdownRenderer size="large">{item.text}</MarkdownRenderer>
              </View>
            )}
            <ThemedText type="small" themeColor="textSecondary" style={styles.stoppedHint}>
              {'\u00B7 stopped'}
            </ThemedText>
          </>
        )}
        
        {item.status === 'error' && (
          <ThemedText type="small" style={{ color: '#d9534f' }}>
            {'\u00B7 error' + (item.finalText ? `: ${item.finalText}` : '')}
          </ThemedText>
        )}
      </View>
    );
  };

  const statusText = (() => {
    switch (slmLoadStatus) {
      case 'idle':
        return 'Select a model to begin';
      case 'loading':
        return 'Loading model\u2026';
      case 'ready':
        return 'Ready';
      case 'error':
        return `Error: ${slmLoadError ?? 'Unknown error'}`;
    }
  })();

  const installedModels = MODEL_CATALOG.filter(isModelInstalled);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
        <KeyboardAvoidingView
          style={styles.keyboardView}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 120 : 0}>
          <View style={styles.headerRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.modelSelector}>
              {installedModels.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.noModelsText}>
                  No models installed
                </ThemedText>
              ) : (
                installedModels.map((entry) => (
                  <Pressable
                    key={entry.id}
                    onPress={() => onLoadModel(entry.id)}
                    disabled={slmLoadStatus === 'loading' || state.runStatus === 'streaming'}
                    style={[
                      styles.modelButton,
                      slmCurrentModelId === entry.id && styles.modelButtonSelected,
                      {
                        borderColor: slmCurrentModelId === entry.id ? '#3c87f7' : theme.textSecondary + '30',
                        backgroundColor: slmCurrentModelId === entry.id ? '#3c87f7' : theme.backgroundElement,
                      },
                    ]}>
                    <ThemedText
                      type="small"
                      style={{
                        color: slmCurrentModelId === entry.id ? '#ffffff' : theme.text,
                        fontWeight: slmCurrentModelId === entry.id ? '600' : '400',
                      }}>
                      {entry.displayName}
                    </ThemedText>
                  </Pressable>
                ))
              )}
            </ScrollView>
            {slmCurrentModelId && (
              <Pressable
                onPress={() => onUnloadModel()}
                style={[styles.unloadButton, { backgroundColor: '#d9534f' }]}>
                <ThemedText style={{ color: '#ffffff', fontWeight: '600' }}>Unload</ThemedText>
              </Pressable>
            )}
            <Pressable onPress={handleNewConversation} style={styles.newConvButton}>
              <ThemedText type="small">New conversation</ThemedText>
            </Pressable>
          </View>

          <ThemedText
            type="small"
            themeColor="textSecondary"
            style={styles.statusText}>
            {statusText}
          </ThemedText>

          {(slmLoadStatus === 'ready' || slmLoadStatus === 'loading') && memoryInfo && (
            <View style={[styles.memoryBar, { backgroundColor: theme.backgroundElement }]}>
              <View style={styles.memoryHeader}>
                <ThemedText type="small" style={styles.memoryLabel}>
                  Device RAM
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.memoryText}>
                  {memoryInfo.usedMB.toFixed(0)} / {memoryInfo.totalMB.toFixed(0)} MB
                </ThemedText>
              </View>
              <View style={styles.progressBarBg}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${Math.min((memoryInfo.usedMB / memoryInfo.totalMB) * 100, 100)}%`,
                      backgroundColor:
                        memoryInfo.usedMB / memoryInfo.totalMB > 0.8 ? '#d9534f' : '#3c87f7',
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

          <FlatList
            ref={flatListRef}
            data={state.messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.messagesContent}
            style={styles.messagesList}
            onScrollBeginDrag={() => setUserScrolledUp(true)}
            onMomentumScrollEnd={() => setUserScrolledUp(false)}
          />

          <View style={[styles.inputRow, { borderTopColor: theme.textSecondary + '30' }]}>
            <TextInput
              value={inputText}
              onChangeText={setInputText}
              placeholder="Type a message\u2026"
              placeholderTextColor={theme.textSecondary}
              multiline
              numberOfLines={1}
              maxLength={4000}
              editable={!isInputDisabled}
              style={[
                styles.textInput,
                {
                  color: theme.text,
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.textSecondary + '30',
                },
              ]}
              onSubmitEditing={handleSend}
              blurOnSubmit={false}
            />
            {state.runStatus === 'streaming' ? (
              <Pressable onPress={handleStop} style={[styles.sendButton, styles.stopButton]}>
                <ThemedText style={{ color: '#ffffff', fontWeight: '600' }}>Stop</ThemedText>
              </Pressable>
            ) : (
              <Pressable
                onPress={handleSend}
                disabled={!inputText.trim() || isInputDisabled}
                style={[
                  styles.sendButton,
                  {
                    backgroundColor:
                      inputText.trim() && !isInputDisabled ? '#3c87f7' : theme.backgroundElement,
                  },
                ]}>
              <ThemedText
                style={{
                  color: inputText.trim() && !isInputDisabled ? '#ffffff' : theme.textSecondary,
                  fontWeight: '600',
                }}>
                Send
              </ThemedText>
            </Pressable>
          )}
          </View>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  modelSelector: {
    flex: 1,
  },
  modelButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    marginRight: Spacing.two,
  },
  modelButtonSelected: {
    backgroundColor: '#3c87f7',
    borderColor: '#3c87f7',
  },
  noModelsText: {
    paddingVertical: Spacing.two,
  },
  unloadButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  newConvButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  statusText: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  memoryBar: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.one,
    gap: Spacing.one,
  },
  memoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  memoryLabel: {
    fontWeight: '600',
  },
  memoryText: {
    fontFamily: 'monospace',
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
  messagesList: {
    flex: 1,
  },
  messagesContent: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  userBubbleWrapper: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  userBubble: {
    maxWidth: '80%',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  assistantBubble: {
    paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#88888830',
  },
  thinkingText: {
    fontStyle: 'italic',
    fontSize: 14,
    lineHeight: 20,
  },
  finalTextContainer: {
    marginTop: Spacing.two,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#88888830',
  },
  stoppedHint: {
    fontStyle: 'italic',
    marginTop: Spacing.half,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
  },
  textInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sendButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stopButton: {
    backgroundColor: '#d9534f',
  },
});

import { Picker } from '@react-native-picker/picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type ListRenderItem,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { MODEL_CATALOG, resolveModelPath } from '@/inference/model-catalog';
import type { ChatMessage, PlaygroundState } from './types';

type PlaygroundViewProps = {
  state: PlaygroundState;
  dispatch: (action: import('./types').PlaygroundAction) => void;
  controller: ReturnType<typeof import('./playground-controller').createController>;
};

export function PlaygroundView({ state, dispatch, controller }: PlaygroundViewProps) {
  const theme = useTheme();
  const flatListRef = useRef<FlatList>(null);
  const [inputText, setInputText] = useState('');
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  const isInputDisabled =
    state.loadStatus !== 'ready' || state.runStatus === 'streaming';

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

  const handleModelChange = useCallback(
    async (modelId: string) => {
      const entry = MODEL_CATALOG.find((m) => m.id === modelId);
      if (!entry) return;

      const action = await controller.selectModel(state, entry, resolveModelPath);
      if (action.type !== 'noop') {
        dispatch(action);
      }
    },
    [controller, state, dispatch],
  );

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
        <ThemedText themeColor="textSecondary" style={styles.thinkingText}>
          {item.text || (item.status === 'streaming' ? '...' : '')}
        </ThemedText>
        {item.status === 'done' && item.finalText && (
          <ThemedText style={styles.finalText}>{item.finalText}</ThemedText>
        )}
        {item.status === 'stopped' && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.stoppedHint}>
            {'\u00B7 stopped'}
          </ThemedText>
        )}
        {item.status === 'error' && (
          <ThemedText type="small" style={{ color: '#d9534f' }}>
            {'\u00B7 error'}
          </ThemedText>
        )}
      </View>
    );
  };

  const statusText = (() => {
    switch (state.loadStatus) {
      case 'idle':
        return 'Select a model to begin';
      case 'loading':
        return 'Loading model\u2026';
      case 'ready':
        return 'Ready';
      case 'error':
        return `Error: ${state.loadError ?? 'Unknown error'}`;
    }
  })();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.headerRow}>
          <View style={styles.pickerWrapper}>
            <Picker
              selectedValue={state.selectedModelId ?? ''}
              onValueChange={handleModelChange}
              enabled={state.loadStatus !== 'loading' && state.runStatus !== 'streaming'}
              style={[styles.picker, { color: theme.text }]}>
              <Picker.Item label="Select a model\u2026" value="" enabled={false} />
              {MODEL_CATALOG.map((entry) => (
                <Picker.Item
                  key={entry.id}
                  label={entry.displayName}
                  value={entry.id}
                />
              ))}
            </Picker>
          </View>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  pickerWrapper: {
    flex: 1,
  },
  picker: {
    height: 50,
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
  },
  finalText: {
    marginTop: Spacing.one,
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

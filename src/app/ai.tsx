import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { useRef, useState } from 'react';
import {
    FlatList,
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

const MOCK_MESSAGES: Message[] = [
  { id: '1', role: 'assistant', text: 'Hi! I\'m your M-HEALTH Concierge. How can I help you today?' },
  { id: '2', role: 'user', text: 'What should I do if I have a headache?' },
  { id: '3', role: 'assistant', text: 'For a headache, try drinking water, resting in a quiet dark room, and taking an OTC pain reliever if needed. If it persists or is severe, consult a doctor.' },
];

export default function AIScreen() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme ?? 'light'];

  const [messages, setMessages] = useState<Message[]>(MOCK_MESSAGES);
  const [input, setInput] = useState('');
  const listRef = useRef<FlatList>(null);

  function sendMessage() {
    const text = input.trim();
    if (!text) return;

    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), role: 'user', text },
    ]);
    setInput('');
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  }

  function renderMessage({ item }: { item: Message }) {
    const isUser = item.role === 'user';
    return (
      <ThemedView
        style={[
          styles.bubble,
          isUser
            ? [styles.userBubble, { backgroundColor: colors.backgroundElement }]
            : [styles.assistantBubble, { backgroundColor: colors.backgroundElement }],
        ]}
      >
        <ThemedText style={[styles.bubbleText, isUser && { color: '#fff' }]}>
          {item.text}
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>

        <ThemedView style={styles.header}>
          <ThemedText type="title" style={styles.headerTitle}>Concierge</ThemedText>
        </ThemedView>

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        />

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ThemedView type="backgroundElement" style={styles.inputRow}>
            <TextInput
              style={[styles.input, { color: colors.text }]}
              value={input}
              onChangeText={setInput}
              placeholder="Ask me anything..."
              placeholderTextColor={colors.text + '66'}
              onSubmitEditing={sendMessage}
              returnKeyType="send"
              multiline
            />
            <TouchableOpacity
              onPress={sendMessage}
              disabled={!input.trim()}
              style={[styles.sendButton, { backgroundColor: colors.backgroundElement, opacity: !input.trim() ? 0.4 : 1 }]}
            >
              <ThemedText style={styles.sendButtonText}>↑</ThemedText>
            </TouchableOpacity>
          </ThemedView>
        </KeyboardAvoidingView>

      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#00000022',
  },
  headerTitle: { fontSize: 20 },
  messageList: {
    padding: Spacing.three,
  },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    marginBottom: Spacing.two,
  },
  userBubble: {
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  bubbleText: { lineHeight: 20 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    margin: Spacing.three,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  input: {
    flex: 1,
    fontSize: 15,
    maxHeight: 100,
    paddingTop: 0,
    paddingBottom: 0,
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
});

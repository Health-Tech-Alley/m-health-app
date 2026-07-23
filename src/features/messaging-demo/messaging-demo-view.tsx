import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MainTabHeader } from '@/components/MainTabHeader';
import { AppTheme, MaxContentWidth, Spacing } from '@/constants/theme';

import type { MessagingDemoAction, MessagingDemoState } from './types';

type ViewProps = {
  state: MessagingDemoState;
  dispatch: (action: MessagingDemoAction) => void;
  onSend: () => void;
  onReload: () => void;
  onSeed: () => void;
  onReset: () => void;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

export function MessagingDemoView({
  state,
  dispatch,
  onSend,
  onReload,
  onSeed,
  onReset,
}: ViewProps) {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <MainTabHeader
          title="Messaging Playground"
          eyebrow="Encrypt → Store → Decrypt"
          subtitle="Demo the secure messaging pipeline: compose, encrypt, persist, reload, decrypt."
          icon="messages"
        />

        <Section title="Compose & Encrypt">
          <TextInput
            style={styles.composeInput}
            value={state.composeText}
            onChangeText={(text) => dispatch({ type: 'set-compose', payload: { text } })}
            placeholder="Type a message…"
            placeholderTextColor={AppTheme.colors.textMuted}
            multiline
            textAlignVertical="top"
          />
          <Pressable
            style={[styles.primaryButton, !state.composeText.trim() && styles.primaryButtonDisabled]}
            disabled={!state.composeText.trim()}
            onPress={onSend}>
            <Text style={styles.primaryButtonText}>Encrypt & Store</Text>
          </Pressable>
        </Section>

        <Section title="Database Status">
          <Text style={styles.statusText}>
            {state.dbRowCount} encrypted row{state.dbRowCount === 1 ? '' : 's'} in SQLite
          </Text>
          <View style={styles.buttonRow}>
            <Pressable style={styles.secondaryButton} onPress={onReload}>
              <Text style={styles.secondaryButtonText}>Reload & Decrypt</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={onSeed}>
              <Text style={styles.secondaryButtonText}>Seed Demo Messages</Text>
            </Pressable>
            <Pressable style={styles.dangerButton} onPress={onReset}>
              <Text style={styles.dangerButtonText}>Reset</Text>
            </Pressable>
          </View>
        </Section>

        {state.statusMessage ? (
          <View style={styles.statusBanner}>
            <Text style={styles.statusBannerText}>{state.statusMessage}</Text>
          </View>
        ) : null}

        {state.error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>Error: {state.error}</Text>
          </View>
        ) : null}

        {state.entries.length > 0 ? (
          <Section title="Encrypted Entries">
            {state.entries.map((entry) => (
              <View key={entry.id} style={styles.entryCard}>
                <Text style={styles.entryLabel}>Plaintext:</Text>
                <Text style={styles.entryValue}>{entry.plaintext}</Text>
                <Text style={styles.entryLabel}>Ciphertext (first 40 chars):</Text>
                <Text style={styles.entryMono}>{entry.ciphertextPreview.slice(0, 40)}…</Text>
                <Text style={styles.entryLabel}>IV (first 24 chars):</Text>
                <Text style={styles.entryMono}>{entry.iv.slice(0, 24)}…</Text>
                <Text style={styles.entryLabel}>Auth Tag (first 24 chars):</Text>
                <Text style={styles.entryMono}>{entry.authTag.slice(0, 24)}…</Text>
              </View>
            ))}
          </Section>
        ) : null}

        {state.decryptedMessages.length > 0 ? (
          <Section title={`Decrypted Messages (${state.decryptedMessages.length})`}>
            {state.decryptedMessages.map((msg) => (
              <View key={msg.messageId} style={styles.messageBubble}>
                <Text style={styles.messageBody}>{msg.body}</Text>
                <Text style={styles.messageTimestamp}>
                  {new Date(msg.createdAt).toLocaleString()}
                </Text>
              </View>
            ))}
          </Section>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: AppTheme.colors.screen,
  },
  content: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.four,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  section: {
    gap: Spacing.two,
  },
  sectionTitle: {
    color: AppTheme.colors.sectionText,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  sectionCard: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.lg,
    padding: Spacing.three,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    ...AppTheme.shadow,
  },
  composeInput: {
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    borderRadius: AppTheme.radius.md,
    padding: Spacing.two,
    minHeight: 80,
    fontSize: 14,
    color: AppTheme.colors.text,
    backgroundColor: AppTheme.colors.softSurface,
  },
  primaryButton: {
    paddingVertical: Spacing.three,
    borderRadius: AppTheme.radius.md,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
    backgroundColor: AppTheme.colors.brand,
  },
  primaryButtonDisabled: {
    backgroundColor: AppTheme.colors.chip,
  },
  primaryButtonText: {
    color: AppTheme.colors.white,
    fontWeight: '800',
    fontSize: 15,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: Spacing.two,
    borderRadius: AppTheme.radius.md,
    alignItems: 'center',
    backgroundColor: AppTheme.colors.softSurface,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
  },
  secondaryButtonText: {
    color: AppTheme.colors.text,
    fontWeight: '700',
    fontSize: 13,
  },
  dangerButton: {
    flex: 1,
    paddingVertical: Spacing.two,
    borderRadius: AppTheme.radius.md,
    alignItems: 'center',
    backgroundColor: AppTheme.colors.dangerLight,
    borderWidth: 1,
    borderColor: AppTheme.colors.danger,
  },
  dangerButtonText: {
    color: AppTheme.colors.danger,
    fontWeight: '700',
    fontSize: 13,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  statusText: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  statusBanner: {
    backgroundColor: AppTheme.colors.brandSoft,
    borderRadius: AppTheme.radius.md,
    padding: Spacing.two,
    borderWidth: 1,
    borderColor: AppTheme.colors.brandPale,
  },
  statusBannerText: {
    color: AppTheme.colors.brand,
    fontSize: 13,
    fontWeight: '700',
  },
  errorBanner: {
    backgroundColor: AppTheme.colors.dangerLight,
    borderRadius: AppTheme.radius.md,
    padding: Spacing.two,
    borderWidth: 1,
    borderColor: AppTheme.colors.danger,
  },
  errorBannerText: {
    color: AppTheme.colors.danger,
    fontSize: 13,
    fontWeight: '700',
  },
  entryCard: {
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: AppTheme.radius.md,
    padding: Spacing.two,
    gap: Spacing.one,
    marginBottom: Spacing.two,
  },
  entryLabel: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  entryValue: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  entryMono: {
    color: AppTheme.colors.textSoft,
    fontSize: 11,
    fontFamily: 'monospace',
  },
  messageBubble: {
    backgroundColor: AppTheme.colors.brandSoft,
    borderRadius: AppTheme.radius.lg,
    padding: Spacing.two,
    marginBottom: Spacing.two,
    alignSelf: 'flex-end',
    maxWidth: '80%',
  },
  messageBody: {
    color: AppTheme.colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  messageTimestamp: {
    color: AppTheme.colors.textMuted,
    fontSize: 10,
    marginTop: Spacing.one,
    alignSelf: 'flex-end',
  },
});

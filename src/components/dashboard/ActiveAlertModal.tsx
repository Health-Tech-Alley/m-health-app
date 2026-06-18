/**
 * ActiveAlertModal — full-screen modal pop-up for the severity-3 active alert.
 *
 * Shown once per app cold-start (controlled by ActiveAlertStore). The modal
 * overlays the whole app so the alert cannot be missed. Actions:
 *   - Call 911  → opens the phone dialer with 911 populated (does NOT place
 *     the call). Audit-logged.
 *   - Acknowledge → opens a dialog stressing the severity. Audit-logged.
 *   - Add Note → inline note input. Audit-logged.
 *   - Close (temp) → hides for the session; reappears next cold start.
 *   - Clear without rectifying → confirmation dialog → persistently clears.
 */

import { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Alert,
  ScrollView,
} from 'react-native';

import { AppIcon } from '@/components/AppIcon';
import { AppTheme } from '@/constants/theme';
import { useActiveAlert } from '@/contexts/active-alert-context';

export function ActiveAlertModal() {
  const { alert, visible, tempDismiss, clearAlert, call911, acknowledge, addNote } = useActiveAlert();
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');

  if (!alert) return null;

  const handleAcknowledge = () => {
    Alert.alert(
      'This is a severity-3 alert',
      `${alert.title} indicates a potentially life-threatening change. Acknowledging records that you have seen it but does NOT resolve the underlying issue. Check on the patient immediately and call 911 if symptoms are severe.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'I understand',
          style: 'destructive',
          onPress: () => {
            acknowledge();
            tempDismiss();
          },
        },
      ],
    );
  };

  const handleClear = () => {
    Alert.alert(
      'Clear this alert?',
      'You are about to clear a severity-3 alert without confirming the patient is safe. This is not recommended. The alert will not reappear. Only continue if you are certain the situation has been addressed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear anyway',
          style: 'destructive',
          onPress: () => clearAlert(),
        },
      ],
    );
  };

  const handleSaveNote = () => {
    addNote(noteText);
    setNoteText('');
    setNoteOpen(false);
    tempDismiss();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={tempDismiss}>
      <View style={styles.overlay}>
        <ScrollView contentContainerStyle={styles.scrollContent} bounces={false}>
          <View style={styles.card}>
            <View style={styles.headerRow}>
              <View style={styles.alertIconCircle}>
                <AppIcon name="alert" size={28} color={AppTheme.colors.white} />
              </View>

              <View style={styles.titleBlock}>
                <Text style={styles.eyebrow}>Active Alert</Text>
                <Text style={styles.title}>{alert.title}</Text>
                <Text style={styles.subtitle}>{alert.subtitle}</Text>
              </View>

              <Pressable style={styles.closeButton} onPress={tempDismiss} hitSlop={12}>
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>

            <View style={styles.metricRow}>
              {alert.metrics.map((m) => (
                <View key={m.label} style={styles.metricBox}>
                  <Text style={styles.metricLabel}>{m.label}</Text>
                  <Text style={styles.metricValue}>{m.value}</Text>
                  {m.detail ? <Text style={styles.metricDetail}>{m.detail}</Text> : null}
                </View>
              ))}
            </View>

            <Text style={styles.bodyText}>{alert.body}</Text>

            <Pressable style={styles.callButton} onPress={() => { void call911(); }}>
              <Text style={styles.callButtonText}>Call 911</Text>
            </Pressable>

            <View style={styles.secondaryActions}>
              <Pressable style={styles.secondaryButton} onPress={handleAcknowledge}>
                <Text style={styles.secondaryButtonText}>Acknowledge</Text>
              </Pressable>
              <Pressable
                style={[styles.secondaryButton, noteOpen && styles.secondaryButtonActive]}
                onPress={() => setNoteOpen((v) => !v)}
              >
                <Text style={styles.secondaryButtonText}>Add Note</Text>
              </Pressable>
            </View>

            {noteOpen ? (
              <View style={styles.noteBox}>
                <TextInput
                  style={styles.noteInput}
                  value={noteText}
                  onChangeText={setNoteText}
                  placeholder="Add a caregiver note (logged to the audit trail)…"
                  placeholderTextColor="rgba(255,255,255,0.7)"
                  multiline
                  textAlignVertical="top"
                  autoFocus
                />
                <Pressable
                  style={[styles.noteSaveButton, !noteText.trim() && styles.noteSaveDisabled]}
                  disabled={!noteText.trim()}
                  onPress={handleSaveNote}
                >
                  <Text style={styles.noteSaveText}>Save & Close</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.footerRow}>
              <Pressable onPress={tempDismiss}>
                <Text style={styles.footerLink}>Remind me later</Text>
              </Pressable>
              <Pressable onPress={handleClear}>
                <Text style={styles.clearLink}>Clear without rectifying</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 20,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: AppTheme.colors.danger,
    borderRadius: AppTheme.radius.card,
    padding: 22,
    shadowColor: '#900',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  alertIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  titleBlock: {
    flex: 1,
  },
  eyebrow: {
    color: AppTheme.colors.white,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  title: {
    color: AppTheme.colors.white,
    fontSize: 22,
    fontWeight: '900',
  },
  subtitle: {
    color: AppTheme.colors.white,
    fontSize: 14,
    marginTop: 4,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: AppTheme.colors.white,
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 24,
  },
  metricRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 22,
  },
  metricBox: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.16)',
    paddingVertical: 12,
    alignItems: 'center',
  },
  metricLabel: {
    color: AppTheme.colors.white,
    fontSize: 11,
    fontWeight: '700',
  },
  metricValue: {
    color: AppTheme.colors.white,
    fontSize: 17,
    fontWeight: '900',
    marginTop: 4,
  },
  metricDetail: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 10,
    marginTop: 2,
  },
  bodyText: {
    color: AppTheme.colors.white,
    fontSize: 15,
    lineHeight: 23,
    marginTop: 20,
  },
  callButton: {
    backgroundColor: AppTheme.colors.white,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  callButtonText: {
    color: AppTheme.colors.danger,
    fontSize: 18,
    fontWeight: '900',
  },
  secondaryActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonActive: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  secondaryButtonText: {
    color: AppTheme.colors.white,
    fontSize: 15,
    fontWeight: '900',
  },
  noteBox: {
    marginTop: 12,
  },
  noteInput: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 14,
    padding: 12,
    minHeight: 80,
    color: AppTheme.colors.white,
    fontSize: 14,
  },
  noteSaveButton: {
    backgroundColor: AppTheme.colors.white,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  noteSaveDisabled: {
    opacity: 0.5,
  },
  noteSaveText: {
    color: AppTheme.colors.danger,
    fontSize: 15,
    fontWeight: '900',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 18,
  },
  footerLink: {
    color: AppTheme.colors.white,
    fontSize: 13,
    fontWeight: '900',
    textDecorationLine: 'underline',
  },
  clearLink: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});

/**
 * Compact in-chat appointment form for Concierge (sev 1–2 follow-up).
 * Persists a local demo appointment via insertAppointment; it does not call Athena.
 */
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppTheme } from '@/constants/theme';
import { insertAppointment } from '@/data';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import type { TranslateFn } from '@/localization/i18n';
import { audit } from '@/services/audit/auditService';
import { getOnboardingProfile } from '@/services/onboarding/onboardingService';

const APPOINTMENT_TYPES = ['Primary care', 'Urgent follow-up'] as const;
const REMINDER_OPTIONS = [
  '15 min before',
  '1 hour before',
  '1 day before',
  '1 week before',
] as const;

export type InChatScheduleResult =
  | {
      action: 'scheduled';
      appointmentId: string;
      type: string;
      provider?: string;
      date: string;
      time?: string;
      location?: string;
      reason?: string;
      reminder?: string;
    }
  | { action: 'dismissed' };

type Props = {
  patientId: string;
  defaultReason?: string;
  enabled?: boolean;
  onComplete: (result: InChatScheduleResult) => void;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function appointmentTypeLabel(type: string, t: TranslateFn): string {
  switch (type) {
    case 'Primary care':
      return t('assistant.scheduleCard.type.primaryCare');
    case 'Urgent follow-up':
      return t('assistant.scheduleCard.type.urgentFollowup');
    default:
      return type;
  }
}

function reminderLabel(option: string, t: TranslateFn): string {
  switch (option) {
    case '15 min before':
      return t('assistant.scheduleCard.reminder.15min');
    case '1 hour before':
      return t('assistant.scheduleCard.reminder.1hour');
    case '1 day before':
      return t('assistant.scheduleCard.reminder.1day');
    case '1 week before':
      return t('assistant.scheduleCard.reminder.1week');
    default:
      return option;
  }
}

export function InChatScheduleAppointmentCard({
  patientId,
  defaultReason,
  enabled = true,
  onComplete,
}: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const profile = useMemo(() => getOnboardingProfile(), []);
  const [appointmentType, setAppointmentType] = useState<string>('Primary care');
  const [providerName, setProviderName] = useState(
    profile.primaryCareProvider?.name ?? '',
  );
  const [date, setDate] = useState(() => addDaysIso(2));
  const [time, setTime] = useState('10:00');
  const [location, setLocation] = useState('Local demo follow-up');
  const [reason, setReason] = useState(
    defaultReason?.trim() || 'Follow-up recommended by Health Monitor',
  );
  const [reminder, setReminder] = useState<string>('1 day before');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    enabled &&
    !busy &&
    Boolean(patientId) &&
    Boolean(date.trim()) &&
    Boolean(appointmentType.trim());

  const handleSchedule = () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const appt = insertAppointment({
        patientId,
        type: appointmentType,
        provider: providerName.trim() || undefined,
        date: date.trim(),
        time: time.trim() || undefined,
        location: location.trim() || undefined,
        reason: reason.trim() || undefined,
        reminder: reminder || undefined,
        status: 'scheduled',
      });
      audit({
        actor: 'caregiver',
        action: 'schedule_appointment',
        resourceType: 'appointment',
        resourceId: appt.appointmentId,
        patientId,
        payload: {
          source: 'concierge_chat_health_monitor',
          type: appt.type,
          date: appt.date,
          time: appt.time,
        },
      });
      onComplete({
        action: 'scheduled',
        appointmentId: appt.appointmentId,
        type: appt.type,
        provider: appt.provider,
        date: appt.date,
        time: appt.time,
        location: appt.location,
        reason: appt.reason,
        reminder: appt.reminder,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('assistant.scheduleCard.errorSave'));
      setBusy(false);
    }
  };

  return (
    <View style={[styles.card, themedStyles.card]}>
      <Text style={[styles.title, themedStyles.title]}>{t('assistant.scheduleCard.title')}</Text>
      <Text style={[styles.body, themedStyles.supportingText]}>
        {t('assistant.scheduleCard.body')}
      </Text>

      <Text style={[styles.label, themedStyles.supportingText]}>{t('assistant.scheduleCard.appointmentType')}</Text>
      <View style={styles.chipRow}>
        {APPOINTMENT_TYPES.map((type) => {
          const selected = appointmentType === type;
          return (
            <Pressable
              key={type}
              disabled={!enabled || busy}
              onPress={() => setAppointmentType(type)}
              style={[styles.chip, themedStyles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, themedStyles.chipText, selected && styles.chipTextSelected]}>
                {appointmentTypeLabel(type, t)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Field
        label={t('assistant.scheduleCard.provider')}
        value={providerName}
        onChangeText={setProviderName}
        placeholder={t('assistant.scheduleCard.providerPlaceholder')}
        editable={enabled && !busy}
      />
      <View style={styles.row}>
        <Field
          label={t('assistant.scheduleCard.date')}
          value={date}
          onChangeText={setDate}
          placeholder={todayIsoDate()}
          editable={enabled && !busy}
          style={styles.half}
        />
        <Field
          label={t('assistant.scheduleCard.time')}
          value={time}
          onChangeText={setTime}
          placeholder="10:00"
          editable={enabled && !busy}
          style={styles.half}
        />
      </View>
      <Field
        label={t('assistant.scheduleCard.location')}
        value={location}
        onChangeText={setLocation}
        placeholder={t('assistant.scheduleCard.locationPlaceholder')}
        editable={enabled && !busy}
      />
      <Field
        label={t('assistant.scheduleCard.reason')}
        value={reason}
        onChangeText={setReason}
        placeholder={t('assistant.scheduleCard.reasonPlaceholder')}
        editable={enabled && !busy}
        multiline
      />

      <Text style={[styles.label, themedStyles.supportingText]}>{t('assistant.scheduleCard.reminder')}</Text>
      <View style={styles.chipRow}>
        {REMINDER_OPTIONS.map((option) => {
          const selected = reminder === option;
          return (
            <Pressable
              key={option}
              disabled={!enabled || busy}
              onPress={() => setReminder(option)}
              style={[styles.chip, themedStyles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, themedStyles.chipText, selected && styles.chipTextSelected]}>
                {reminderLabel(option, t)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {error ? <Text style={[styles.error, themedStyles.errorText]}>{error}</Text> : null}

      <View style={styles.actions}>
        <Pressable
          style={[styles.button, styles.buttonPrimary, !canSubmit && styles.buttonDisabled]}
          onPress={handleSchedule}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityLabel={t('assistant.scheduleCard.saveA11y')}
        >
          {busy ? (
            <ActivityIndicator color={AppTheme.colors.white} />
          ) : (
            <Text style={styles.buttonPrimaryText}>{t('assistant.scheduleCard.save')}</Text>
          )}
        </Pressable>
        <Pressable
          style={[styles.button, styles.buttonSecondary, themedStyles.buttonSecondary]}
          onPress={() => onComplete({ action: 'dismissed' })}
          disabled={!enabled || busy}
          accessibilityRole="button"
          accessibilityLabel={t('assistant.scheduleCard.notNowA11y')}
        >
          <Text style={[styles.buttonSecondaryText, themedStyles.buttonSecondaryText]}>{t('assistant.scheduleCard.notNow')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  editable = true,
  multiline,
  style,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  editable?: boolean;
  multiline?: boolean;
  style?: object;
}) {
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);

  return (
    <View style={[styles.field, style]}>
      <Text style={[styles.label, themedStyles.supportingText]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.appBackground === '#000000' ? theme.appTextMuted : '#8A9A9A'}
        editable={editable}
        multiline={multiline}
        style={[styles.input, themedStyles.input, multiline && styles.inputMultiline]}
      />
    </View>
  );
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  const isDark = theme.appBackground === '#000000';

  return StyleSheet.create({
    card: {
      backgroundColor: theme.appSurface,
      borderColor: isDark ? 'rgba(221,251,244,0.30)' : AppTheme.colors.brand + '40',
    },
    title: {
      color: theme.appText,
    },
    supportingText: {
      color: theme.appTextSupporting,
    },
    input: {
      color: theme.appText,
      backgroundColor: theme.appInputBackground,
      borderColor: isDark ? theme.appBorder : AppTheme.colors.chip,
    },
    chip: {
      backgroundColor: theme.appControlSurface,
    },
    chipText: {
      color: theme.appText,
    },
    buttonSecondary: {
      backgroundColor: theme.appControlSurface,
    },
    buttonSecondaryText: {
      color: theme.appText,
    },
    errorText: {
      color: isDark ? AppTheme.colors.dangerLight : (AppTheme.colors.danger ?? '#B00020'),
    },
  });
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: AppTheme.colors.surface,
    borderWidth: 1,
    borderColor: AppTheme.colors.brand + '40',
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: AppTheme.colors.text,
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
    color: AppTheme.colors.textSoft,
    marginBottom: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: AppTheme.colors.textSoft,
    marginTop: 4,
  },
  field: {
    gap: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: AppTheme.colors.chip,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: AppTheme.colors.text,
    backgroundColor: AppTheme.colors.white,
  },
  inputMultiline: {
    minHeight: 64,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  half: {
    flex: 1,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: AppTheme.colors.chip,
  },
  chipSelected: {
    backgroundColor: AppTheme.colors.brand,
  },
  chipText: {
    fontSize: 13,
    color: AppTheme.colors.text,
  },
  chipTextSelected: {
    color: AppTheme.colors.white,
    fontWeight: '600',
  },
  actions: {
    marginTop: 8,
    gap: 8,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonPrimary: {
    backgroundColor: AppTheme.colors.brand,
  },
  buttonSecondary: {
    backgroundColor: AppTheme.colors.chip,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPrimaryText: {
    color: AppTheme.colors.white,
    fontWeight: '700',
    fontSize: 14,
  },
  buttonSecondaryText: {
    color: AppTheme.colors.text,
    fontWeight: '600',
    fontSize: 14,
  },
  error: {
    color: AppTheme.colors.danger ?? '#B00020',
    fontSize: 13,
  },
});

/**
 * "Your Decisions" section — caregiver-facing history of recent overrides,
 * acknowledgements, and observations. Replaces the raw audit log view in
 * the normal (non-dev) mode per planning/29_hitl-promotion-plan.md.
 */

import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import type { TranslateFn } from '@/localization/i18n';
import {
  listCaregiverDecisions,
  type CaregiverDecisionRow,
} from '@/hooks/usePendingReviews';

type Props = {
  patientFirstName: string;
  /** Show all rows expanded by default. Defaults to a 3-row preview. */
  limit?: number;
  initiallyExpanded?: boolean;
};

function formatRelativeDate(iso: string, locale: string, t: TranslateFn): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return iso;
  const diffMs = Date.now() - timestamp;
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < day) {
    const hours = Math.round(diffMs / (60 * 60 * 1000));
    if (hours <= 0) return t('decisions.time.justNow');
    if (hours === 1) return t('decisions.time.hourAgo');
    return t('decisions.time.hoursAgo', { count: hours });
  }
  if (diffMs < 7 * day) {
    const days = Math.round(diffMs / day);
    if (days === 1) return t('decisions.time.yesterday');
    return t('decisions.time.daysAgo', { count: days });
  }
  return new Date(timestamp).toLocaleDateString(locale);
}

function formatDecisionLine(row: CaregiverDecisionRow, patientFirstName: string, t: TranslateFn): string {
  const subject = row.alertTitle
    ? `"${row.alertTitle}"`
    : t('decisions.subject.alertAbout', { patient: patientFirstName });
  const verb = formatDecisionVerb(row, t);
  const summary = formatDecisionSummary(row.summary, t);

  return summary
    ? t('decisions.lineWithSummary', { verb, subject, summary })
    : t('decisions.line', { verb, subject });
}

function formatDecisionVerb(row: CaregiverDecisionRow, t: TranslateFn): string {
  switch (row.type) {
    case 'override':
      return t('decisions.verb.override');
    case 'answer_clarifying_question':
      return t('decisions.verb.answerClarifyingQuestion');
    case 'ask_slm':
      return t('decisions.verb.askSlm');
    case 'log_observation':
      return t('decisions.verb.logObservation');
    case 'acknowledge_alert':
      return t('decisions.verb.acknowledgeAlert');
    case 'resolve_alert':
      return t('decisions.verb.resolveAlert');
    case 'threshold_recommendation_apply':
      return t('decisions.verb.thresholdApply');
    case 'threshold_recommendation_dismiss':
      return t('decisions.verb.thresholdDismiss');
    default:
      return row.verb;
  }
}

function formatDecisionSummary(summary: string, t: TranslateFn): string {
  const text = summary.trim();
  if (!text) return '';
  if (text === 'No note provided') return t('decisions.summary.noNote');
  if (text === 'Asked the Concierge to explain the alert') return t('decisions.summary.askSlm');
  if (text === 'Logged an observation') return t('decisions.summary.loggedObservation');
  if (text === 'Personalized a threshold') return t('decisions.summary.personalizedThreshold');
  if (text === 'Kept current threshold') return t('decisions.summary.keptThreshold');
  if (text.startsWith('Note:')) {
    return t('decisions.summary.note', { note: stripSummaryValue(text.slice('Note:'.length)) });
  }
  if (text.startsWith('Chose:')) {
    return t('decisions.summary.chose', { option: stripSummaryValue(text.slice('Chose:'.length)) });
  }
  if (text.startsWith('Observation:')) {
    return t('decisions.summary.observation', {
      observation: stripSummaryValue(text.slice('Observation:'.length)),
    });
  }
  return summary;
}

function stripSummaryValue(value: string): string {
  return value
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/^â€œ|â€$/g, '')
    .trim();
}

export function YourDecisionsSection({
  patientFirstName,
  limit = 20,
  initiallyExpanded = false,
}: Props) {
  const theme = useTheme();
  const { locale, t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const [rows] = useState<CaregiverDecisionRow[]>(() => listCaregiverDecisions(limit));
  const [open, setOpen] = useState(initiallyExpanded);

  return (
    <View style={[styles.card, themedStyles.card]}>
      <Pressable
        style={styles.header}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={open ? t('decisions.a11y.collapse') : t('decisions.a11y.expand')}
      >
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>{t('decisions.title')}</Text>
          <Text style={[styles.subtitle, themedStyles.secondaryText]}>
            {t('decisions.subtitle')}
          </Text>
        </View>
        <Text style={[styles.chevron, themedStyles.secondaryText]}>{open ? '\u25BE' : '\u25B8'}</Text>
      </Pressable>

      {open ? (
        rows.length === 0 ? (
          <Text style={[styles.emptyText, themedStyles.secondaryText]}>
            {t('decisions.empty')}
          </Text>
        ) : (
          <View style={[styles.list, themedStyles.list]}>
            {rows.map((row) => (
              <View key={row.actionId} style={[styles.row, themedStyles.row]}>
                <Text style={[styles.line, themedStyles.primaryText]}>
                  {formatDecisionLine(row, patientFirstName, t)}
                </Text>
                <Text style={[styles.meta, themedStyles.secondaryText]}>{formatRelativeDate(row.createdAt, locale, t)}</Text>
              </View>
            ))}
          </View>
        )
      ) : null}
    </View>
  );
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.appSurface,
      borderColor: theme.appDecisionBorder,
    },
    list: { borderTopColor: theme.appDecisionBorder },
    row: { borderBottomColor: theme.appDecisionDivider },
    primaryText: { color: theme.appText },
    secondaryText: { color: theme.appTextSupporting },
  });
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  headerText: { flex: 1, gap: 2 },
  eyebrow: {
    color: AppTheme.colors.brand,
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  subtitle: {
    fontSize: 13,
  },
  chevron: {
    fontSize: 18,
    fontWeight: '700',
  },
  emptyText: {
    padding: 16,
    fontSize: 13,
    lineHeight: 19,
  },
  list: { borderTopWidth: 1 },
  row: {
    padding: 14,
    borderBottomWidth: 1,
    gap: 4,
  },
  line: {
    fontSize: 14,
    lineHeight: 20,
  },
  meta: {
    fontSize: 12,
  },
});

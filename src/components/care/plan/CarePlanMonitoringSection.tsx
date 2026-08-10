/**
 * Care plan "Monitoring & alert cutoffs" section — deeper than Dashboard’s
 * SpO2/HR teaser. Recent readings live in a sibling card on the Care spine.
 */

import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import type { TranslateFn } from '@/localization/i18n';
import { createThemedSectionStyles } from './carePlanSectionStyles';
import type { Threshold } from '@/data/types';

export interface CarePlanMonitoringBaselines {
  spo2Cutoff?: string | null;
  baselineHeartRate?: string | null;
  baselineBloodOxygen?: string | null;
  baselineRespiratoryRate?: string | null;
}

export interface CarePlanMonitoringSectionProps {
  thresholds: Threshold[];
  baselines?: CarePlanMonitoringBaselines | null;
}

const VITAL_UNIT: Record<string, string> = {
  spo2: '%',
  heart_rate: ' bpm',
  respiratory_rate: ' /min',
  blood_pressure_systolic: ' mmHg',
  blood_pressure_diastolic: ' mmHg',
  temperature: '°',
  blood_glucose: '',
};

type SeverityBucket = 1 | 2 | 3;

const SEVERITY_TONE: Record<SeverityBucket, 'emergency' | 'watch' | 'info'> = {
  3: 'emergency',
  2: 'watch',
  1: 'info',
};

function severityBucket(severity: number): SeverityBucket {
  if (severity >= 3) return 3;
  if (severity === 2) return 2;
  return 1;
}

function vitalLabel(vitalType: string, t: TranslateFn): string {
  switch (vitalType) {
    case 'spo2':
      return t('care.monitoring.vital.spo2');
    case 'heart_rate':
      return t('care.monitoring.vital.heartRate');
    case 'respiratory_rate':
      return t('care.monitoring.vital.respiratoryRate');
    case 'blood_pressure_systolic':
      return t('care.monitoring.vital.bpSystolic');
    case 'blood_pressure_diastolic':
      return t('care.monitoring.vital.bpDiastolic');
    case 'temperature':
      return t('care.monitoring.vital.temperature');
    case 'blood_glucose':
      return t('care.monitoring.vital.bloodGlucose');
    default:
      return vitalType.replace(/_/g, ' ');
  }
}

function severityTitle(severity: SeverityBucket, t: TranslateFn): string {
  switch (severity) {
    case 3:
      return t('care.monitoring.severity.emergency.title');
    case 2:
      return t('care.monitoring.severity.watch.title');
    case 1:
      return t('care.monitoring.severity.info.title');
  }
}

function severitySubtitle(severity: SeverityBucket, t: TranslateFn): string {
  switch (severity) {
    case 3:
      return t('care.monitoring.severity.emergency.subtitle');
    case 2:
      return t('care.monitoring.severity.watch.subtitle');
    case 1:
      return t('care.monitoring.severity.info.subtitle');
  }
}

function sourceLabel(source: Threshold['source'] | string, t: TranslateFn): string {
  switch (source) {
    case 'pcp_careplan':
      return t('care.monitoring.source.carePlan');
    case 'caregiver_override':
      return t('care.monitoring.source.caregiver');
    case 'ml_baseline':
      return t('care.monitoring.source.baseline');
    default:
      return t('care.monitoring.source.app');
  }
}

function plainMeaning(threshold: Threshold, t: TranslateFn): string {
  const vital = vitalLabel(threshold.vitalType, t).toLowerCase();
  const unit = VITAL_UNIT[threshold.vitalType] ?? '';
  const value = `${threshold.value}${unit}`;
  if (threshold.direction === 'below') {
    return t('care.monitoring.meaning.below', { vital, value });
  }
  if (threshold.direction === 'above') {
    return t('care.monitoring.meaning.above', { vital, value });
  }
  return t('care.monitoring.meaning.at', { vital, value });
}

function headline(threshold: Threshold, t: TranslateFn): string {
  const vital = vitalLabel(threshold.vitalType, t);
  const unit = VITAL_UNIT[threshold.vitalType] ?? '';
  const value = `${threshold.value}${unit}`;
  if (threshold.direction === 'below') {
    return t('care.monitoring.headline.below', { vital, value });
  }
  if (threshold.direction === 'above') {
    return t('care.monitoring.headline.above', { vital, value });
  }
  return t('care.monitoring.headline.at', { vital, value });
}

function baselineRows(
  baselines: CarePlanMonitoringBaselines | null | undefined,
  t: TranslateFn,
): {
  label: string;
  value: string;
}[] {
  if (!baselines) return [];
  const rows: { label: string; value: string }[] = [];
  const spo2 = baselines.spo2Cutoff?.trim() || baselines.baselineBloodOxygen?.trim();
  if (spo2) rows.push({ label: t('care.monitoring.baseline.spo2'), value: spo2 });
  if (baselines.baselineHeartRate?.trim()) {
    rows.push({ label: t('care.monitoring.baseline.heartRate'), value: baselines.baselineHeartRate.trim() });
  }
  if (baselines.baselineRespiratoryRate?.trim()) {
    rows.push({
      label: t('care.monitoring.baseline.respiratoryRate'),
      value: baselines.baselineRespiratoryRate.trim(),
    });
  }
  return rows;
}

export function CarePlanMonitoringSection({
  thresholds,
  baselines,
}: CarePlanMonitoringSectionProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const sectionStyles = useMemo(() => createThemedSectionStyles(theme), [theme]);
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [howMonitorExpanded, setHowMonitorExpanded] = useState(false);
  const baseline = useMemo(() => baselineRows(baselines, t), [baselines, t]);

  const grouped = useMemo(() => {
    const map = new Map<SeverityBucket, Threshold[]>();
    for (const t of thresholds) {
      const b = severityBucket(t.severity);
      const list = map.get(b) ?? [];
      list.push(t);
      map.set(b, list);
    }
    return ([3, 2, 1] as SeverityBucket[])
      .map((severity) => ({
        severity: severity,
        meta: {
          title: severityTitle(severity, t),
          subtitle: severitySubtitle(severity, t),
          tone: SEVERITY_TONE[severity],
        },
        items: map.get(severity) ?? [],
      }))
      .filter((g) => g.items.length > 0);
  }, [thresholds, t]);

  return (
    <View style={sectionStyles.card} accessible accessibilityLabel={t('care.monitoring.accessibilityLabel')}>
      <View style={sectionStyles.headerRow}>
        <Text style={sectionStyles.title}>{t('care.monitoring.title')}</Text>
        <View style={sectionStyles.pill}>
          <Text style={sectionStyles.pillText}>{thresholds.length}</Text>
        </View>
      </View>

      {baseline.length > 0 ? (
        <View style={[styles.baselineCard, themedStyles.baselineCard]}>
          <Text style={[styles.baselineTitle, themedStyles.mutedText]}>
            {t('care.monitoring.fromOnboarding')}
          </Text>
          {baseline.map((row) => (
            <View key={row.label} style={styles.baselineRow}>
              <Text style={[styles.baselineLabel, themedStyles.supportingText]}>{row.label}</Text>
              <Text style={[styles.baselineValue, themedStyles.primaryText]}>{row.value}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {grouped.length > 0 ? (
        <View style={styles.groupList}>
          {grouped.map((group) => (
            <View
              key={group.severity}
              style={[
                styles.groupCard,
                themedStyles.groupCard,
                group.meta.tone === 'emergency' && styles.groupEmergency,
                group.meta.tone === 'emergency' && themedStyles.groupEmergency,
                group.meta.tone === 'watch' && styles.groupWatch,
                group.meta.tone === 'watch' && themedStyles.groupWatch,
                group.meta.tone === 'info' && styles.groupInfo,
                group.meta.tone === 'info' && themedStyles.groupInfo,
              ]}
            >
              <Text style={[styles.groupTitle, themedStyles.primaryText]}>{group.meta.title}</Text>
              <Text style={[styles.groupSubtitle, themedStyles.supportingText]}>{group.meta.subtitle}</Text>
              {group.items.map((threshold) => {
                const open = expandedId === threshold.thresholdId;
                return (
                  <Pressable
                    key={threshold.thresholdId}
                    style={[styles.ruleRow, themedStyles.ruleRow]}
                    onPress={() =>
                      setExpandedId((current) =>
                        current === threshold.thresholdId ? null : threshold.thresholdId,
                      )
                    }
                    accessibilityRole="button"
                    accessibilityState={{ expanded: open }}
                    accessibilityLabel={headline(threshold, t)}
                  >
                    <View style={styles.ruleHeader}>
                      <Text style={[styles.ruleHeadline, themedStyles.primaryText]}>
                        {headline(threshold, t)}
                      </Text>
                      <Text style={[styles.ruleChevron, themedStyles.mutedText]}>
                        {open ? '▾' : '▸'}
                      </Text>
                    </View>
                    {open ? (
                      <View style={styles.ruleBody}>
                        <Text style={[styles.ruleMeaning, themedStyles.supportingText]}>{plainMeaning(threshold, t)}</Text>
                        <Text style={[styles.ruleSource, themedStyles.actionText]}>{sourceLabel(threshold.source, t)}</Text>
                        <Text style={[styles.ruleSeverity, themedStyles.mutedText]}>
                          {t('care.monitoring.urgency', { level: severityBucket(threshold.severity) })}
                        </Text>
                      </View>
                    ) : (
                      <Text style={[styles.ruleHint, themedStyles.mutedText]} numberOfLines={1}>
                        {plainMeaning(threshold, t)}
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      ) : (
        <View style={[styles.howMonitorCard, themedStyles.howMonitorCard]}>
          <Pressable
            style={styles.howMonitorHeader}
            onPress={() => setHowMonitorExpanded((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: howMonitorExpanded }}
            accessibilityLabel={
              howMonitorExpanded
                ? t('care.monitoring.howA11yCollapse')
                : t('care.monitoring.howA11yExpand')
            }
          >
            <Text style={[styles.howMonitorTitle, themedStyles.primaryText]}>
              {t('care.monitoring.howTitle')}
            </Text>
            <Text style={[styles.ruleChevron, themedStyles.mutedText]}>
              {howMonitorExpanded ? '▾' : '▸'}
            </Text>
          </Pressable>
          {howMonitorExpanded ? (
            <View style={styles.howMonitorBody}>
              <Text style={[styles.howMonitorText, themedStyles.supportingText]}>
                {t('care.monitoring.how1')}
              </Text>
              <Text style={[styles.howMonitorText, themedStyles.supportingText]}>
                {t('care.monitoring.how2')}
              </Text>
              <Text style={[styles.howMonitorText, themedStyles.supportingText]}>
                {t('care.monitoring.how3')}
              </Text>
              <Text style={[styles.howMonitorText, themedStyles.supportingText]}>
                {t('care.monitoring.how4')}
              </Text>
              <Text style={[styles.howMonitorFootnote, themedStyles.actionText]}>
                {t('care.monitoring.footnote')}
              </Text>
            </View>
          ) : (
            <Text style={[styles.howMonitorHint, themedStyles.mutedText]}>
              {t('care.monitoring.hint')}
            </Text>
          )}
        </View>
      )}

    </View>
  );
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  const isDark = theme.appBackground === '#000000';
  const actionText = isDark ? AppTheme.colors.brandPale : AppTheme.colors.brand;

  return StyleSheet.create({
    baselineCard: {
      backgroundColor: theme.appControlSurface,
      borderColor: theme.appBorder,
    },
    groupCard: {
      borderColor: theme.appBorder,
    },
    groupEmergency: {
      borderColor: isDark ? AppTheme.colors.dangerSoft : AppTheme.colors.danger,
      backgroundColor: isDark ? 'rgba(245, 42, 55, 0.14)' : AppTheme.colors.dangerLight,
    },
    groupWatch: {
      borderColor: AppTheme.colors.attentionAmber,
      backgroundColor: isDark ? 'rgba(245, 158, 11, 0.14)' : '#FFF8EB',
    },
    groupInfo: {
      borderColor: theme.appBorder,
      backgroundColor: theme.appControlSurface,
    },
    ruleRow: {
      backgroundColor: theme.appSurface,
      borderColor: theme.appBorder,
    },
    howMonitorCard: {
      backgroundColor: theme.appControlSurface,
      borderColor: theme.appBorder,
    },
    primaryText: {
      color: theme.appText,
    },
    supportingText: {
      color: theme.appTextSupporting,
    },
    mutedText: {
      color: theme.appTextMuted,
    },
    actionText: {
      color: actionText,
    },
  });
}

const styles = StyleSheet.create({
  baselineCard: {
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 12,
    marginTop: 8,
    marginBottom: 10,
    gap: 8,
  },
  baselineTitle: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  baselineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  baselineLabel: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  baselineValue: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  groupList: {
    gap: 12,
    marginTop: 4,
  },
  groupCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  groupEmergency: {
    borderColor: AppTheme.colors.danger,
    backgroundColor: AppTheme.colors.dangerLight,
  },
  groupWatch: {
    borderColor: '#E1A53C',
    backgroundColor: '#FFF8EB',
  },
  groupInfo: {
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.softSurface,
  },
  groupTitle: {
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  groupSubtitle: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    marginBottom: 2,
  },
  ruleRow: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  ruleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ruleHeadline: {
    flex: 1,
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  ruleChevron: {
    color: AppTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: '900',
  },
  ruleHint: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  ruleBody: {
    marginTop: 8,
    gap: 4,
  },
  ruleMeaning: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  ruleSource: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: '800',
  },
  ruleSeverity: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  vitalsKicker: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  howMonitorCard: {
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.softSurface,
    padding: 12,
  },
  howMonitorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  howMonitorTitle: {
    flex: 1,
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  howMonitorHint: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
  howMonitorBody: {
    marginTop: 10,
    gap: 8,
  },
  howMonitorText: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  howMonitorFootnote: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
});

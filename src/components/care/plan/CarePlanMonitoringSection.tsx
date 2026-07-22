/**
 * Care plan "Monitoring" section — deeper than Dashboard’s SpO2/HR teaser.
 *
 * Severity-grouped threshold cards with plain-language meaning and source,
 * plus optional baseline context and the vitals observation chart.
 */

import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ObservationVitalsCard } from '@/components/care/ObservationVitalsCard';
import { AppTheme } from '@/constants/theme';
import { sectionStyles } from './carePlanSectionStyles';
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

const VITAL_LABEL: Record<string, string> = {
  spo2: 'Oxygen (SpO₂)',
  heart_rate: 'Heart rate',
  respiratory_rate: 'Breathing rate',
  blood_pressure_systolic: 'Blood pressure (top number)',
  blood_pressure_diastolic: 'Blood pressure (bottom number)',
  temperature: 'Temperature',
  blood_glucose: 'Blood glucose',
};

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

const SEVERITY_META: Record<
  SeverityBucket,
  { title: string; subtitle: string; tone: 'emergency' | 'watch' | 'info' }
> = {
  3: {
    title: 'Emergency cutoffs',
    subtitle:
      'If readings cross these lines, treat it as urgent — follow your emergency plan and call for help when needed.',
    tone: 'emergency',
  },
  2: {
    title: 'Watch closely',
    subtitle:
      'These levels mean you should check on the person, log what you see, and be ready to contact the care team.',
    tone: 'watch',
  },
  1: {
    title: 'Gentle heads-up',
    subtitle:
      'Small drifts worth noticing. Usually means keep monitoring and note anything unusual.',
    tone: 'info',
  },
};

function severityBucket(severity: number): SeverityBucket {
  if (severity >= 3) return 3;
  if (severity === 2) return 2;
  return 1;
}

function sourceLabel(source: Threshold['source'] | string): string {
  switch (source) {
    case 'pcp_careplan':
      return 'From the care plan / care team';
    case 'caregiver_override':
      return 'Adjusted by you';
    case 'ml_baseline':
      return 'From usual readings (app baseline)';
    default:
      return 'Configured in the app';
  }
}

function plainMeaning(t: Threshold): string {
  const vital = VITAL_LABEL[t.vitalType] ?? t.vitalType.replace(/_/g, ' ');
  const unit = VITAL_UNIT[t.vitalType] ?? '';
  const value = `${t.value}${unit}`;
  if (t.direction === 'below') {
    return `Alert when ${vital.toLowerCase()} falls under ${value}.`;
  }
  if (t.direction === 'above') {
    return `Alert when ${vital.toLowerCase()} rises over ${value}.`;
  }
  return `Alert when ${vital.toLowerCase()} is at ${value}.`;
}

function headline(t: Threshold): string {
  const vital = VITAL_LABEL[t.vitalType] ?? t.vitalType;
  const unit = VITAL_UNIT[t.vitalType] ?? '';
  const dir =
    t.direction === 'below' ? 'under' : t.direction === 'above' ? 'over' : 'at';
  return `${vital} ${dir} ${t.value}${unit}`;
}

function baselineRows(baselines: CarePlanMonitoringBaselines | null | undefined): {
  label: string;
  value: string;
}[] {
  if (!baselines) return [];
  const rows: { label: string; value: string }[] = [];
  const spo2 = baselines.spo2Cutoff?.trim() || baselines.baselineBloodOxygen?.trim();
  if (spo2) rows.push({ label: 'Usual SpO₂ cutoff', value: spo2 });
  if (baselines.baselineHeartRate?.trim()) {
    rows.push({ label: 'Usual heart rate range', value: baselines.baselineHeartRate.trim() });
  }
  if (baselines.baselineRespiratoryRate?.trim()) {
    rows.push({
      label: 'Usual breathing rate',
      value: baselines.baselineRespiratoryRate.trim(),
    });
  }
  return rows;
}

export function CarePlanMonitoringSection({
  thresholds,
  baselines,
}: CarePlanMonitoringSectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [howMonitorExpanded, setHowMonitorExpanded] = useState(false);
  const baseline = useMemo(() => baselineRows(baselines), [baselines]);

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
        meta: SEVERITY_META[severity],
        items: map.get(severity) ?? [],
      }))
      .filter((g) => g.items.length > 0);
  }, [thresholds]);

  return (
    <View style={sectionStyles.card} accessible accessibilityLabel="Monitoring">
      <View style={sectionStyles.headerRow}>
        <Text style={sectionStyles.title}>Monitoring & alert cutoffs</Text>
        <View style={sectionStyles.pill}>
          <Text style={sectionStyles.pillText}>{thresholds.length}</Text>
        </View>
      </View>

      {baseline.length > 0 ? (
        <View style={styles.baselineCard}>
          <Text style={styles.baselineTitle}>From onboarding / care plan</Text>
          {baseline.map((row) => (
            <View key={row.label} style={styles.baselineRow}>
              <Text style={styles.baselineLabel}>{row.label}</Text>
              <Text style={styles.baselineValue}>{row.value}</Text>
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
                group.meta.tone === 'emergency' && styles.groupEmergency,
                group.meta.tone === 'watch' && styles.groupWatch,
                group.meta.tone === 'info' && styles.groupInfo,
              ]}
            >
              <Text style={styles.groupTitle}>{group.meta.title}</Text>
              <Text style={styles.groupSubtitle}>{group.meta.subtitle}</Text>
              {group.items.map((t) => {
                const open = expandedId === t.thresholdId;
                return (
                  <Pressable
                    key={t.thresholdId}
                    style={styles.ruleRow}
                    onPress={() =>
                      setExpandedId((current) =>
                        current === t.thresholdId ? null : t.thresholdId,
                      )
                    }
                    accessibilityRole="button"
                    accessibilityState={{ expanded: open }}
                    accessibilityLabel={headline(t)}
                  >
                    <View style={styles.ruleHeader}>
                      <Text style={styles.ruleHeadline}>{headline(t)}</Text>
                      <Text style={styles.ruleChevron}>{open ? '▾' : '▸'}</Text>
                    </View>
                    {open ? (
                      <View style={styles.ruleBody}>
                        <Text style={styles.ruleMeaning}>{plainMeaning(t)}</Text>
                        <Text style={styles.ruleSource}>{sourceLabel(t.source)}</Text>
                        <Text style={styles.ruleSeverity}>
                          Urgency level {severityBucket(t.severity)} of 3
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.ruleHint} numberOfLines={1}>
                        {plainMeaning(t)}
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.howMonitorCard}>
          <Pressable
            style={styles.howMonitorHeader}
            onPress={() => setHowMonitorExpanded((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: howMonitorExpanded }}
            accessibilityLabel={`How Health Monitor works${howMonitorExpanded ? ' — collapse' : ' — expand'}`}
          >
            <Text style={styles.howMonitorTitle}>How Health Monitor works</Text>
            <Text style={styles.ruleChevron}>{howMonitorExpanded ? '▾' : '▸'}</Text>
          </Pressable>
          {howMonitorExpanded ? (
            <View style={styles.howMonitorBody}>
              <Text style={styles.howMonitorText}>
                1. Ask a vitals or what-if question in Concierge (e.g. “What if SpO₂ is
                86% and heart rate is 118?”).
              </Text>
              <Text style={styles.howMonitorText}>
                2. When vitals are detected, you’ll see “activating Health Monitor”
                and it runs right away.
              </Text>
              <Text style={styles.howMonitorText}>
                3. Severity 1–2 may ask for observations. In developer mode, it may
                also offer a local demo follow-up appointment.
              </Text>
              <Text style={styles.howMonitorText}>
                4. After you finish, Concierge explains with that context. Severity 3
                skips review/scheduling and may show a critical banner — never
                auto-calls 911.
              </Text>
              <Text style={styles.howMonitorFootnote}>
                SpO₂ is percent (86, not 0.86). Pure med/schedule questions skip Health
                Monitor. Personalized cutoffs from the care plan appear above when
                available.
              </Text>
            </View>
          ) : (
            <Text style={styles.howMonitorHint}>
              Tap to learn how Health Monitor uses vitals and what-if questions.
            </Text>
          )}
        </View>
      )}

      <View style={sectionStyles.divider} />
      <Text style={styles.vitalsKicker}>Recent readings</Text>
      <ObservationVitalsCard />
    </View>
  );
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

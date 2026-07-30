import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppTheme } from '@/constants/theme';
import { CitationList } from '@/components/common/CitationList';
import { usePatientRecord } from '@/contexts/patient-record-context';
import {
  getKnowledgePackInstallState,
  subscribeKnowledgePackInstall,
} from '@/clinical-evidence/pack';
import type { PatientCondition } from '@/data/types';
import { useActivePatientView } from '@/hooks/useActivePatientView';
import {
  displayClinical,
  displayEntered,
  getCaregiverDisplay,
  getPatientAgeDisplay,
  getPatientDisplayName,
  getPrimaryDiagnosisDisplay,
  NOT_AVAILABLE,
} from '@/utils/patientDisplay';
import { useTheme } from '@/hooks/use-theme';

export function PatientSummaryCard() {
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const router = useRouter();
  const { snapshot, ready, error, refresh } = usePatientRecord();
  const [expanded, setExpanded] = useState(false);
  const [referencesOpen, setReferencesOpen] = useState(false);
  const activePatient = useActivePatientView();
  const packUi = useSyncExternalStore(
    subscribeKnowledgePackInstall,
    getKnowledgePackInstallState,
    getKnowledgePackInstallState,
  );

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  if (!ready) {
    return (
      <View style={[styles.card, themedStyles.card]}>
        <Text style={[styles.loadingText, themedStyles.secondaryText]}>Loading patient record…</Text>
      </View>
    );
  }

  if (!snapshot) {
    return (
      <View style={[styles.card, themedStyles.card]}>
        <Text style={[styles.unavailableTitle, themedStyles.primaryText]}>Patient record unavailable</Text>
        <Text style={[styles.unavailableText, themedStyles.secondaryText]}>
          {error
            ? 'The patient record could not be loaded. Try again or return to onboarding.'
            : 'No patient record is available yet. Complete onboarding to create one.'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading patient record"
          onPress={refresh}
          style={styles.retryButton}
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const patientName = getPatientDisplayName(activePatient);
  const patientAge = getPatientAgeDisplay(activePatient);
  const caregiverName = getCaregiverDisplay(activePatient);
  const primaryCondition = activePatient?.primaryDiagnosis ?? null;
  const comorbidities = activePatient?.comorbidities ?? [];
  const sourceCount = countKnowledgeSources(snapshot.knowledgeStats.bySource);
  const cacheSummary = formatKnowledgeCacheSummary(snapshot.knowledgeStats.total, sourceCount);
  const sourceBreakdown = formatKnowledgeSourceBreakdown(
    snapshot.knowledgeStats.bySource,
  );
  // Global pack (new system) is the primary clinical knowledge surface;
  // patient overlay counts are the secondary detail.
  const packSummary =
    packUi.status === 'ready' && packUi.chunksInstalled > 0
      ? `Clinical knowledge · ${packUi.chunksInstalled.toLocaleString()} references on device`
      : null;

  const primaryDisplay = primaryCondition
    ? `${primaryCondition.icd10 ? `${primaryCondition.icd10} · ` : ''}${primaryCondition.name}`
    : getPrimaryDiagnosisDisplay(activePatient);
  const needsClinicalImport = primaryDisplay === NOT_AVAILABLE;

  return (
    <View style={[styles.card, themedStyles.card]}>
      <View style={styles.headerRow}>
        <View style={[styles.avatar, themedStyles.brandSoftSurface]}>
          <Text style={[styles.avatarText, themedStyles.accentText]}>{getInitials(patientName)}</Text>
        </View>

        <View style={styles.patientTextBlock}>
          <View style={styles.nameRow}>
            <Text style={[styles.patientName, themedStyles.primaryText]}>{patientName}</Text>

            {comorbidities.length > 0 ? (
              <View style={[styles.comorbidityBadge, themedStyles.warningSurface]}>
                <Text style={styles.comorbidityBadgeText}>
                  {comorbidities.length} Comorbidit{comorbidities.length === 1 ? 'y' : 'ies'}
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={[styles.patientMeta, themedStyles.secondaryText]}>
            Age {patientAge} · {caregiverName}
          </Text>
        </View>
      </View>

      <View style={[styles.diagnosisBox, themedStyles.controlSurface]}>
        <Text style={[styles.diagnosisLabel, themedStyles.sectionText]}>Primary diagnosis</Text>
        <Text style={[styles.diagnosisText, themedStyles.primaryText]}>{primaryDisplay}</Text>
        {primaryCondition?.category ? (
          <Text style={[styles.categoryText, themedStyles.secondaryText]}>{primaryCondition.category}</Text>
        ) : null}
      </View>

      {needsClinicalImport ? (
        <Pressable
          style={[styles.importBanner, themedStyles.importBanner]}
          onPress={() => router.push({ pathname: '/more', params: { focus: 'ehr-import' } } as never)}
        >
          <Text style={[styles.importBannerTitle, themedStyles.importBannerTitle]}>Latest clinical details not available</Text>
          <Text style={[styles.importBannerText, themedStyles.secondaryText]}>
            Import the latest EHR from Settings to refresh diagnoses and visit data.
          </Text>
        </Pressable>
      ) : null}

      {comorbidities.length > 0 ? (
        <Pressable
          style={styles.comorbidityExpand}
          onPress={() => setExpanded((e) => !e)}
        >
          <Text style={[styles.comorbidityToggle, themedStyles.accentText]}>
            {expanded ? '▼' : '▶'} Comorbidities ({comorbidities.length})
          </Text>
          {expanded ? (
            <View style={styles.comorbidityList}>
              {comorbidities.map((c, i) => (
                <ComorbidityRow key={c.conditionId ?? i} condition={c} />
              ))}
            </View>
          ) : null}
        </Pressable>
      ) : null}

      <View style={styles.infoGrid}>
        <InfoBox label="SpO₂ cutoff" value={displayClinical(activePatient?.spo2Cutoff)} />
        <InfoBox label="Baseline HR" value={displayEntered(activePatient?.baselineHeartRate)} />
      </View>

      {snapshot.bundleStatus.state === 'in_flight' ? (
        <View style={[styles.bundlePendingPill, themedStyles.bundlePendingPill]}>
          <Text style={styles.bundlePendingText}>Updating clinical knowledge</Text>
          {snapshot.bundleStatus.phase ? (
            <Text style={[styles.bundlePendingDetail, themedStyles.secondaryText]} numberOfLines={2}>
              {snapshot.bundleStatus.phase}
            </Text>
          ) : null}
          <View style={[styles.bundleProgressTrack, themedStyles.progressTrack]}>
            <View
              style={[
                styles.bundleProgressFill,
                {
                  width: `${Math.round(
                    Math.min(1, Math.max(0, snapshot.bundleStatus.progress ?? 0.05)) * 100,
                  )}%`,
                },
              ]}
            />
          </View>
          <Text style={[styles.bundlePendingDetail, themedStyles.secondaryText]}>
            {typeof snapshot.bundleStatus.completedSteps === 'number' &&
            typeof snapshot.bundleStatus.totalSteps === 'number' &&
            snapshot.bundleStatus.totalSteps > 0
              ? `${snapshot.bundleStatus.completedSteps} of ${snapshot.bundleStatus.totalSteps} steps`
              : cacheSummary ?? 'Downloading references…'}
            {snapshot.bundleStatus.chunksAdded > 0
              ? ` · ${snapshot.bundleStatus.chunksAdded} cached`
              : ''}
          </Text>
        </View>
      ) : snapshot.bundleStatus.state === 'failed' ? (
        <View style={[styles.bundleFailedPill, themedStyles.bundleFailedPill]}>
          <Text style={[styles.bundleFailedText, themedStyles.bundleFailedText]}>Clinical knowledge update incomplete — using offline knowledge</Text>
          {cacheSummary ? (
            <Text style={[styles.bundleFailedDetail, themedStyles.secondaryText]}>{cacheSummary}</Text>
          ) : null}
        </View>
      ) : packSummary != null || snapshot.knowledgeStats.total > 0 ? (
        <Pressable
          style={[styles.knowledgeStatsPill, themedStyles.knowledgeStatsPill]}
          onPress={() => setReferencesOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: referencesOpen }}
          accessibilityLabel={`${(packSummary ?? cacheSummary) ?? 'Clinical knowledge'}. ${referencesOpen ? 'Hide' : 'Show'} sources.`}
        >
          <Text style={[styles.knowledgeStatsText, themedStyles.knowledgeStatsText]}>{packSummary ?? cacheSummary}</Text>
          {sourceBreakdown && !referencesOpen ? (
            <Text style={[styles.knowledgeStatsDetail, themedStyles.secondaryText]}>{sourceBreakdown}</Text>
          ) : null}
          <Text style={[styles.knowledgeStatsHint, themedStyles.knowledgeStatsHint]}>
            {referencesOpen ? 'Hide sources ▴' : 'Tap to view sources ▾'}
          </Text>
          {referencesOpen ? (
            <CitationList
              sources={Object.entries(snapshot.knowledgeStats.bySource)
                .filter(([, count]) => count > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([src, count]) => ({
                  label: formatSourceLabel(src),
                  count,
                }))}
              collapsible={false}
              compact
              maxItems={10}
            />
          ) : null}
        </Pressable>
      ) : null}
    </View>
  );
}

function ComorbidityRow({ condition }: { condition: PatientCondition }) {
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);

  return (
    <View style={styles.comorbidityItem}>
      <Text style={[styles.comorbidityBullet, themedStyles.secondaryText]}>•</Text>
      <View style={styles.comorbidityContent}>
        <Text style={[styles.comorbidityName, themedStyles.primaryText]}>
          {condition.icd10 ? `${condition.icd10} · ` : ''}{condition.name}
        </Text>
        {condition.category ? (
          <Text style={[styles.comorbidityCategory, themedStyles.secondaryText]}>{condition.category}</Text>
        ) : null}
      </View>
    </View>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);

  return (
    <View style={[styles.infoBox, themedStyles.brandSoftSurface]}>
      <Text style={[styles.infoLabel, themedStyles.secondaryText]}>{label}</Text>
      <Text style={[styles.infoValue, themedStyles.primaryText]}>{value}</Text>
    </View>
  );
}

function countKnowledgeSources(bySource: Record<string, number>): number {
  return Object.values(bySource).filter((count) => count > 0).length;
}

export function formatKnowledgeCacheSummary(
  total: number,
  sourceCount: number,
): string | null {
  if (total <= 0) return null;
  const referenceLabel = total === 1 ? 'reference' : 'references';
  const sourceLabel = sourceCount === 1 ? 'source' : 'sources';
  return `${total} cached ${referenceLabel} from ${sourceCount} ${sourceLabel}`;
}

const SOURCE_LABELS: Record<string, string> = {
  pubmed: 'Medical literature',
  medlineplus: 'Health topic summary',
  rxnorm: 'Drug information',
  dailymed: 'Drug label',
  openfda: 'Drug safety data',
  adcp_plan: 'Care plan',
  'care-plan': 'Care plan',
  'patient-plan': 'Care plan',
  synthetic: 'Sample guidance',
  'local-fixture': 'Sample guidance',
};

function formatSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.replace(/[_-]/g, ' ');
}

function formatKnowledgeSourceBreakdown(
  bySource: Record<string, number>,
): string | null {
  const entries = Object.entries(bySource)
    .filter(([, count]) => count > 0)
    .sort(([sourceA], [sourceB]) => sourceA.localeCompare(sourceB));

  if (entries.length === 0) return null;

  return entries.map(([source, count]) => `${source}: ${count}`).join(', ');
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  const isDark = theme.appBackground === '#000000';

  return StyleSheet.create({
    card: {
      backgroundColor: theme.appSurface,
      borderColor: theme.appBorder,
    },
    primaryText: {
      color: theme.appText,
    },
    secondaryText: {
      color: theme.appTextSupporting,
    },
    sectionText: {
      color: theme.appSectionText,
    },
    accentText: {
      color: isDark ? AppTheme.colors.brandPale : AppTheme.colors.brand,
    },
    brandSoftSurface: {
      backgroundColor: theme.appBrandSoftSurface,
    },
    controlSurface: {
      backgroundColor: theme.appControlSurface,
    },
    warningSurface: {
      backgroundColor: isDark ? 'rgba(249, 115, 22, 0.16)' : AppTheme.colors.warningSoft,
    },
    importBanner: {
      backgroundColor: theme.appBrandSoftSurface,
      borderColor: theme.appProfileAvatarBorder,
    },
    importBannerTitle: {
      color: isDark ? theme.appText : AppTheme.colors.brand,
    },
    bundlePendingPill: {
      backgroundColor: isDark ? 'rgba(249, 115, 22, 0.16)' : AppTheme.colors.warningSoft,
    },
    progressTrack: {
      backgroundColor: theme.appControlSurface,
    },
    bundleFailedPill: {
      backgroundColor: isDark ? 'rgba(240, 6, 22, 0.16)' : AppTheme.colors.dangerLight,
    },
    bundleFailedText: {
      color: isDark ? AppTheme.colors.dangerLight : AppTheme.colors.danger,
    },
    knowledgeStatsPill: {
      backgroundColor: isDark ? theme.appControlSurface : AppTheme.colors.brandSoft,
    },
    knowledgeStatsText: {
      color: isDark ? theme.appText : AppTheme.colors.brand,
    },
    knowledgeStatsHint: {
      color: isDark ? theme.appTextSupporting : AppTheme.colors.brandDark,
    },
  });
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    padding: 22,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    ...AppTheme.shadow,
  },
  loadingText: {
    color: AppTheme.colors.textSoft,
    fontSize: 15,
    textAlign: 'center',
    paddingVertical: 20,
  },
  unavailableTitle: {
    color: AppTheme.colors.text,
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 8,
  },
  unavailableText: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
    marginBottom: 14,
  },
  retryButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: AppTheme.colors.brand,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonText: {
    color: AppTheme.colors.white,
    fontSize: 14,
    fontWeight: '900',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: AppTheme.colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarText: {
    color: AppTheme.colors.brand,
    fontSize: 20,
    fontWeight: '900',
  },
  patientTextBlock: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  patientName: {
    color: AppTheme.colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  patientMeta: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
  },
  comorbidityBadge: {
    backgroundColor: AppTheme.colors.warningSoft,
    borderRadius: AppTheme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  comorbidityBadgeText: {
    color: AppTheme.colors.warning,
    fontSize: 11,
    fontWeight: '900',
  },
  diagnosisBox: {
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
  },
  diagnosisLabel: {
    color: AppTheme.colors.sectionText,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  diagnosisText: {
    color: AppTheme.colors.text,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '900',
  },
  categoryText: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 3,
  },
  importBanner: {
    backgroundColor: AppTheme.colors.brandSoft,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#B7FFF1',
    padding: 14,
    marginBottom: 14,
  },
  importBannerTitle: {
    color: AppTheme.colors.brand,
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 4,
  },
  importBannerText: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  comorbidityExpand: {
    marginBottom: 14,
  },
  comorbidityToggle: {
    color: AppTheme.colors.brand,
    fontSize: 13,
    fontWeight: '900',
  },
  comorbidityList: {
    marginTop: 10,
    gap: 8,
  },
  comorbidityItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  comorbidityBullet: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    lineHeight: 20,
  },
  comorbidityContent: {
    flex: 1,
  },
  comorbidityName: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  comorbidityCategory: {
    color: AppTheme.colors.textSoft,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  reviewSection: {
    backgroundColor: AppTheme.colors.warningSoft,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  reviewTitle: {
    color: AppTheme.colors.warning,
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 4,
  },
  reviewSubtitle: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
  },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
    gap: 10,
  },
  reviewText: {
    flex: 1,
  },
  reviewConditionName: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  reviewCategory: {
    color: AppTheme.colors.textSoft,
    fontSize: 11,
    marginTop: 2,
  },
  reviewButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  confirmButton: {
    backgroundColor: AppTheme.colors.brand,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  confirmButtonText: {
    color: AppTheme.colors.white,
    fontSize: 12,
    fontWeight: '900',
  },
  dismissButton: {
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  dismissButtonText: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  infoGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  infoBox: {
    flex: 1,
    backgroundColor: AppTheme.colors.brandSoft,
    borderRadius: 16,
    padding: 14,
  },
  infoLabel: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 4,
  },
  infoValue: {
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  bundlePendingPill: {
    backgroundColor: AppTheme.colors.warningSoft,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignSelf: 'stretch',
  },
  bundlePendingText: {
    color: AppTheme.colors.warning,
    fontSize: 12,
    fontWeight: '900',
  },
  bundlePendingDetail: {
    color: AppTheme.colors.textSoft,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
  bundleProgressTrack: {
    marginTop: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: AppTheme.colors.softSurface,
    overflow: 'hidden',
  },
  bundleProgressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: AppTheme.colors.warning,
  },
  bundleFailedPill: {
    backgroundColor: AppTheme.colors.dangerLight,
    borderRadius: AppTheme.radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  bundleFailedText: {
    color: AppTheme.colors.danger,
    fontSize: 12,
    fontWeight: '900',
  },
  bundleFailedDetail: {
    color: AppTheme.colors.textSoft,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
  knowledgeStatsPill: {
    backgroundColor: AppTheme.colors.brandSoft,
    borderRadius: AppTheme.radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  knowledgeStatsText: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: '900',
  },
  knowledgeStatsDetail: {
    color: AppTheme.colors.textSoft,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
  knowledgeStatsHint: {
    color: AppTheme.colors.brandDark,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 6,
  },
  referencesList: {
    marginTop: 8,
    gap: 4,
  },
  referenceRow: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
});

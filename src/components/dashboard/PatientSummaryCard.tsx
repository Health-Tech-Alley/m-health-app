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
  NOT_PROVIDED,
  PENDING_CONFIRMATION,
  UNKNOWN_PATIENT,
} from '@/utils/patientDisplay';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import type { TranslateFn, TranslationKey } from '@/localization/i18n';

export function PatientSummaryCard() {
  const theme = useTheme();
  const { locale, t } = useTranslation();
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
        <Text style={[styles.loadingText, themedStyles.secondaryText]}>{t('dashboard.patient.loadingRecord')}</Text>
      </View>
    );
  }

  if (!snapshot) {
    return (
      <View style={[styles.card, themedStyles.card]}>
        <Text style={[styles.unavailableTitle, themedStyles.primaryText]}>{t('dashboard.patient.unavailable.title')}</Text>
        <Text style={[styles.unavailableText, themedStyles.secondaryText]}>
          {error
            ? t('dashboard.patient.unavailable.loadFailed')
            : t('dashboard.patient.unavailable.noneYet')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('dashboard.patient.retryA11y')}
          onPress={refresh}
          style={styles.retryButton}
        >
          <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  const patientName = getPatientDisplayName(activePatient);
  const patientNameLabel = formatDashboardValue(patientName, t);
  const patientAge = getPatientAgeDisplay(activePatient);
  const patientAgeLabel = formatDashboardValue(patientAge, t);
  const caregiverName = getCaregiverDisplay(activePatient);
  const caregiverNameLabel = formatDashboardValue(caregiverName, t);
  const primaryCondition = activePatient?.primaryDiagnosis ?? null;
  const comorbidities = activePatient?.comorbidities ?? [];
  const sourceCount = countKnowledgeSources(snapshot.knowledgeStats.bySource);
  const cacheSummary = formatKnowledgeCacheSummary(snapshot.knowledgeStats.total, sourceCount, t);
  const sourceBreakdown = formatKnowledgeSourceBreakdown(
    snapshot.knowledgeStats.bySource,
    t,
  );
  // Global pack (new system) is the primary clinical knowledge surface;
  // patient overlay counts are the secondary detail.
  const packSummary =
    packUi.status === 'ready' && packUi.chunksInstalled > 0
      ? t('dashboard.patient.referencesOnDevice', {
          count: packUi.chunksInstalled.toLocaleString(locale),
        })
      : null;

  const primaryDisplay = primaryCondition
    ? `${primaryCondition.icd10 ? `${primaryCondition.icd10} · ` : ''}${primaryCondition.name}`
    : getPrimaryDiagnosisDisplay(activePatient);
  const primaryDisplayLabel = formatDashboardValue(primaryDisplay, t);
  const needsClinicalImport = primaryDisplay === NOT_AVAILABLE;
  const bundlePhaseLabel = snapshot.bundleStatus.phase
    ? localizeBundlePhase(snapshot.bundleStatus.phase, t)
    : null;

  return (
    <View style={[styles.card, themedStyles.card]}>
      <View style={styles.headerRow}>
        <View style={[styles.avatar, themedStyles.brandSoftSurface]}>
          <Text style={[styles.avatarText, themedStyles.accentText]}>{getInitials(patientNameLabel)}</Text>
        </View>

        <View style={styles.patientTextBlock}>
          <View style={styles.nameRow}>
            <Text style={[styles.patientName, themedStyles.primaryText]}>{patientNameLabel}</Text>

            {comorbidities.length > 0 ? (
              <View style={[styles.comorbidityBadge, themedStyles.warningSurface]}>
                <Text style={styles.comorbidityBadgeText}>
                  {t(comorbidities.length === 1 ? 'dashboard.patient.comorbidityOne' : 'dashboard.patient.comorbidityMany', {
                    count: comorbidities.length,
                  })}
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={[styles.patientMeta, themedStyles.secondaryText]}>
            {t('dashboard.patient.age', { age: patientAgeLabel })} · {caregiverNameLabel}
          </Text>
        </View>
      </View>

      <View style={[styles.diagnosisBox, themedStyles.controlSurface]}>
        <Text style={[styles.diagnosisLabel, themedStyles.sectionText]}>{t('dashboard.patient.primaryDiagnosis')}</Text>
        <Text style={[styles.diagnosisText, themedStyles.primaryText]}>{primaryDisplayLabel}</Text>
        {primaryCondition?.category ? (
          <Text style={[styles.categoryText, themedStyles.secondaryText]}>{primaryCondition.category}</Text>
        ) : null}
      </View>

      {needsClinicalImport ? (
        <Pressable
          style={[styles.importBanner, themedStyles.importBanner]}
          onPress={() => router.push({ pathname: '/more', params: { focus: 'ehr-import' } } as never)}
        >
          <Text style={[styles.importBannerTitle, themedStyles.importBannerTitle]}>{t('dashboard.patient.latestClinicalUnavailable.title')}</Text>
          <Text style={[styles.importBannerText, themedStyles.secondaryText]}>
            {t('dashboard.patient.latestClinicalUnavailable.body')}
          </Text>
        </Pressable>
      ) : null}

      {comorbidities.length > 0 ? (
        <Pressable
          style={styles.comorbidityExpand}
          onPress={() => setExpanded((e) => !e)}
        >
          <Text style={[styles.comorbidityToggle, themedStyles.accentText]}>
            {expanded ? '▼' : '▶'} {t('dashboard.patient.comorbidities', { count: comorbidities.length })}
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
        <InfoBox label={t('dashboard.patient.spo2Cutoff')} value={formatDashboardValue(displayClinical(activePatient?.spo2Cutoff), t)} />
        <InfoBox label={t('dashboard.patient.baselineHr')} value={formatDashboardValue(displayEntered(activePatient?.baselineHeartRate), t)} />
      </View>

      {snapshot.bundleStatus.state === 'in_flight' ? (
        <View style={[styles.bundlePendingPill, themedStyles.bundlePendingPill]}>
          <Text style={styles.bundlePendingText}>{t('dashboard.patient.updatingClinicalKnowledge')}</Text>
          {bundlePhaseLabel ? (
            <Text style={[styles.bundlePendingDetail, themedStyles.secondaryText]} numberOfLines={2}>
              {bundlePhaseLabel}
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
              ? t('dashboard.patient.bundleSteps', {
                  completed: snapshot.bundleStatus.completedSteps,
                  total: snapshot.bundleStatus.totalSteps,
                })
              : cacheSummary ?? t('dashboard.patient.downloadingReferences')}
            {snapshot.bundleStatus.chunksAdded > 0
              ? ` · ${t('dashboard.patient.cachedChunks', { count: snapshot.bundleStatus.chunksAdded })}`
              : ''}
          </Text>
        </View>
      ) : snapshot.bundleStatus.state === 'failed' ? (
        <View style={[styles.bundleFailedPill, themedStyles.bundleFailedPill]}>
          <Text style={[styles.bundleFailedText, themedStyles.bundleFailedText]}>{t('dashboard.patient.clinicalKnowledgeUpdateIncomplete')}</Text>
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
          accessibilityLabel={t('dashboard.patient.sourcesA11y', {
            summary: (packSummary ?? cacheSummary) ?? t('dashboard.patient.clinicalKnowledge'),
            action: referencesOpen ? t('common.hide') : t('common.show'),
          })}
        >
          <Text style={[styles.knowledgeStatsText, themedStyles.knowledgeStatsText]}>{packSummary ?? cacheSummary}</Text>
          {sourceBreakdown && !referencesOpen ? (
            <Text style={[styles.knowledgeStatsDetail, themedStyles.secondaryText]}>{sourceBreakdown}</Text>
          ) : null}
          <Text style={[styles.knowledgeStatsHint, themedStyles.knowledgeStatsHint]}>
            {referencesOpen ? `${t('dashboard.patient.hideSources')} ▴` : `${t('dashboard.patient.showSources')} ▾`}
          </Text>
          {referencesOpen ? (
            <CitationList
              sources={Object.entries(snapshot.knowledgeStats.bySource)
                .filter(([, count]) => count > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([src, count]) => ({
                  label: formatSourceLabel(src, t),
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
  t: TranslateFn,
): string | null {
  if (total <= 0) return null;
  return t('dashboard.patient.cacheSummary', {
    total,
    referenceLabel: t(total === 1 ? 'dashboard.patient.referenceOne' : 'dashboard.patient.referenceMany'),
    sourceCount,
    sourceLabel: t(sourceCount === 1 ? 'dashboard.patient.sourceOne' : 'dashboard.patient.sourceMany'),
  });
}

const SOURCE_LABEL_KEYS: Record<string, TranslationKey> = {
  pubmed: 'dashboard.patient.source.medicalLiterature',
  medlineplus: 'dashboard.patient.source.healthTopicSummary',
  rxnorm: 'dashboard.patient.source.drugInformation',
  dailymed: 'dashboard.patient.source.drugLabel',
  openfda: 'dashboard.patient.source.drugSafetyData',
  adcp_plan: 'dashboard.patient.source.carePlan',
  'care-plan': 'dashboard.patient.source.carePlan',
  'patient-plan': 'dashboard.patient.source.carePlan',
  synthetic: 'dashboard.patient.source.sampleGuidance',
  'local-fixture': 'dashboard.patient.source.sampleGuidance',
};

const PACK_SECTION_PHASE_KEYS: Record<string, TranslationKey> = {
  'Core · care gaps and emergency cards': 'onboarding.knowledge.section.spine',
  'Guidelines · text summaries': 'onboarding.knowledge.section.cpg',
  'Conditions · MedlinePlus': 'onboarding.knowledge.section.medlineplus',
  'Rare disease · Orphanet': 'onboarding.knowledge.section.orphanet',
  'Public health · CDC/NINDS/NHLBI': 'onboarding.knowledge.section.publicHealth',
  'Medications · patient labels': 'onboarding.knowledge.section.medsBase',
  'Interactions · practical pairs': 'onboarding.knowledge.section.ddi',
  'Medication safety · OpenFDA adverse events/recalls': 'onboarding.knowledge.section.openfda',
  'Devices · complex home care': 'onboarding.knowledge.section.dme',
  'Literature · PubMed summaries': 'onboarding.knowledge.section.litLite',
  'Local health context · optional': 'onboarding.knowledge.section.sdoh',
  'Indexing · evidence graph': 'onboarding.knowledge.section.graph',
  'Indexing · dense vectors': 'onboarding.knowledge.section.embeds',
};

const BUNDLE_PHASE_KEYS: Record<string, TranslationKey> = {
  Conditions: 'dashboard.patient.bundlePhase.conditions',
  'Updating medication clinical knowledge…': 'dashboard.patient.bundlePhase.updatingMedicationKnowledge',
  'Updating medication clinical knowledge...': 'dashboard.patient.bundlePhase.updatingMedicationKnowledge',
  'Installing on-device clinical knowledge pack…': 'dashboard.patient.bundlePhase.installingDeviceKnowledge',
  'Installing on-device clinical knowledge pack...': 'dashboard.patient.bundlePhase.installingDeviceKnowledge',
  'Installing clinical knowledge…': 'dashboard.patient.bundlePhase.installingKnowledge',
  'Installing clinical knowledge...': 'dashboard.patient.bundlePhase.installingKnowledge',
  'Clinical knowledge pack ready': 'dashboard.patient.bundlePhase.packReady',
  'Medication clinical knowledge updated': 'dashboard.patient.bundlePhase.medicationKnowledgeUpdated',
  'Pack install incomplete': 'dashboard.patient.bundlePhase.packInstallIncomplete',
  'Clinical knowledge pack failed': 'dashboard.patient.bundlePhase.packFailed',
  'Community context · skipped': 'dashboard.patient.bundlePhase.communityContextSkipped',
  'Community context · done': 'dashboard.patient.bundlePhase.communityContextDone',
  'Conditions · offline packs': 'dashboard.patient.bundlePhase.offlinePacks',
};

function formatSourceLabel(source: string, t: TranslateFn): string {
  const key = SOURCE_LABEL_KEYS[source];
  return key ? t(key) : source.replace(/[_-]/g, ' ');
}

function localizeBundlePhase(phase: string, t: TranslateFn): string {
  const exactKey = BUNDLE_PHASE_KEYS[phase];
  if (exactKey) return t(exactKey);

  const sectionKey = PACK_SECTION_PHASE_KEYS[phase];
  if (sectionKey) return t(sectionKey);

  const condition = phase.match(/^Conditions\s+·\s+(.+)$/);
  if (condition) {
    return t('dashboard.patient.bundlePhase.conditionsDetail', { detail: condition[1] });
  }

  const communityContext = phase.match(/^Community context\s+·\s+(.+)$/);
  if (communityContext) {
    return t('dashboard.patient.bundlePhase.communityContextDetail', {
      detail: communityContext[1],
    });
  }

  return phase;
}

function formatKnowledgeSourceBreakdown(
  bySource: Record<string, number>,
  t: TranslateFn,
): string | null {
  const entries = Object.entries(bySource)
    .filter(([, count]) => count > 0)
    .sort(([sourceA], [sourceB]) => sourceA.localeCompare(sourceB));

  if (entries.length === 0) return null;

  return entries.map(([source, count]) => `${formatSourceLabel(source, t)}: ${count}`).join(', ');
}

function formatDashboardValue(value: string, t: TranslateFn): string {
  if (value === UNKNOWN_PATIENT) return t('dashboard.value.unknown');
  if (value === NOT_PROVIDED) return t('dashboard.value.notProvided');
  if (value === NOT_AVAILABLE) return t('dashboard.value.notAvailable');
  if (value === PENDING_CONFIRMATION) return t('dashboard.value.pendingConfirmation');
  return value;
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

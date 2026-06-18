import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import { usePatientRecord } from '@/contexts/patient-record-context';
import { confirmPendingCondition, deleteCondition } from '@/data';
import type { PatientCondition } from '@/data/types';

export function PatientSummaryCard() {
  const { snapshot, ready, refresh } = usePatientRecord();
  const [expanded, setExpanded] = useState(false);

  if (!ready || !snapshot) {
    return (
      <View style={styles.card}>
        <Text style={styles.loadingText}>Loading patient record…</Text>
      </View>
    );
  }

  const patient = snapshot.patient;
  const caregiver = snapshot.caregiver;
  const conditions = snapshot.conditions.filter((c) => !c.needsReview);
  const primaryCondition = conditions.find((c) => c.isPrimary) ?? conditions[0];
  const comorbidities = conditions.filter((c) => c !== primaryCondition);
  const pendingReview = snapshot.pendingReviewConditions;

  const handleConfirm = (conditionId: string) => {
    confirmPendingCondition(conditionId);
    refresh();
  };

  const handleDismiss = (conditionId: string) => {
    deleteCondition(conditionId);
    refresh();
  };

  const primaryDisplay = primaryCondition
    ? `${primaryCondition.icd10 ? `${primaryCondition.icd10} · ` : ''}${primaryCondition.name}`
    : patient?.conditions ?? 'Not documented';

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{getInitials(patient?.name ?? '?')}</Text>
        </View>

        <View style={styles.patientTextBlock}>
          <View style={styles.nameRow}>
            <Text style={styles.patientName}>{patient?.name ?? 'Unknown'}</Text>

            {comorbidities.length > 0 ? (
              <View style={styles.comorbidityBadge}>
                <Text style={styles.comorbidityBadgeText}>
                  {comorbidities.length} Comorbidit{comorbidities.length === 1 ? 'y' : 'ies'}
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.patientMeta}>
            Age {patient?.age ?? '?'} · {caregiver?.name ?? 'Unknown caregiver'}
          </Text>
        </View>
      </View>

      <View style={styles.diagnosisBox}>
        <Text style={styles.diagnosisLabel}>Primary diagnosis</Text>
        <Text style={styles.diagnosisText}>{primaryDisplay}</Text>
        {primaryCondition?.category ? (
          <Text style={styles.categoryText}>{primaryCondition.category}</Text>
        ) : null}
      </View>

      {comorbidities.length > 0 ? (
        <Pressable
          style={styles.comorbidityExpand}
          onPress={() => setExpanded((e) => !e)}
        >
          <Text style={styles.comorbidityToggle}>
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

      {pendingReview.length > 0 ? (
        <View style={styles.reviewSection}>
          <Text style={styles.reviewTitle}>Review suggested conditions</Text>
          <Text style={styles.reviewSubtitle}>
            MedlinePlus identified {pendingReview.length} possibly related {pendingReview.length === 1 ? 'condition' : 'conditions'}:
          </Text>
          {pendingReview.map((c, i) => (
            <View key={c.conditionId ?? i} style={styles.reviewRow}>
              <View style={styles.reviewText}>
                <Text style={styles.reviewConditionName}>
                  {c.icd10 ? `${c.icd10} · ` : ''}{c.name}
                </Text>
                {c.category ? <Text style={styles.reviewCategory}>{c.category}</Text> : null}
              </View>
              <View style={styles.reviewButtons}>
                <Pressable
                  style={styles.confirmButton}
                  onPress={() => handleConfirm(c.conditionId)}
                >
                  <Text style={styles.confirmButtonText}>Confirm</Text>
                </Pressable>
                <Pressable
                  style={styles.dismissButton}
                  onPress={() => handleDismiss(c.conditionId)}
                >
                  <Text style={styles.dismissButtonText}>Dismiss</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.infoGrid}>
        <InfoBox label="SpO₂ cutoff" value={patient?.spo2Cutoff ?? '88%'} />
        <InfoBox label="Baseline HR" value={patient?.baselineHeartRate ?? '72–88 BPM'} />
      </View>

      {snapshot.bundleStatus.state === 'in_flight' ? (
        <View style={styles.bundlePendingPill}>
          <Text style={styles.bundlePendingText}>Enrichment in progress…</Text>
        </View>
      ) : snapshot.bundleStatus.state === 'failed' ? (
        <View style={styles.bundleFailedPill}>
          <Text style={styles.bundleFailedText}>Live fetch unavailable — using offline knowledge</Text>
        </View>
      ) : snapshot.knowledgeStats.total > 0 ? (
        <View style={styles.knowledgeStatsPill}>
          <Text style={styles.knowledgeStatsText}>
            {snapshot.knowledgeStats.total} knowledge chunks cached
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function ComorbidityRow({ condition }: { condition: PatientCondition }) {
  return (
    <View style={styles.comorbidityItem}>
      <Text style={styles.comorbidityBullet}>•</Text>
      <View style={styles.comorbidityContent}>
        <Text style={styles.comorbidityName}>
          {condition.icd10 ? `${condition.icd10} · ` : ''}{condition.name}
        </Text>
        {condition.category ? (
          <Text style={styles.comorbidityCategory}>{condition.category}</Text>
        ) : null}
      </View>
    </View>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoBox}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
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
    borderRadius: AppTheme.radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  bundlePendingText: {
    color: AppTheme.colors.warning,
    fontSize: 12,
    fontWeight: '900',
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
});

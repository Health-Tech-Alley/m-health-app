import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import type { LatestRehabTrajectorySummary } from '@/data/repositories/patientRecordRepository';

interface Props {
  result: LatestRehabTrajectorySummary;
  patientId?: string;
}

const EVENT_LABELS: Record<string, string> = {
  URGENT_SAFETY_ESCALATION: 'Safety concern in rehab log',
  TRAJECTORY_FAILURE_DETECTED: 'Rehab progress needs review',
  LOW_ADHERENCE_BARRIER: 'Therapy activity may have been missed',
  PAIN_LIMITED_PROGRESS: 'Pain may be limiting progress',
  FATIGUE_LIMITED_PROGRESS: 'Fatigue may be limiting progress',
  INSUFFICIENT_DATA: 'Not enough rehab data yet',
  DATA_QUALITY_WARNING: 'Rehab log data quality warning',
  NO_TRAJECTORY_FAILURE: 'Rehab on track',
};

const SEVERITY_COLORS: Record<string, string> = {
  urgent: '#DC2626',
  non_emergency: '#F59E0B',
  informational: '#3B82F6',
  none: '#6B7280',
  emergency: '#DC2626',
};

export function Uc3TrajectoryResultCard({ result, patientId }: Props) {
  const router = useRouter();
  const label = EVENT_LABELS[result.eventType] ?? result.eventType;
  const severityColor = SEVERITY_COLORS[result.severity] ?? '#6B7280';

  const handleExplain = () => {
    if (!patientId) return;
    // Prefer dedicated UC3 explain route; fall back to linked alert detail.
    if (result.resultId) {
      router.push({
        pathname: '/slm-explain',
        params: {
          resultId: result.resultId,
          mode: 'rehab_trajectory',
          patientId,
          alertId: result.linkedAlertId ?? '',
        },
      });
      return;
    }
    if (result.linkedAlertId) {
      router.push({
        pathname: '/alert-detail',
        params: { alertId: result.linkedAlertId, patientId },
      });
    }
  };

  return (
    <View style={[styles.card, { borderLeftColor: severityColor }]}>
      <View style={styles.header}>
        <View style={[styles.severityDot, { backgroundColor: severityColor }]} />
        <Text style={styles.eventLabel}>{label}</Text>
      </View>

      {result.caregiverMessagePreview ? (
        <Text style={styles.message} numberOfLines={3}>
          {result.caregiverMessagePreview}
        </Text>
      ) : null}

      {result.reasonCodes.length > 0 ? (
        <View style={styles.tags}>
          {result.reasonCodes.slice(0, 4).map((code) => (
            <View key={code} style={styles.tag}>
              <Text style={styles.tagText}>{code.replace(/_/g, ' ').toLowerCase()}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        {result.requiresHumanReview ? (
          <View style={styles.reviewBadge}>
            <Text style={styles.reviewBadgeText}>Needs your review</Text>
          </View>
        ) : null}
        {result.emergencyThresholdBreach ? (
          <View style={[styles.reviewBadge, styles.emergencyBadge]}>
            <Text style={[styles.reviewBadgeText, styles.emergencyBadgeText]}>
              Emergency
            </Text>
          </View>
        ) : null}
        <TouchableOpacity style={styles.explainBtn} onPress={handleExplain}>
          <Text style={styles.explainBtnText}>Explain (Concierge)</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderLeftWidth: 4,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  severityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  eventLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1F2937',
    flex: 1,
  },
  message: {
    fontSize: 13,
    color: '#4B5563',
    lineHeight: 18,
    marginBottom: 10,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 12,
  },
  tag: {
    backgroundColor: '#F3F4F6',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagText: {
    fontSize: 11,
    color: '#6B7280',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  reviewBadge: {
    backgroundColor: '#FEF3C7',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  reviewBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#D97706',
  },
  emergencyBadge: {
    backgroundColor: '#FEE2E2',
  },
  emergencyBadgeText: {
    color: '#DC2626',
  },
  explainBtn: {
    backgroundColor: '#EEF2FF',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  explainBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4F46E5',
  },
});

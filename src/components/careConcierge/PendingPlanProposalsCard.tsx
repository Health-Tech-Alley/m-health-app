/**
 * PendingPlanProposalsCard - surfaced on Care (planning/39 section 4.3, L18).
 *
 * Shows caregiver-actionable plan updates first. Once the caregiver has acted,
 * the same pending proposal queue is represented as a compact Concierge status.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/AppIcon';
import { AppTheme } from '@/constants/theme';
import type { PendingPlanProposalSlice } from '@/data/types';
import { useTranslation } from '@/hooks/use-translation';
import type { TranslateFn } from '@/localization/i18n';

const ACTIONABLE_STATUSES = new Set(['draft', 'awaiting_hitl']);
const PROCESSING_STATUS = 'awaiting_ml_vet';

export interface PendingPlanProposalsCardProps {
  proposals: PendingPlanProposalSlice[];
  onConfirm: (proposalId: string) => void;
  onReject: (proposalId: string, reason: string) => void;
}

export function PendingPlanProposalsCard({
  proposals,
  onConfirm,
  onReject,
}: PendingPlanProposalsCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const sorted = useMemo(
    () =>
      proposals.slice().sort((a, b) => {
        const orderRank = { awaiting_hitl: 0, draft: 1, awaiting_ml_vet: 2 } as Record<
          string,
          number
        >;
        const aRank = orderRank[a.status] ?? 9;
        const bRank = orderRank[b.status] ?? 9;
        if (aRank !== bRank) return aRank - bRank;
        return b.createdAt.localeCompare(a.createdAt);
      }),
    [proposals],
  );
  const actionable = useMemo(
    () => sorted.filter((proposal) => ACTIONABLE_STATUSES.has(proposal.status)),
    [sorted],
  );
  const processing = useMemo(
    () => sorted.filter((proposal) => proposal.status === PROCESSING_STATUS),
    [sorted],
  );
  const actionableKey = useMemo(
    () =>
      actionable
        .map((proposal) =>
          `${proposal.patientId}:${proposal.proposalId}:${proposal.status}:${proposal.updatedAt}`,
        )
        .join('|'),
    [actionable],
  );
  const actionCountLabel =
    actionable.length === 1
      ? t('care.proposals.count.one')
      : t('care.proposals.count.many', { count: actionable.length });
  const headerTitle =
    actionable.length === 1
      ? t('care.proposals.header.one')
      : t('care.proposals.header.many');

  useEffect(() => {
    // Defer so the state update does not run synchronously within the effect
    // (react-hooks/set-state-in-effect).
    const handle = setTimeout(() => setExpanded(actionable.length > 0), 0);
    return () => clearTimeout(handle);
  }, [actionable.length, actionableKey]);

  const handleConfirm = useCallback(
    (proposalId: string) => {
      onConfirm(proposalId);
    },
    [onConfirm],
  );
  const handleReject = useCallback(
    (proposalId: string) => {
      Alert.alert(
        t('care.proposals.rejectDialog.title'),
        t('care.proposals.rejectDialog.body'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('care.proposals.reject'),
            style: 'destructive',
            onPress: () => onReject(proposalId, 'caregiver_rejected'),
          },
        ],
      );
    },
    [onReject, t],
  );

  if (actionable.length === 0) {
    if (processing.length === 0) return null;
    const statusText =
      processing.length === 1
        ? t('care.proposals.reviewing.one')
        : t('care.proposals.reviewing.many');
    return (
      <View style={[styles.card, styles.statusCard]} accessible accessibilityLabel={statusText}>
        <AppIcon name="heart" size={18} color={AppTheme.colors.brand} />
        <Text style={styles.statusTitle}>{statusText}</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Pressable
        style={styles.headerRow}
        onPress={() => setExpanded((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={t('care.proposals.headerA11y', {
          title: headerTitle,
          countLabel: actionCountLabel,
          expandedLabel: expanded ? t('care.proposals.expanded') : t('care.proposals.collapsed'),
        })}
      >
        <AppIcon name="heart" size={18} color={AppTheme.colors.brand} />
        <Text style={styles.title}>{headerTitle}</Text>
        <Text style={styles.count}>{actionable.length}</Text>
        <Text style={styles.chevron}>{expanded ? 'v' : '>'}</Text>
      </Pressable>

      {expanded ? (
        <View style={styles.proposalList}>
          {actionable.map((proposal) => (
            <View key={proposal.proposalId} style={styles.row}>
              <View style={styles.rowHeader}>
                <Text style={styles.kind}>{proposalTitle(proposal, t)}</Text>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusText}>{displayStatus(proposal.status, t)}</Text>
                </View>
              </View>
              <Text style={styles.summary}>{proposalSummary(proposal, t)}</Text>

              <View style={styles.actionsRow}>
                <Pressable
                  style={[styles.actionButton, styles.confirmButton]}
                  onPress={() => handleConfirm(proposal.proposalId)}
                  accessibilityRole="button"
                  accessibilityLabel={t('care.proposals.confirmA11y')}
                >
                  <Text style={styles.confirmText}>{t('common.confirm')}</Text>
                </Pressable>
                <Pressable
                  style={[styles.actionButton, styles.rejectButton]}
                  onPress={() => handleReject(proposal.proposalId)}
                  accessibilityRole="button"
                  accessibilityLabel={t('care.proposals.rejectA11y')}
                >
                  <Text style={styles.rejectText}>{t('care.proposals.reject')}</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function displayStatus(status: string, t: TranslateFn): string {
  if (/fail/i.test(status)) return t('care.proposals.status.failed');
  switch (status) {
    case 'draft':
    case 'awaiting_hitl':
      return t('care.proposals.status.needsReview');
    case 'awaiting_ml_vet':
      return t('care.proposals.status.reviewing');
    case 'accepted':
    case 'applied':
      return t('care.proposals.status.added');
    case 'accepted_with_clip':
      return t('care.proposals.status.addedAdjusted');
    case 'rejected_by_ml':
    case 'rejected_by_caregiver':
    case 'expired':
      return t('care.proposals.status.notAdded');
    default:
      return t('care.proposals.status.needsReview');
  }
}

function proposalTitle(proposal: PendingPlanProposalSlice, t: TranslateFn): string {
  if (proposal.kind === 'priority_promote' && /^Promote:\s*Watch\s+/i.test(proposal.summary)) {
    return t('care.proposals.kind.medicationMonitoring');
  }
  switch (proposal.kind) {
    case 'threshold_patch':
      return t('care.proposals.kind.monitoring');
    case 'therapy_patch':
      return t('care.proposals.kind.therapy');
    case 'priority_promote':
      return t('care.proposals.kind.priority');
    case 'goal_patch':
      return t('care.proposals.kind.goal');
    case 'note_wording':
      return t('care.proposals.kind.note');
    default:
      return t('care.proposals.kind.planUpdate');
  }
}

function proposalSummary(proposal: PendingPlanProposalSlice, t: TranslateFn): string {
  const summary = proposal.summary.trim();
  const watchMatch = /^Promote:\s*Watch\s+(.+)\s+with\s+(.+)$/i.exec(summary);
  if (watchMatch) {
    const watchAreaLabel = watchMatch[1] ?? '';
    const medicationLabel = watchMatch[2] ?? '';
    return t('care.proposals.reviewAddingMonitoringFor', {
      watchArea: watchAreaLabel.toLowerCase(),
      medication: medicationLabel,
    });
  }
  if (/^Promote:\s*/i.test(summary)) {
    return t('care.proposals.reviewAdding', {
      summary: summary.replace(/^Promote:\s*/i, ''),
    });
  }
  if (proposal.kind === 'threshold_patch' || proposal.kind === 'goal_patch') {
    return t('care.proposals.reviewSummary', {
      summary: `${summary.charAt(0).toLowerCase()}${summary.slice(1)}`,
    });
  }
  if (proposal.kind === 'therapy_patch') {
    return t('care.proposals.reviewTherapy');
  }
  return summary;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 16,
    marginBottom: 14,
    ...AppTheme.shadow,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusTitle: {
    flex: 1,
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flex: 1,
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  count: {
    color: AppTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: '900',
    backgroundColor: AppTheme.colors.brandSoft,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  chevron: {
    color: AppTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: '900',
  },
  proposalList: {
    marginTop: 10,
  },
  row: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  kind: {
    flex: 1,
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 8,
  },
  statusText: {
    color: AppTheme.colors.textSoft,
    fontSize: 11,
    fontWeight: '900',
  },
  summary: {
    color: AppTheme.colors.text,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 5,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  actionButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  confirmButton: {
    backgroundColor: AppTheme.colors.brand,
  },
  confirmText: {
    color: AppTheme.colors.white,
    fontSize: 13,
    fontWeight: '900',
  },
  rejectButton: {
    backgroundColor: AppTheme.colors.softSurface,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
  },
  rejectText: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
});

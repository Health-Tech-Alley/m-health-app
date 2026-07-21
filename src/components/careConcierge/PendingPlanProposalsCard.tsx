/**
 * PendingPlanProposalsCard — surfaced on Care (planning/39 §4.3, L18).
 *
 * Lists `draft | awaiting_hitl | awaiting_ml_vet` proposals that the
 * caregiver can confirm (move to awaiting_ml_vet) or reject. ML is the only
 * authority that promotes a proposal to `applied`.
 */

import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/AppIcon';
import { AppTheme } from '@/constants/theme';
import type { PendingPlanProposalSlice } from '@/data/types';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  awaiting_hitl: 'Awaiting your review',
  awaiting_ml_vet: 'Awaiting ML vet',
};

const SECTION_LABEL: Record<string, string> = {
  monitoringContract: 'Monitoring contract',
  therapyContract: 'Therapy contract',
  carePriorities: 'Care priorities',
  medicationBindings: 'Medication bindings',
  goals: 'Goals',
  extensions: 'Note',
};

const KIND_LABEL: Record<string, string> = {
  threshold_patch: 'Threshold update',
  therapy_patch: 'Therapy update',
  priority_promote: 'Priority promote',
  goal_patch: 'Goal update',
  note_wording: 'Note rewrite',
};

const INTENT_LABEL: Record<string, string> = {
  explain_uc2_alert: 'Explain Health Monitor result',
  review_monitoring_contract: 'Review monitoring settings',
  explain_uc3_result: 'Explain therapy progress',
  propose_therapy_contract_patch: 'Therapy plan tweaks',
  explain_uc4_card: 'Explain care focus',
  promote_uc4_to_plan_task: 'Add priority to plan',
  suggest_todays_logging: "What to log today",
  weekly_care_plan_review: 'Weekly review',
  handoff_summary: 'Handoff / backup summary',
};

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
  const [expanded, setExpanded] = useState(true);
  const sorted = useMemo(
    () =>
      proposals.slice().sort((a, b) => {
        const orderRank = { awaiting_hitl: 0, awaiting_ml_vet: 1, draft: 2 } as Record<string, number>;
        const aRank = orderRank[a.status] ?? 9;
        const bRank = orderRank[b.status] ?? 9;
        if (aRank !== bRank) return aRank - bRank;
        return b.createdAt.localeCompare(a.createdAt);
      }),
    [proposals],
  );
  const header = `${proposals.length} pending plan update${proposals.length === 1 ? '' : 's'}`;

  const handleConfirm = useCallback(
    (proposalId: string) => {
      onConfirm(proposalId);
    },
    [onConfirm],
  );
  const handleReject = useCallback(
    (proposalId: string) => {
      Alert.alert(
        'Reject this plan proposal?',
        'The plan will not change. This action is logged for the audit trail.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Reject',
            style: 'destructive',
            onPress: () => onReject(proposalId, 'caregiver_rejected'),
          },
        ],
      );
    },
    [onReject],
  );

  return (
    <View style={styles.card}>
      <Pressable
        style={styles.headerRow}
        onPress={() => setExpanded((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${header}`}
      >
        <AppIcon name="heart" size={18} color={AppTheme.colors.brand} />
        <Text style={styles.title}>Needs your review</Text>
        <Text style={styles.count}>{proposals.length}</Text>
        <Text style={styles.chevron}>{expanded ? 'v' : '>'}</Text>
      </Pressable>

      <Text style={styles.subtitle}>
        These plan updates were drafted by Concierge or the engines. Confirm to send to ML vetting; reject to skip.
      </Text>

      {expanded ? (
        <View>
          {sorted.map((proposal) => (
            <View key={proposal.proposalId} style={styles.row}>
              <View style={styles.rowHeader}>
                <View style={styles.rowHeaderLeft}>
                  <Text style={styles.kind}>{KIND_LABEL[proposal.kind] ?? proposal.kind}</Text>
                  <Text style={styles.section}>
                    {SECTION_LABEL[proposal.section] ?? proposal.section}
                  </Text>
                </View>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusText}>{STATUS_LABEL[proposal.status] ?? proposal.status}</Text>
                </View>
              </View>
              <Text style={styles.intent}>{INTENT_LABEL[proposal.intent] ?? proposal.intent}</Text>
              <Text style={styles.summary}>{proposal.summary}</Text>
              {proposal.rationale ? <Text style={styles.rationale}>{proposal.rationale}</Text> : null}

              <View style={styles.actionsRow}>
                {proposal.status === 'awaiting_hitl' || proposal.status === 'draft' ? (
                  <Pressable
                    style={[styles.actionButton, styles.confirmButton]}
                    onPress={() => handleConfirm(proposal.proposalId)}
                    accessibilityRole="button"
                    accessibilityLabel={`Confirm proposal ${proposal.proposalId}`}
                  >
                    <Text style={styles.confirmText}>Confirm</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.waitingNote}>In ML vetting — no action needed</Text>
                )}
                {proposal.status !== 'applied' ? (
                  <Pressable
                    style={[styles.actionButton, styles.rejectButton]}
                    onPress={() => handleReject(proposal.proposalId)}
                    accessibilityRole="button"
                    accessibilityLabel={`Reject proposal ${proposal.proposalId}`}
                  >
                    <Text style={styles.rejectText}>Reject</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  title: {
    flex: 1,
    color: AppTheme.colors.text,
    fontSize: 16,
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
  subtitle: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
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
  },
  rowHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  kind: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  section: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
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
  intent: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginTop: 6,
  },
  summary: {
    color: AppTheme.colors.text,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  rationale: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 18,
    fontStyle: 'italic',
    marginTop: 4,
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
  waitingNote: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    fontStyle: 'italic',
  },
});

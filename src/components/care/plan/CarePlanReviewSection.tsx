/**
 * Care plan "needs your review" section (planning/41 §5).
 *
 * Thin wrapper around the existing PendingPlanProposalsCard so the Care
 * tab IA can compose sections in declaration order. The pending proposals
 * card already handles confirm/reject, ML-vet status, and audit.
 */

import { PendingPlanProposalsCard } from '@/components/careConcierge/PendingPlanProposalsCard';
import type { PendingPlanProposalSlice } from '@/data/types';

export interface CarePlanReviewSectionProps {
  proposals: PendingPlanProposalSlice[];
  onConfirm: (proposalId: string) => void;
  onReject: (proposalId: string, reason: string) => void;
}

export function CarePlanReviewSection({
  proposals,
  onConfirm,
  onReject,
}: CarePlanReviewSectionProps) {
  return (
    <PendingPlanProposalsCard
      proposals={proposals}
      onConfirm={onConfirm}
      onReject={onReject}
    />
  );
}

/**
 * Medication watch-area → care plan proposals (Care tab rework).
 *
 * Lets the caregiver promote a derived medication "area to watch" into the
 * care plan through the sanctioned mutation path: proposal → caregiver HITL
 * confirm → ML vet (next UC4 run) → publish. The watch area itself stays a
 * read-only derivation; only this explicit HITL action writes, and it
 * writes through the existing proposal queue — never directly.
 */

import type { PendingPlanProposal } from '@/data/adcp/types';
import {
  getActiveAdcpRevisionForPatient,
  listPendingProposals,
} from '@/data/repositories/adcpRepository';
import { enqueueProposal } from './mlPlanProposalService';
import {
  humanizeMedicationWatchCode,
  type MedicationWatchArea,
} from './carePrioritiesService';

function priorityIdFor(area: MedicationWatchArea): string {
  return `watch:${area.medicationId}`;
}

function proposalPayloadFor(area: MedicationWatchArea) {
  const areas = area.watchAreas.map(humanizeMedicationWatchCode);
  const headline = areas.slice(0, 2).join(' and ').toLowerCase();
  return {
    priorityId: priorityIdFor(area),
    title: `Watch ${headline} with ${area.medicationName}`,
    description:
      `Known medication watch areas worth tracking for ${area.medicationName}: ` +
      `${areas.join(', ')}. This is monitoring context only — it does not mean the ` +
      `medication is causing anything.`,
    domain: 'medication_adherence_context',
    status: 'active' as const,
    weight: 0.5,
  };
}

/** True when the same watch area is already pending or already on the plan. */
export function watchAreaAlreadyPlanned(patientId: string, area: MedicationWatchArea): boolean {
  const priorityId = priorityIdFor(area);
  try {
    const plan = getActiveAdcpRevisionForPatient(patientId);
    if (plan?.carePriorities.priorities.some((p) => p.priorityId === priorityId)) {
      return true;
    }
  } catch {
    /* fall through to pending check */
  }
  try {
    return listPendingProposals(patientId).some(
      (proposal) =>
        proposal.payload.kind === 'priority_promote' &&
        proposal.payload.priority.priorityId === priorityId &&
        ['draft', 'awaiting_hitl', 'awaiting_ml_vet'].includes(proposal.status),
    );
  } catch {
    return false;
  }
}

/**
 * Enqueue a priority_promote proposal for a medication watch area. Returns
 * null when the area is already pending/planned (dedupe) or when the
 * proposal queue rejects the write.
 */
export function proposeMedicationWatchArea(params: {
  patientId: string;
  area: MedicationWatchArea;
}): PendingPlanProposal | null {
  const { patientId, area } = params;
  if (!patientId || area.watchAreas.length === 0) return null;
  if (watchAreaAlreadyPlanned(patientId, area)) return null;

  return enqueueProposal({
    patientId,
    intent: 'promote_uc4_to_plan_task',
    section: 'carePriorities',
    kind: 'priority_promote',
    draftedBy: 'caregiver',
    mlVetRequirement: { kind: 'next_uc4_run' },
    payload: {
      kind: 'priority_promote',
      patientId,
      priority: proposalPayloadFor(area),
      sourceCardId: `watch-area:${area.medicationId}`,
      rationale: 'Added from the Care tab "Areas to watch" list by the caregiver.',
    },
  });
}

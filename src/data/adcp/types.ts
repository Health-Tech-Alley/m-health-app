/**
 * ADCP (AccessDP Care Plan) — the app's single living, versioned per-patient
 * care plan document.
 *
 * Implements planning/39_unified-care-plan-and-care-concierge.md §3.
 *
 * NOTE: This module is purely a type-and-constants definition. SQLite
 * persistence lives in `src/data/repositories/adcpRepository.ts`; the
 * snapshot facade lives in `src/data/repositories/patientRecordRepository.ts`;
 * proposal queue + ML vetting logic lives in
 * `src/services/carePlan/mlPlanProposalService.ts`.
 */

export const ADCP_BUNDLE_ID = 'accessdp.careplan.v1';
export const ADCP_SECTION_KEYS = [
  'identity',
  'clinicalFraming',
  'safetyEnvelope',
  'goals',
  'monitoringContract',
  'therapyContract',
  'carePriorities',
  'medicationBindings',
  'decisionLog',
  'evidenceAnchors',
] as const;

export type AdcpSectionKey = (typeof ADCP_SECTION_KEYS)[number];

// ---------------------------------------------------------------------------
// Section shapes
// ---------------------------------------------------------------------------

export interface AdcpIdentitySection {
  planId: string;
  version: number;
  effectiveAt: string;
  supersedes?: string | null;
  source:
    | 'seed:onboarding'
    | 'seed:fhir_import'
    | 'seed:restore'
    | 'ml_apply'
    | 'caregiver_confirm'
    | 'slm_apply_with_hitl';
  publishedAt?: string;
  publishedBy?: 'system' | 'caregiver' | 'ml' | 'slm';
  title?: string;
  description?: string;
}

export interface AdcpClinicalFramingSection {
  primaryDiagnosis?: { name: string; icd10?: string | null };
  comorbidities: { name: string; icd10?: string | null }[];
  functionalScales?: Record<string, string>;
}

export interface AdcpSafetyEnvelopeSection {
  neverDo: string[];
  alwaysDo: string[];
  emergencyContact?: string | null;
  safetyNotes?: string | null;
}

export type AdcpMeasurementGoalTarget = {
  metricKey: 'romDegrees' | 'exerciseReps' | 'adherence' | 'painScore' | 'fatigueScore' | 'walkingMinutes';
  displayName: string;
  baselineValue: number | null;
  targetValue: number | null;
  unit: string;
};

export interface AdcpGoalsSection {
  goals: Array<{
    goalId: string;
    description: string;
    targetDate?: string | null;
    measurementTarget?: AdcpMeasurementGoalTarget | null;
    status: 'active' | 'achieved' | 'abandoned';
  }>;
}

export type AdcpMonitoringThresholdClause = {
  thresholdId?: string | null;
  vitalType: string;
  direction: 'above' | 'below';
  value: number;
  severity: 1 | 2 | 3;
  source: string;
  /** When set, this clause came from a proposal and has not yet been ML-vetted. */
  pendingMlVet?: boolean;
};

export type AdcpMlEvalWindow =
  | { kind: 'uc2_next_pass' }
  | { kind: 'uc3_next_eval' }
  | { kind: 'uc4_next_run' }
  | { kind: 'fallback_24h' };

export interface AdcpMonitoringContractSection {
  thresholds: AdcpMonitoringThresholdClause[];
  escalationPolicyRefs: string[];
  vettingWindow: AdcpMlEvalWindow;
}

export interface AdcpTherapyContractSection {
  present: true;
  activities: Array<{
    activityId: string;
    description: string | null;
    status: string | null;
  }>;
  rehabMetrics: Array<{
    id: string;
    metricKey: AdcpMeasurementGoalTarget['metricKey'];
    displayName: string;
    baselineValue: number | null;
    targetValue: number | null;
    unit: string;
  }>;
  exerciseAssignments: Array<{ exerciseKey: string; active: boolean }>;
  reviewWindowDays: number;
}

export interface AdcpAbsentTherapyContractSection {
  present: false;
  reason: 'no_rehab_plan' | 'no_assignments' | 'no_metrics';
}

export type AdcpTherapyContract = AdcpTherapyContractSection | AdcpAbsentTherapyContractSection;

export interface AdcpCarePrioritySection {
  priorities: Array<{
    priorityId: string;
    /** Linkage back to the source UC4 card when this priority was promoted. */
    sourceCardId?: string | null;
    title: string;
    description: string;
    domain: string;
    status: 'active' | 'acknowledged' | 'completed' | 'dismissed';
    promotedAt?: string;
    weight: number;
  }>;
}

export type AdcpMedicationBindingRole = 'monitor' | 'educate' | 'schedule_critical';

export interface AdcpMedicationBindingsSection {
  bindings: Array<{
    medicationId: string;
    /** Stable id used for ADCP version references even if the source med is renamed. */
    stableBindingId?: string;
    role: AdcpMedicationBindingRole;
    notes?: string | null;
  }>;
}

export interface AdcpDecisionLogSectionView {
  entries: Array<{
    decisionId: string;
    occurredAt: string;
    sentence: string;
    refIds: string[];
  }>;
}

export interface AdcpEvidenceAnchorsSection {
  knowledgeChunkIds: string[];
  knowledgeGraphIds: string[];
  citationsCount: number;
}

// ---------------------------------------------------------------------------
// Full plan document
// ---------------------------------------------------------------------------

export interface AdcpPlanDocument {
  identity: AdcpIdentitySection;
  clinicalFraming: AdcpClinicalFramingSection;
  safetyEnvelope: AdcpSafetyEnvelopeSection;
  goals: AdcpGoalsSection;
  monitoringContract: AdcpMonitoringContractSection;
  therapyContract: AdcpTherapyContract;
  carePriorities: AdcpCarePrioritiesSectionPlaceholder;
  medicationBindings: AdcpMedicationBindingsSection;
  decisionLog: AdcpDecisionLogSectionView;
  evidenceAnchors: AdcpEvidenceAnchorsSection;
  /** Untyped bag for SDOH / equipment / school-work (L20 — post-P3 only). */
  extensions: Record<string, unknown>;
}

/** Avoid name conflict until the real shape lands in P3. */
export type AdcpCarePrioritiesSectionPlaceholder = AdcpCarePrioritySection;

// ---------------------------------------------------------------------------
// Pending proposals (queue)
// ---------------------------------------------------------------------------

export type AdcpProposalIntentId =
  | 'explain_uc2_alert'
  | 'review_monitoring_contract'
  | 'explain_uc3_result'
  | 'propose_therapy_contract_patch'
  | 'explain_uc4_card'
  | 'promote_uc4_to_plan_task'
  | 'suggest_todays_logging'
  | 'weekly_care_plan_review'
  | 'handoff_summary';

export type AdcpProposalSection =
  | 'identity'
  | 'clinicalFraming'
  | 'safetyEnvelope'
  | 'goals'
  | 'monitoringContract'
  | 'therapyContract'
  | 'carePriorities'
  | 'medicationBindings'
  | 'extensions';

export type AdcpProposalKind = 'threshold_patch' | 'therapy_patch' | 'priority_promote' | 'goal_patch' | 'note_wording';

export type AdcpProposalStatus =
  | 'draft'
  | 'awaiting_hitl'
  | 'awaiting_ml_vet'
  | 'accepted'
  | 'accepted_with_clip'
  | 'rejected_by_ml'
  | 'rejected_by_caregiver'
  | 'applied'
  | 'expired';

export type AdcpProposalMlVetRequirement =
  | { kind: 'none' }
  | { kind: 'next_uc2_pass'; minimumEvalKey?: string }
  | { kind: 'next_uc3_eval'; minimumEvalKey?: string }
  | { kind: 'next_uc4_run'; minimumRunId?: string }
  | { kind: 'fallback_24h' };

/** Shape-typed proposal payload union. Each variant covers one ProposalKind. */
export type AdcpProposalPayload =
  | {
      kind: 'threshold_patch';
      patientId: string;
      thresholds: AdcpMonitoringThresholdClause[];
      rationale: string;
      citations: string[];
    }
  | {
      kind: 'therapy_patch';
      patientId: string;
      therapyContract: AdcpTherapyContractSection;
      rationale: string;
      citations: string[];
    }
  | {
      kind: 'priority_promote';
      patientId: string;
      priority: AdcpCarePrioritySection['priorities'][number];
      sourceCardId: string;
      rationale?: string;
    }
  | {
      kind: 'goal_patch';
      patientId: string;
      goalsPatch: AdcpGoalsSection['goals'];
      rationale: string;
      citations: string[];
    }
  | {
      kind: 'note_wording';
      patientId: string;
      rationale: string;
      citations: string[];
      extensionKey: string;
      text: string;
    };

export interface PendingPlanProposal {
  proposalId: string;
  patientId: string;
  intent: AdcpProposalIntentId;
  section: AdcpProposalSection;
  kind: AdcpProposalKind;
  status: AdcpProposalStatus;
  payload: AdcpProposalPayload;
  /** Drafted by either SLM (with HITL pending) or directly by caregiver / engine. */
  draftedBy: 'slm' | 'ml_engine' | 'caregiver';
  /** Optional plans that gate apply (e.g. UC2 → next pass). */
  mlVetRequirement: AdcpProposalMlVetRequirement;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
  resolutionReason?: string | null;
  /** When the proposal was clipped by an ML engine. */
  clippedPayload?: AdcpProposalPayload | null;
  /** Snapshots of plan fields the proposal intends to override. */
  pendingOverrides?: {
    carePlanId?: string;
    section: AdcpProposalSection;
    beforeJson?: string | null;
    afterJson?: string | null;
  };
}

export interface PendingPlanProposalSummary {
  proposalId: string;
  patientId: string;
  intent: AdcpProposalIntentId;
  section: AdcpProposalSection;
  kind: AdcpProposalKind;
  status: AdcpProposalStatus;
  summary: string;
  rationale: string;
  draftedBy: PendingPlanProposal['draftedBy'];
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
}

export interface ActiveAdcpVersionSummary {
  planId: string;
  version: number;
  publishedAt: string;
  source: AdcpIdentitySection['source'];
  therapyContractPresent: boolean;
  prioritiesCount: number;
  medicationBindingsCount: number;
}

// ---------------------------------------------------------------------------
// Decision log (append-only)
// ---------------------------------------------------------------------------

export type PlanDecisionType =
  | 'plan_published'
  | 'proposal_drafted'
  | 'proposal_caregiver_confirmed'
  | 'proposal_rejected'
  | 'proposal_ml_accepted'
  | 'proposal_ml_clipped'
  | 'proposal_ml_rejected'
  | 'proposal_applied'
  | 'caregiver_override'
  | 'ml_engine_eval';

export interface PlanDecisionLogEntry {
  decisionId: string;
  patientId: string;
  proposalId?: string | null;
  type: PlanDecisionType;
  actor: 'caregiver' | 'slm' | 'ml' | 'system';
  refIdsJson: string;
  summary: string;
  payloadJson?: string | null;
  createdAt: string;
}

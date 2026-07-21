/**
 * Care Concierge intent catalog (planning/39 §4.2, P2).
 *
 * Each intent:
 *   - has a fixed input/output contract (the SLM doesn't pick its own goals)
 *   - reads from the ADCP + UC2/3/4 snapshots (never raw repos / FHIR)
 *   - never short-circuits to "fast path" / no-SLM mode (L8)
 *   - returns either an explanation OR a plan proposal (or both)
 *
 * The intent catalog is exhaustive — the surface is "structured intents
 * first". Free-text on Care is not in P0–P3 (L21).
 */

import type { PatientRecordSnapshot } from '@/data/types';
import type {
  AdcpProposalIntentId,
  AdcpProposalPayload,
  PendingPlanProposal,
} from '@/data/adcp/types';

export interface CareIntentDefinition<I, O> {
  intentId: AdcpProposalIntentId;
  caregiverLabel: string;
  description: string;
  /** On Care's primary action surface so the caregiver knows what they'll get. */
  resultShape: 'explanation' | 'proposal' | 'explanation_with_optional_proposal';
  buildInput(snapshot: PatientRecordSnapshot, args: I): I & { snapshot: PatientRecordSnapshot };
  /** Convert the SLM response into a typed intent output. */
  buildOutput(args: I, slmText: string): O;
  /**
   * If this intent can also yield a plan proposal, build the proposal DTO
   * from the output. Returns null when the intent is explanation-only.
   */
  buildProposalCandidate?(args: I, output: O): O extends { proposals?: infer P } ? P : never;
}

export interface ExplainAdcpProposalInputs {
  snapshot: PatientRecordSnapshot;
  alertId?: string;
  thresholds?: ReadonlyArray<{
    thresholdId: string;
    vitalType: string;
    direction: 'above' | 'below';
    value: number;
    severity: 1 | 2 | 3;
    source: string;
  }>;
  vitalsSlice?: {
    spo2?: { latest: number; cutoff?: number; hourRange?: { min: number; max: number } };
    heartRate?: { latest: number; window?: { min: number; max: number } };
    respRate?: { latest: number; window?: { min: number; max: number } };
  };
}

export interface ExplainAdcpIntentOutput {
  explanation: string;
  nextSteps: Array<{
    label: string;
    intent: AdcpProposalIntentId;
  }>;
  citations: string[];
}

export interface ReviewMonitoringContractInputs {
  snapshot: PatientRecordSnapshot;
  recentAlertOutcomes?: { openAlerts: number; resolvedAlerts: number; dismissedAlerts: number };
}

export interface ReviewMonitoringContractOutput {
  explanation: string;
  proposedThresholds: Array<{
    thresholdId: string | null;
    vitalType: string;
    direction: 'above' | 'below';
    value: number;
    severity: 1 | 2 | 3;
    source: string;
    pendingMlVet: boolean;
    rationale: string;
  }>;
  citations: string[];
}

export interface ExplainUc3ResultInputs {
  snapshot: PatientRecordSnapshot;
  resultId?: string;
}

export interface ExplainUc3ResultOutput {
  explanation: string;
  proposedPatch?: {
    rationale: string;
    metrics: Array<{
      metricKey: 'romDegrees' | 'exerciseReps' | 'adherence' | 'painScore' | 'fatigueScore' | 'walkingMinutes';
      displayName: string;
      baselineValue: number | null;
      targetValue: number | null;
      unit: string;
    }>;
    citations: string[];
  };
}

export interface ProposeTherapyPatchInputs {
  snapshot: PatientRecordSnapshot;
}

export interface ProposeTherapyPatchOutput {
  rationale: string;
  activities: Array<{
    activityId: string;
    description: string | null;
    status: string | null;
  }>;
  rehabMetrics: Array<{
    id: string;
    metricKey: 'romDegrees' | 'exerciseReps' | 'adherence' | 'painScore' | 'fatigueScore' | 'walkingMinutes';
    displayName: string;
    baselineValue: number | null;
    targetValue: number | null;
    unit: string;
  }>;
  exerciseAssignments: Array<{ exerciseKey: string; active: boolean }>;
  citations: string[];
}

export interface ExplainUc4CardInputs {
  snapshot: PatientRecordSnapshot;
  cardId?: string;
}

export interface ExplainUc4CardOutput {
  explanation: string;
  citations: string[];
}

export interface PromoteUc4ToPlanInputs {
  snapshot: PatientRecordSnapshot;
  cardId: string;
}

export interface PromoteUc4ToPlanOutput {
  rationale: string;
  priorityId: string;
  title: string;
  description: string;
  domain: string;
  weight: number;
}

export interface SuggestTodaysLoggingInputs {
  snapshot: PatientRecordSnapshot;
}

export interface SuggestTodaysLoggingOutput {
  checklist: Array<{ label: string; metricKey: string; reason: string }>;
  rationale: string;
}

export interface WeeklyCarePlanReviewInputs {
  snapshot: PatientRecordSnapshot;
  windowDays?: number;
}

export interface WeeklyCarePlanReviewOutput {
  rationale: string;
  proposedPatches: Array<{
    section: 'monitoringContract' | 'therapyContract' | 'carePriorities' | 'goals';
    summary: string;
    payloadSnippet: AdcpProposalPayload;
  }>;
}

export interface HandoffSummaryInputs {
  snapshot: PatientRecordSnapshot;
  decisionWindowDays?: number;
}

export interface HandoffSummaryOutput {
  title: string;
  body: string;
  lines: string[];
}

export type AnyIntentInputs =
  | ExplainAdcpProposalInputs
  | ReviewMonitoringContractInputs
  | ExplainUc3ResultInputs
  | ProposeTherapyPatchInputs
  | ExplainUc4CardInputs
  | PromoteUc4ToPlanInputs
  | SuggestTodaysLoggingInputs
  | WeeklyCarePlanReviewInputs
  | HandoffSummaryInputs;

export type AnyIntentOutput =
  | ExplainAdcpIntentOutput
  | ReviewMonitoringContractOutput
  | ExplainUc3ResultOutput
  | ProposeTherapyPatchOutput
  | ExplainUc4CardOutput
  | PromoteUc4ToPlanOutput
  | SuggestTodaysLoggingOutput
  | WeeklyCarePlanReviewOutput
  | HandoffSummarySummary;

export interface HandoffSummarySummary extends HandoffSummaryOutput {}

// ---------------------------------------------------------------------------
// Catalog entries (lazy-typed; each definition is independently typed)
// ---------------------------------------------------------------------------

export const INTENT_CATALOG: Record<AdcpProposalIntentId, CareIntentDefinition<any, any>> = {
  explain_uc2_alert: {
    intentId: 'explain_uc2_alert',
    caregiverLabel: 'Explain this Health Monitor result',
    description: 'Plain-language explanation of a recent UC2 alert + suggested next steps.',
    resultShape: 'explanation_with_optional_proposal',
    buildInput: (snapshot, args: ExplainAdcpProposalInputs) => ({ ...args, snapshot }),
    buildOutput: (_args, text) => normalizeStructured<ExplainAdcpIntentOutput>(text, {
      explanation: text,
      nextSteps: [],
      citations: [],
    }),
  },
  review_monitoring_contract: {
    intentId: 'review_monitoring_contract',
    caregiverLabel: 'Review monitoring settings',
    description: 'Inspect active thresholds + recent alert outcomes; queue threshold proposals.',
    resultShape: 'explanation_with_optional_proposal',
    buildInput: (snapshot, args: ReviewMonitoringContractInputs) => ({ ...args, snapshot }),
    buildOutput: (_args, text) => normalizeStructured<ReviewMonitoringContractOutput>(text, {
      explanation: text,
      proposedThresholds: [],
      citations: [],
    }),
    buildProposalCandidate: (_args, output: ReviewMonitoringContractOutput) => output.proposedThresholds,
  },
  explain_uc3_result: {
    intentId: 'explain_uc3_result',
    caregiverLabel: 'Explain therapy progress',
    description: 'Explain the latest UC3 trajectory result + suggest a therapy patch if needed.',
    resultShape: 'explanation_with_optional_proposal',
    buildInput: (snapshot, args: ExplainUc3ResultInputs) => ({ ...args, snapshot }),
    buildOutput: (_args, text) => normalizeStructured<ExplainUc3ResultOutput>(text, {
      explanation: text,
    }),
  },
  propose_therapy_contract_patch: {
    intentId: 'propose_therapy_contract_patch',
    caregiverLabel: 'Suggest therapy plan tweaks',
    description: 'Inspect therapy contract + propose a queued patch to ML vetting.',
    resultShape: 'proposal',
    buildInput: (snapshot, args: ProposeTherapyPatchInputs) => ({ ...args, snapshot }),
    buildOutput: (_args, text) => normalizeStructured<ProposeTherapyPatchOutput>(text, {
      rationale: text,
      activities: [],
      rehabMetrics: [],
      exerciseAssignments: [],
      citations: [],
    }),
    buildProposalCandidate: (_args, output: ProposeTherapyPatchOutput) => output,
  },
  explain_uc4_card: {
    intentId: 'explain_uc4_card',
    caregiverLabel: 'Explain this priority',
    description: 'Explain a UC4 card why-now + available next-step.',
    resultShape: 'explanation',
    buildInput: (snapshot, args: ExplainUc4CardInputs) => ({ ...args, snapshot }),
    buildOutput: (_args, text) => normalizeStructured<ExplainUc4CardOutput>(text, {
      explanation: text,
      citations: [],
    }),
  },
  promote_uc4_to_plan_task: {
    intentId: 'promote_uc4_to_plan_task',
    caregiverLabel: 'Add priority to my plan',
    description: 'Promote a UC4 card to a durable plan priority.',
    resultShape: 'proposal',
    buildInput: (snapshot, args: PromoteUc4ToPlanInputs) => ({ ...args, snapshot }),
    buildOutput: (_args, text) => normalizeStructured<PromoteUc4ToPlanOutput>(text, {
      rationale: text,
      priorityId: `priority:adcp:${Date.now().toString(36)}`,
      title: '',
      description: '',
      domain: '',
      weight: 0,
    }),
    buildProposalCandidate: (_args, output: PromoteUc4ToPlanOutput) => output,
  },
  suggest_todays_logging: {
    intentId: 'suggest_todays_logging',
    caregiverLabel: "What should I log today?",
    description: 'A metric-tied checklist based on active plan + recent UC4 what-to-log.',
    resultShape: 'explanation',
    buildInput: (snapshot, args: SuggestTodaysLoggingInputs) => ({ ...args, snapshot }),
    buildOutput: (_args, text) => normalizeStructured<SuggestTodaysLoggingOutput>(text, {
      checklist: [],
      rationale: text,
    }),
  },
  weekly_care_plan_review: {
    intentId: 'weekly_care_plan_review',
    caregiverLabel: 'Weekly care review',
    description: 'Inspect the last 7 days + queue multi-section proposals.',
    resultShape: 'proposal',
    buildInput: (snapshot, args: WeeklyCarePlanReviewInputs) => ({ ...args, snapshot }),
    buildOutput: (_args, text) => normalizeStructured<WeeklyCarePlanReviewOutput>(text, {
      rationale: text,
      proposedPatches: [],
    }),
    buildProposalCandidate: (_args, output: WeeklyCarePlanReviewOutput) => output,
  },
  handoff_summary: {
    intentId: 'handoff_summary',
    caregiverLabel: 'Handoff / backup summary',
    description: 'Readable narrative covering ADCP + decision-log window.',
    resultShape: 'explanation',
    buildInput: (snapshot, args: HandoffSummaryInputs) => ({ ...args, snapshot }),
    buildOutput: (_args, text) => normalizeStructured<HandoffSummaryOutput>(text, {
      title: 'Care handoff summary',
      body: text,
      lines: [],
    }),
  },
};

export const INTENT_LIST: AdcpProposalIntentId[] = [
  'explain_uc2_alert',
  'review_monitoring_contract',
  'explain_uc3_result',
  'propose_therapy_contract_patch',
  'explain_uc4_card',
  'promote_uc4_to_plan_task',
  'suggest_todays_logging',
  'weekly_care_plan_review',
  'handoff_summary',
];

function normalizeStructured<T extends object>(text: string, fallback: T): T {
  if (!text) return fallback;
  if (text.trim().startsWith('{')) {
    try {
      return JSON.parse(text) as T;
    } catch {
      // fall through to fallback merge
    }
  }
  // Merge the raw text into the first string-ish field of the fallback so
  // downstream proposal builders still get something to reason about.
  const textyField = Object.entries(fallback).find(([, value]) => typeof value === 'string');
  if (textyField) {
    return { ...fallback, [textyField[0]]: text };
  }
  return fallback;
}

export type AnyIntentHandler<I extends AnyIntentInputs = AnyIntentInputs, O extends AnyIntentOutput = AnyIntentOutput> =
  (args: I) => O;

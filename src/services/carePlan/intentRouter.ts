/**
 * Care Concierge intent router (planning/39 §2.4, P2).
 *
 * Wires everything together:
 *   1. snapshot → context assembler → system context
 *   2. snapshot + intent args → SLM completion (NO fast path / NO
 *      confidence-router bypass — L8)
 *   3. SLM text → typed intent output via catalog buildOutput
 *   4. (Optional) proposal payload → enqueueProposal(status: awaiting_hitl)
 *
 * Pure-SQL (`runIntentStubs`) and full-SLM (`runIntent`) overlap at the
 * proposal-DTO layer so ML vetting / apply flow can hand off to either.
 */

import {
  INTENT_CATALOG,
  INTENT_LIST,
  type AnyIntentInputs,
  type AnyIntentOutput,
  type CareIntentDefinition,
} from './intentCatalog';
import { buildPromptContext, promptContextToSystemContext } from './contextAssembler';
import { assertCarePlanWritable, isCarePlanWritable, isMutatingIntent } from './carePlanMode';
import type { PatientRecordSnapshot } from '@/data/types';
import type {
  AdcpProposalIntentId,
  AdcpProposalPayload,
  AdcpProposalStatus,
  PendingPlanProposal,
} from '@/data/adcp/types';
import {
  enqueueProposal,
  caregiverConfirmProposal,
} from './mlPlanProposalService';

export interface RunIntentOptions<I extends AnyIntentInputs> {
  snapshot: PatientRecordSnapshot;
  intent: AdcpProposalIntentId;
  args: I;
  /**
   * SLM completion channel. Required for full-SLM intents. When omitted and
   * the intent is schema-only, `runIntentStubs` is called with a deterministic
   * stand-in response.
   */
  completePrompt?: (params: {
    systemContext: string;
    userPrompt: string;
    intent: AdcpProposalIntentId;
  }) => Promise<string>;
}

export interface RunIntentResult<O extends AnyIntentOutput> {
  intent: AdcpProposalIntentId;
  caregiverLabel: string;
  resultShape: CareIntentDefinition<any, any>['resultShape'];
  output: O;
  prompts: {
    systemContext: string;
    userPrompt: string;
  };
  enqueuedProposalIds: string[];
  proposalQueueStatus: AdcpProposalStatus;
  /** Read-only mode (planning/41 D1) blocked the intent before the SLM ran. */
  blocked?: boolean;
  blockReason?: 'read_only_mode';
  blockMessage?: string;
}

export async function runIntent<O extends AnyIntentOutput>(
  options: RunIntentOptions<any>,
): Promise<RunIntentResult<O>> {
  const { snapshot, intent, args, completePrompt } = options;
  const def = INTENT_CATALOG[intent];
  if (!def) {
    throw new Error(`Unknown intent: ${intent}`);
  }

  // Read-only mode (planning/41 D1) blocks mutating intents before the SLM
  // runs. Explain / handoff / logging-suggest remain available.
  if (isMutatingIntent(intent)) {
    const gate = assertCarePlanWritable();
    if (!gate.ok) {
      return {
        intent,
        caregiverLabel: def.caregiverLabel,
        resultShape: def.resultShape,
        output: def.buildOutput(
          def.buildInput(snapshot, args),
          '',
        ) as O,
        prompts: { systemContext: '', userPrompt: '' },
        enqueuedProposalIds: [],
        proposalQueueStatus: 'draft',
        blocked: true,
        blockReason: 'read_only_mode',
        blockMessage: gate.message,
      };
    }
  }

  const input = def.buildInput(snapshot, args);
  const promptContext = buildPromptContext(snapshot, intent, { additionalCitations: input.snapshot?.patient?.patientId ? [] : [] });
  const systemContext = promptContextToSystemContext(promptContext);
  const userPrompt = buildUserPrompt(intent, input);

  const text = completePrompt
    ? await completePrompt({ systemContext, userPrompt, intent })
    : await runIntentFallbackStub(intent, input);

  const output = def.buildOutput(input, text) as O;
  const proposalPayload = def.buildProposalCandidate?.(input, output) as
    | AdcpProposalPayload
    | undefined;
  const enqueuedProposalIds: string[] = [];
  let proposalQueueStatus: AdcpProposalStatus = 'draft';

  if (proposalPayload && isCarePlanWritable()) {
    const proposal = enqueueProposalFromIntent({
      patientId: snapshot.patient?.patientId ?? '',
      intent,
      payload: proposalPayload,
      section: deriveSectionForIntent(intent),
      kind: deriveKindForProposal(proposalPayload),
    });
    enqueuedProposalIds.push(proposal.proposalId);
    proposalQueueStatus = proposal.status;
  }

  return {
    intent,
    caregiverLabel: def.caregiverLabel,
    resultShape: def.resultShape,
    output,
    prompts: { systemContext, userPrompt },
    enqueuedProposalIds,
    proposalQueueStatus,
  };
}

export async function runIntentAndConfirm<O extends AnyIntentOutput>(
  options: RunIntentOptions<any> & { setupNote?: string },
): Promise<RunIntentResult<O>> {
  const result = await runIntent<O>(options);
  for (const id of result.enqueuedProposalIds) {
    caregiverConfirmProposal(id, { note: options.setupNote });
  }
  return result;
}

export function intentCatalogList(): Array<{
  intent: AdcpProposalIntentId;
  caregiverLabel: string;
  description: string;
  resultShape: CareIntentDefinition<any, any>['resultShape'];
}> {
  return INTENT_LIST.map((id) => {
    const def = INTENT_CATALOG[id];
    return {
      intent: id,
      caregiverLabel: def.caregiverLabel,
      description: def.description,
      resultShape: def.resultShape,
    };
  });
}

function deriveSectionForIntent(intent: AdcpProposalIntentId): PendingPlanProposal['section'] {
  if (intent === 'review_monitoring_contract') return 'monitoringContract';
  if (intent === 'propose_therapy_contract_patch') return 'therapyContract';
  if (intent === 'explain_uc4_card' || intent === 'promote_uc4_to_plan_task') return 'carePriorities';
  if (intent === 'weekly_care_plan_review') return 'extensions';
  if (intent === 'suggest_todays_logging' || intent === 'handoff_summary') return 'extensions';
  return 'monitoringContract';
}

function deriveKindForProposal(payload: AdcpProposalPayload): PendingPlanProposal['kind'] {
  return payload.kind;
}

function buildUserPrompt(intent: AdcpProposalIntentId, args: AnyIntentInputs): string {
  const argsAny = args as unknown as Record<string, unknown>;
  const snapshot = (argsAny.snapshot as { patient?: { name?: string | null } } | undefined) ?? null;
  const patientName = snapshot?.patient?.name ?? 'the patient';
  const resultId = typeof argsAny.resultId === 'string' ? argsAny.resultId : '';
  const cardId = typeof argsAny.cardId === 'string' ? argsAny.cardId : '';
  const windowDays = typeof argsAny.windowDays === 'number' ? argsAny.windowDays : 7;

  switch (intent) {
    case 'explain_uc2_alert':
      return `Explain the Health Monitor result for ${patientName}. Use threshold context and recent vitals below. Return Markdown explanation plus a 1–2 next-step suggestion. Output ONLY Markdown unless a proposal is implied, in which case append a fenced \`proposal\` JSON block.`;
    case 'review_monitoring_contract':
      return `Review the active thresholds for the patient. Return Markdown explanation plus (if any) a fenced \`proposal\` JSON with shape { "kind": "threshold_patch", "thresholds": [...], "rationale": "..." }.`;
    case 'explain_uc3_result':
      return `Explain the latest UC3 therapy trajectory result${resultId ? ` (id ${resultId})` : ''}. Use the rehab metrics + daily care data on the patient. Return Markdown.`;
    case 'propose_therapy_contract_patch':
      return `Inspect the patient's therapy contract and propose a patch ONLY if it would improve outcomes. Return a fenced \`proposal\` JSON { "kind": "therapy_patch", "rationale": "..." }.`;
    case 'explain_uc4_card':
      return `Explain the UC4 card${cardId ? ` (id ${cardId})` : ''}. Return Markdown.`;
    case 'promote_uc4_to_plan_task':
      return `Promote the UC4 card (id ${cardId}) to a durable plan priority. Return a fenced \`proposal\` JSON { "kind": "priority_promote", "priority": {...}, "sourceCardId": ${JSON.stringify(cardId)} }.`;
    case 'suggest_todays_logging':
      return `Suggest today's logging checklist, with each item tied to a metric key on the active plan. Return Markdown.`;
    case 'weekly_care_plan_review':
      return `Run a weekly review of the last ${windowDays} days and return any proposed patches in a fenced \`proposal\` JSON array. Return Markdown prelude followed by that JSON.`;
    case 'handoff_summary':
      return `Compose a handoff / backup summary for the patient. Return Markdown.`;
    default:
      return `Run intent ${intent} on the patient's plan context.`;
  }
}

async function runIntentFallbackStub(
  intent: AdcpProposalIntentId,
  _input: AnyIntentInputs,
): Promise<string> {
  // Deterministic stand-in for Track A (Expo Go) where no native SLM is
  // available. The router still emits a structured (typed) intent output.
  // The caregiver-facing UI surfaces a "Concierge unavailable" banner.
  return `[stub] No native SLM available; intent=${intent} is schema-only.`;
}

// ---------------------------------------------------------------------------
// Helpers exported for the Care UI / concierge UI / unit tests.
// ---------------------------------------------------------------------------

export function listCatalogIntentIds(): AdcpProposalIntentId[] {
  return INTENT_LIST.slice();
}

export function getIntentDefinition(intent: AdcpProposalIntentId): CareIntentDefinition<any, any> {
  return INTENT_CATALOG[intent];
}

function enqueueProposalFromIntent(input: {
  patientId: string;
  intent: AdcpProposalIntentId;
  payload: AdcpProposalPayload;
  section: PendingPlanProposal['section'];
  kind: PendingPlanProposal['kind'];
}): PendingPlanProposal {
  return enqueueProposal({
    patientId: input.patientId,
    intent: input.intent,
    section: input.section,
    kind: input.kind,
    draftedBy: 'slm',
    payload: input.payload,
    mlVetRequirement: mlVetRequirementForIntent(input.intent),
  });
}

function mlVetRequirementForIntent(intent: AdcpProposalIntentId): PendingPlanProposal['mlVetRequirement'] {
  switch (intent) {
    case 'review_monitoring_contract':
      return { kind: 'next_uc2_pass' };
    case 'propose_therapy_contract_patch':
      return { kind: 'next_uc3_eval' };
    case 'promote_uc4_to_plan_task':
    case 'weekly_care_plan_review':
      return { kind: 'next_uc4_run' };
    default:
      return { kind: 'fallback_24h' };
  }
}

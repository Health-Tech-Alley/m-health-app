/**
 * Shared Pre-SLM turn preparation — same NLU + retrieval path as main Concierge chat.
 *
 * Used by SlmInsightSheet, InCardMiniChat, CarePlanInsightSheet, and helpers so
 * one-off explains and in-card follow-ups understand prompts as well as /slm chat.
 */

import {
  buildMedSafetyContext,
  buildChatRetrievalQuery,
  formatCitationsForPrompt,
  messageHasClinicalKeywords,
  retrieveClinicalChunksViaBm25,
  selectChatGeneration,
  type ChatGenerationDecision,
  type RetrievedCitation,
} from '@/clinical-evidence';
import { CONCIERGE_GENERATION_DEEP } from '@/constants/concierge';
import type { GenerateOptions } from '@/inference/inference-provider';
import { createReadyEmbedder } from '@/knowledge/embedder';
import type { FusedRetriever, McpToolSummary } from '@/knowledge/types';
import type { PatientRecordSnapshot } from '@/data/types';
import {
  PreSlmNlu,
  buildPatientNluContext,
  formatEntityHint,
  type NluIntentLabel,
  type PreSlmPacket,
} from '@/nlu';
import type { SkillId } from '@/orchestration/skills/skill-registry';
import { filterToolsForSkill } from '@/orchestration/skills/skill-registry';
import { TOOL_SCHEMAS } from '@/orchestration/mcp/tool-registry';
import {
  buildCaregiverAssistantContextFromSnapshot,
  buildCaregiverSystemContext,
  type CaregiverAssistantContext,
} from '@/services/slm/slmService';
import { detectIdentityMismatches } from '@/services/slm/identity-guardrails';

const DEFAULT_NLU_TIMEOUT_MS = 2500;
const MED_SAFETY_TIMEOUT_MS = 4000;

const CITE_INSTRUCTION =
  'Ground your answer in the clinical knowledge above where relevant. After claims drawn from a chunk, append that chunk\'s exact tag (e.g. [PubMed #1], [Drug Label #2], [Care Plan #3]) — include the # number.';

export type PrepareSlmTurnOptions = {
  userText: string;
  snapshot: PatientRecordSnapshot | null | undefined;
  retriever?: FusedRetriever | null;
  /** Force deep generation (Care explains, therapy seed). Default true for sheets. */
  forceDeep?: boolean;
  /** Skip classifier and force intent (e.g. explain_anomaly). */
  intentOverride?: NluIntentLabel;
  skillHint?: SkillId;
  /** Extra citations merged after NLU/BM25 (e.g. plan-as-RAG). */
  extraCitations?: RetrievedCitation[];
  nluTimeoutMs?: number;
  allowDevelopmentNluFallback?: boolean;
  logTag?: string;
};

export type PreparedSlmTurn = {
  systemContext: string;
  userContent: string;
  generation: GenerateOptions;
  generationDecision: ChatGenerationDecision;
  nluPacket: PreSlmPacket | null;
  /** Deduped chunks used for citation formatting (for UI Sources). */
  citationChunks: RetrievedCitation[];
};

function chunkToCitation(c: {
  docId: string;
  source: string | number;
  text: string;
  patientId?: string;
  sourceId?: string;
  sourceType?: string;
  resourceId?: string;
  effectiveAt?: string;
  createdAt?: string;
  synthetic?: boolean;
  retrievalMethod?: string;
  graphRelation?: string;
  graphSeedId?: string;
}): RetrievedCitation {
  return {
    docId: c.docId,
    source: String(c.source),
    text: c.text,
    patientId: c.patientId,
    sourceId: c.sourceId,
    sourceType: c.sourceType,
    resourceId: c.resourceId,
    effectiveAt: c.effectiveAt,
    createdAt: c.createdAt,
    synthetic: c.synthetic,
    retrievalMethod: c.retrievalMethod,
    graphRelation: c.graphRelation,
    graphSeedId: c.graphSeedId,
  };
}

/**
 * Run Pre-SLM NLU + retrieval and assemble system/user prompts + generation profile.
 * Never throws for NLU failures — falls back to BM25 keyword retrieval like main chat.
 */
export async function prepareSlmTurn(
  options: PrepareSlmTurnOptions,
): Promise<PreparedSlmTurn> {
  const tag = options.logTag ?? 'prepareSlmTurn';
  const trimmed = options.userText.trim();
  const snapshot = options.snapshot ?? null;
  const forceDeep = options.forceDeep !== false;
  const allowDev = options.allowDevelopmentNluFallback === true;
  const nluTimeout = options.nluTimeoutMs ?? DEFAULT_NLU_TIMEOUT_MS;

  const baseContext: CaregiverAssistantContext = snapshot
    ? buildCaregiverAssistantContextFromSnapshot(snapshot)
    : {};

  const conditionNames = [
    baseContext.primaryCondition?.name,
    ...(baseContext.comorbidities ?? []).map((c) => c.name),
  ].filter((n): n is string => Boolean(n));
  const medNames =
    snapshot?.medications
      ?.map((m) => m.name?.trim())
      .filter((n): n is string => Boolean(n)) ??
    (baseContext.patientCurrentMedications
      ? baseContext.patientCurrentMedications
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : []);

  let nluPacket: PreSlmPacket | null = null;

  try {
    const patientCtx = buildPatientNluContext(snapshot);
    patientCtx.medications = [
      ...new Set([...patientCtx.medications, ...medNames].filter(Boolean)),
    ];

    const embedder = await createReadyEmbedder(400, {
      allowDevelopmentFallback: allowDev,
    });
    const nlu = new PreSlmNlu({
      embedder,
      retriever: options.retriever ?? {
        retrieve: async () => ({ tools: [], chunks: [], citations: [], latencyMs: 0 }),
      },
      toolSchemas: TOOL_SCHEMAS as unknown as McpToolSummary[],
      allowDevelopmentFallback: allowDev,
      filterToolsForSkill: (id, tools) =>
        filterToolsForSkill(id, tools as typeof TOOL_SCHEMAS) as McpToolSummary[],
    });

    nluPacket = await Promise.race([
      nlu.run(trimmed, patientCtx, {
        skillHint: options.skillHint,
        intentOverride: options.intentOverride,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`NLU timeout after ${nluTimeout}ms`)),
          nluTimeout,
        ),
      ),
    ]);
    console.log(
      `[${tag}] NLU intent=${nluPacket.intent.primary} conf=${nluPacket.intent.confidence.toFixed(2)} ` +
        `entities=${nluPacket.entities.length} tools=${nluPacket.tools.length} ` +
        `chunks=${nluPacket.chunks.length} backend=${nluPacket.trace.backend}`,
    );
  } catch (nluErr) {
    console.warn(`[${tag}] NLU unavailable or timed out; continuing without NLU:`, nluErr);
  }

  const generationDecision = selectChatGeneration({
    intent: nluPacket?.intent ?? null,
    message: trimmed,
    conditions: conditionNames,
    meds: medNames,
    citedChunkCount: nluPacket?.chunks.length ?? 0,
    forceDeep,
  });

  let systemContext = buildCaregiverSystemContext(baseContext, {
    skillId: nluPacket?.intent.skillId ?? options.skillHint,
    toolsOverride: nluPacket ? nluPacket.tools : undefined,
  });

  const identityGuard = detectIdentityMismatches(trimmed, {
    patientName: snapshot?.patient?.name ?? baseContext.patientName,
    patientPreferredName:
      snapshot?.patient?.preferredName ?? baseContext.patientName,
    caregiverName: snapshot?.caregiver?.name ?? baseContext.caregiverName,
  });
  if (identityGuard.hasMismatch) {
    systemContext = `${systemContext}\n\n${identityGuard.systemPromptBlock}`;
  }

  const mentionedMeds = (nluPacket?.entities ?? [])
    .filter((e) => e.type === 'medication')
    .map((e) => e.label);

  let medSafetyChunks: RetrievedCitation[] = [];
  try {
    const medSafety = await Promise.race([
      buildMedSafetyContext({
        medicationNames: [...new Set([...mentionedMeds, ...medNames])],
        intent: nluPacket?.intent.primary ?? null,
        hasMedicationEntities: mentionedMeds.length > 0,
        message: trimmed,
      }),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), MED_SAFETY_TIMEOUT_MS),
      ),
    ]);
    if (medSafety?.chunks.length) {
      medSafetyChunks = medSafety.chunks.map((c) =>
        chunkToCitation({
          docId: c.docId,
          source: String(c.source),
          text: c.text,
        }),
      );
    }
  } catch (medErr) {
    console.warn(`[${tag}] Med safety context skipped:`, medErr);
  }

  let userContent = trimmed;
  let citationChunks: RetrievedCitation[] = [...(options.extraCitations ?? [])];

  if (nluPacket && nluPacket.chunks.length > 0) {
    const entityHint = formatEntityHint(nluPacket.entities);
    const maxChunkChars = nluPacket.budget.maxChunkChars;
    const nluCitations = nluPacket.chunks.map(chunkToCitation);
    citationChunks = [...citationChunks, ...nluCitations, ...medSafetyChunks];
    const citationBlock = formatCitationsForPrompt(citationChunks, maxChunkChars);
    if (citationBlock) {
      const hintLine = entityHint ? `\n${entityHint}` : '';
      userContent = `${trimmed}${hintLine}\n\n${citationBlock}\n\n${CITE_INSTRUCTION}`;
    }
  } else if (nluPacket && nluPacket.entities.length > 0) {
    const entityHint = formatEntityHint(nluPacket.entities);
    citationChunks = [...citationChunks, ...medSafetyChunks];
    const ddiBlock = medSafetyChunks.length
      ? `\n\n${formatCitationsForPrompt(medSafetyChunks)}`
      : '';
    userContent = `${trimmed}\n${entityHint}${ddiBlock}`;
  } else {
    const hasClinicalIntent = messageHasClinicalKeywords(
      trimmed,
      conditionNames,
      medNames,
    );
    if (hasClinicalIntent && options.retriever) {
      const retrievalQuery = buildChatRetrievalQuery(
        trimmed,
        conditionNames,
        medNames,
      );
      const citations = await retrieveClinicalChunksViaBm25(
        options.retriever,
        retrievalQuery || [trimmed, ...conditionNames].join(' '),
        5,
        snapshot?.patient?.patientId,
      );
      citationChunks = [...citationChunks, ...citations, ...medSafetyChunks];
      const citationBlock = formatCitationsForPrompt(citationChunks);
      if (citationBlock) {
        userContent = `${trimmed}\n\n${citationBlock}\n\n${CITE_INSTRUCTION}`;
      }
    } else if (medSafetyChunks.length > 0 || citationChunks.length > 0) {
      citationChunks = [...citationChunks, ...medSafetyChunks];
      const citationBlock = formatCitationsForPrompt(citationChunks);
      if (citationBlock) {
        userContent = `${trimmed}\n\n${citationBlock}\n\nGround medication safety claims in the knowledge above where relevant.`;
      }
    }
  }

  // Sheets default DEEP; chat may FAST via generationDecision when forceDeep false.
  const generation: GenerateOptions = forceDeep
    ? CONCIERGE_GENERATION_DEEP
    : generationDecision.profile;

  return {
    systemContext,
    userContent,
    generation,
    generationDecision,
    nluPacket,
    citationChunks,
  };
}

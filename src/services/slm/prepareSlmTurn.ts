/**
 * Shared Pre-SLM turn preparation — same NLU + retrieval path as main Concierge chat.
 *
 * Used by SlmInsightSheet, InCardMiniChat, and Care Management helpers so
 * one-off explains and in-card follow-ups understand prompts as well as /slm
 * chat. CarePlanInsightSheet runs the Care intent path (compact ADCP context)
 * and does not use this module.
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
import { fetchOnDemandMedToOverlay } from '@/clinical-evidence/pack';
import { getConciergeGeneration } from '@/constants/concierge';
import type { GenerateOptions } from '@/inference/inference-provider';
import {
  createReadyEmbedder,
  DEFAULT_TFLITE_EMBEDDER_LOAD_MS,
} from '@/knowledge/embedder';
import type { FusedRetriever, McpToolSummary } from '@/knowledge/types';
import type { PatientRecordSnapshot } from '@/data/types';
import { getAssignedDevelopmentRehabExercises } from '@/data/uc3RehabExercises';
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
import { DEFAULT_NLU_STAGE_TIMEOUT_MS } from '@/nlu/pre-slm-nlu';
import { detectIdentityMismatches } from '@/services/slm/identity-guardrails';

/** Whole NLU stage budget (embedder may already be warm from preload). */
const DEFAULT_NLU_TIMEOUT_MS = DEFAULT_NLU_STAGE_TIMEOUT_MS;
/** Extra headroom on the stage budget for a cold embedder start. */
const EMBEDDER_STAGE_EXTRA_MS = 4_000;
const MED_SAFETY_TIMEOUT_MS = 4000;

const CITE_INSTRUCTION =
  'Ground your answer in the clinical knowledge above where relevant. After claims drawn from a chunk, append that chunk\'s exact tag (e.g. [PubMed #1], [Drug Label #2], [Care Plan #3]) — include the # number.';

/**
 * NLU-mentioned meds that are NOT on the patient's chart — the global pack
 * only carries chart meds, so ad-hoc drugs are pinned on demand. Exported
 * for tests.
 */
export function selectOnDemandMedCandidates(
  mentionedMeds: string[],
  chartMeds: string[],
  max = 2,
): string[] {
  const chartKeys = chartMeds.map((m) => m.trim().toLowerCase()).filter(Boolean);
  // Chart coverage on token boundaries: 'baclofen' is covered by chart entry
  // 'baclofen 10mg', but 'insulin lispro' is NOT covered by 'insulin glargine'.
  const onChart = (key: string) =>
    chartKeys.some(
      (c) => c === key || c.startsWith(`${key} `) || key.startsWith(`${c} `),
    );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of mentionedMeds) {
    const name = m.trim();
    const key = name.toLowerCase();
    if (!key || onChart(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

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
  /**
   * Appended to the caregiver system prompt after base context (e.g. UC3
   * therapy + medications ground truth for in-card rehab chat).
   */
  extraSystemContext?: string;
  /**
   * When set (including []), replaces default caregiver-chat tool dump.
   * UC3 in-card explain passes [] to save context for therapy ground truth.
   */
  toolsOverride?: McpToolSummary[];
  /** Skip Pre-SLM NLU entirely (e.g. UC3 path already has snapshot ground truth). */
  skipNlu?: boolean;
  nluTimeoutMs?: number;
  allowDevelopmentNluFallback?: boolean;
  logTag?: string;
  /** Active Concierge model id — drives per-family generation sampling. */
  modelId?: string | null;
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

  if (options.skipNlu === true) {
    console.log(`[${tag}] skipNlu=true — using snapshot/extra context only`);
  } else {
    try {
      const patientCtx = buildPatientNluContext(snapshot);
      patientCtx.medications = [
        ...new Set([...patientCtx.medications, ...medNames].filter(Boolean)),
      ];

      // Embedder cold-start and intent/retrieval share ONE stage budget so a
      // cold embedder degrades identically on every surface. Previously the
      // embedder wait ran outside the nlu race and the two budgets stacked
      // (up to ~22s chat, ~32s Care ask).
      const stageTimeoutMs = nluTimeout + EMBEDDER_STAGE_EXTRA_MS;
      const stageT0 = Date.now();
      const stage = (async () => {
        const embedderWaitMs = Math.min(
          DEFAULT_TFLITE_EMBEDDER_LOAD_MS,
          Math.max(4_000, nluTimeout - 1_500),
        );
        const embedder = await createReadyEmbedder(embedderWaitMs, {
          allowDevelopmentFallback: allowDev,
        });
        console.log(
          `[${tag}] embedder ready in ${Date.now() - stageT0}ms ` +
            `(dims=${embedder.dimensions})`,
        );
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

        return await nlu.run(trimmed, patientCtx, {
          skillHint: options.skillHint,
          intentOverride: options.intentOverride,
        });
      })();

      nluPacket = await Promise.race([
        stage,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`NLU stage timeout after ${stageTimeoutMs}ms`)),
            stageTimeoutMs,
          ),
        ),
      ]);
      console.log(`[${tag}] NLU stage finished in ${Date.now() - stageT0}ms`);
      console.log(
        `[${tag}] NLU intent=${nluPacket.intent.primary} conf=${nluPacket.intent.confidence.toFixed(2)} ` +
          `entities=${nluPacket.entities.length} tools=${nluPacket.tools.length} ` +
          `chunks=${nluPacket.chunks.length} backend=${nluPacket.trace.backend}`,
      );
    } catch (nluErr) {
      console.warn(`[${tag}] NLU unavailable or timed out; continuing without NLU:`, nluErr);
    }
  }

  const generationDecision = selectChatGeneration({
    intent: nluPacket?.intent ?? null,
    message: trimmed,
    conditions: conditionNames,
    meds: medNames,
    citedChunkCount: nluPacket?.chunks.length ?? 0,
    forceDeep,
    modelId: options.modelId ?? null,
  });

  const toolsOverride =
    options.toolsOverride !== undefined
      ? options.toolsOverride
      : nluPacket
        ? nluPacket.tools
        : undefined;

  let systemContext = buildCaregiverSystemContext(baseContext, {
    skillId: nluPacket?.intent.skillId ?? options.skillHint,
    toolsOverride,
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

  // Exercise ground truth: stable labels only (no mutable daily metrics).
  // Present in main chat and in-card explain; omitted when extraSystemContext
  // already carries its own therapy block.
  if (snapshot && !options.extraSystemContext) {
    const assigned = getAssignedDevelopmentRehabExercises(
      snapshot.rehabExerciseAssignments ?? [],
    );
    if (assigned.length > 0) {
      systemContext = `${systemContext}\n\nExercises: ${assigned.map((e) => e.label).join('; ')}.`;
    }
  }

  const extraSystem = options.extraSystemContext?.trim();
  if (extraSystem) {
    systemContext = `${systemContext}\n\n${extraSystem}`;
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

  // Ad-hoc (non-chart) meds mentioned this turn: pin a DailyMed label into the
  // patient overlay on demand so this turn — and future turns — can cite it.
  // The global pack intentionally carries chart meds only.
  let onDemandChunks: RetrievedCitation[] = [];
  const onDemandPatientId = snapshot?.patient?.patientId;
  const onDemandMeds = selectOnDemandMedCandidates(mentionedMeds, medNames);
  if (onDemandPatientId && onDemandMeds.length > 0) {
    const pinned = await Promise.all(
      onDemandMeds.map(async (name) => {
        try {
          const chunks = await Promise.race([
            fetchOnDemandMedToOverlay(onDemandPatientId, name),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 6_000)),
          ]);
          return chunks ?? [];
        } catch {
          return [];
        }
      }),
    );
    onDemandChunks = pinned
      .flat()
      .map((c) =>
        chunkToCitation({
          docId: c.chunkId,
          source: String(c.source),
          text: c.text,
          patientId: onDemandPatientId,
        }),
      );
    if (onDemandChunks.length > 0) {
      console.log(
        `[${tag}] On-demand med labels pinned for ${onDemandMeds.join(', ')} ` +
          `(${onDemandChunks.length} chunk(s))`,
      );
    }
  }

  let userContent = trimmed;
  let citationChunks: RetrievedCitation[] = [
    ...(options.extraCitations ?? []),
    ...onDemandChunks,
  ];

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
    const citationBlock = formatCitationsForPrompt(citationChunks);
    const knowledgeBlock = citationBlock
      ? `\n\n${citationBlock}\n\n${CITE_INSTRUCTION}`
      : '';
    userContent = `${trimmed}\n${entityHint}${knowledgeBlock}`;
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
        userContent = `${trimmed}\n\n${citationBlock}\n\n${CITE_INSTRUCTION}`;
      }
    }
  }

  // Sheets default DEEP; chat may FAST via generationDecision when forceDeep false.
  // Model-aware profiles come from the router (or the forced deep profile).
  const generation: GenerateOptions = forceDeep
    ? getConciergeGeneration(options.modelId ?? null, 'deep')
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

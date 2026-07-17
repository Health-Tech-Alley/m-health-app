/**
 * Pre-SLM NLU facade.
 *
 * Orchestrates the full NLU pipeline:
 *   prompt → EntityLinker → embed → IntentHead → skill/tool filter
 *   → BM25+dense RRF → BudgetAssembler → PreSlmPacket
 *
 * planning/35 §3.1.
 */

import type {
  PreSlmPacket,
  PatientNluContext,
  NluRunOptions,
  NluEmbedder,
} from './types';
import { linkEntities } from './entity-linker';
import { expandQuery } from './query-expand';
import { loadIntentHead, predictIntent, type IntentHeadCoefficients } from './intent-head';
import { assembleBudgetedPacket } from './budget-assembler';
import { INTENT_BUDGETS } from './intent-labels';
import type { FusedRetriever, McpToolSummary } from '@/knowledge/types';
import type { SkillId } from '@/orchestration/skills/skill-registry';
import {
  hasVitalsOrWhatIfIntent,
  extractVitalsFromUserText,
} from '@/services/slm/vitals-tool-nlp';

export type PreSlmNluOptions = {
  embedder: NluEmbedder;
  retriever: FusedRetriever;
  toolSchemas: McpToolSummary[];
  intentHeadPath?: string;
  allowDevelopmentFallback?: boolean;
  filterToolsForSkill?: (skillId: SkillId, tools: McpToolSummary[]) => McpToolSummary[];
};

let intentHeadCoeffs: IntentHeadCoefficients | null = null;

export class NluUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'NluUnavailableError';
    if (options && 'cause' in options) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export class PreSlmNlu {
  private embedder: NluEmbedder;
  private retriever: FusedRetriever;
  private toolSchemas: McpToolSummary[];
  private intentHeadPath: string;
  private allowDevelopmentFallback: boolean;
  private filterToolsForSkill?: (skillId: SkillId, tools: McpToolSummary[]) => McpToolSummary[];
  private ready = false;

  constructor(options: PreSlmNluOptions) {
    this.embedder = options.embedder;
    this.retriever = options.retriever;
    this.toolSchemas = options.toolSchemas;
    this.intentHeadPath = options.intentHeadPath ?? 'assets/models/nlu/intent-head.json';
    this.allowDevelopmentFallback = __DEV__ && options.allowDevelopmentFallback === true;
    this.filterToolsForSkill = options.filterToolsForSkill;
  }

  /**
   * Initialize the NLU (load intent head coefficients).
   */
  async init(): Promise<void> {
    if (this.ready) return;
    try {
      intentHeadCoeffs = await loadIntentHead(this.intentHeadPath);
    } catch (err) {
      intentHeadCoeffs = null;
      if (!this.allowDevelopmentFallback) {
        throw new NluUnavailableError('NLU intent head unavailable', { cause: err });
      }
      console.warn('[PreSlmNlu] Failed to load intent head; using development fallback:', err);
    }
    this.ready = true;
  }

  /**
   * Run the full NLU pipeline on a user prompt.
   */
  async run(
    prompt: string,
    ctx: PatientNluContext,
    options?: NluRunOptions,
  ): Promise<PreSlmPacket> {
    // Always load intent head when present (callers may forget init()).
    await this.init();

    const t0 = performance.now();
    const stages: string[] = [];
    let embedMs: number | undefined;

    // 1. Entity linking
    stages.push('entity_linking');
    const entities = linkEntities(prompt, ctx);

    // 2. Embed (with query prefix for leaf-ir)
    stages.push('embed');
    const embedStart = performance.now();
    let embedding: number[];
    try {
      embedding = await this.embedder.embed(prompt, { isQuery: true });
    } catch {
      try {
        embedding = await this.embedder.embed(prompt);
      } catch (err) {
        throw new NluUnavailableError('NLU embedder unavailable', { cause: err });
      }
    }
    embedMs = performance.now() - embedStart;

    // 3. Intent classification
    stages.push('intent_classify');
    let intent: PreSlmPacket['intent'];

    if (options?.intentOverride) {
      intent = {
        primary: options.intentOverride,
        confidence: 1.0,
        alternatives: [],
        skillId: options.skillHint,
      };
    } else if (
      intentHeadCoeffs &&
      embedding.length === intentHeadCoeffs.dim &&
      intentHeadCoeffs.dim === 768
    ) {
      // Only score with the linear head when embedder dim matches trained leaf-ir.
      const prediction = predictIntent(embedding, intentHeadCoeffs);
      intent = {
        ...prediction,
        skillId: options?.skillHint ?? prediction.skillId,
      };
    } else if (this.allowDevelopmentFallback) {
      // Development fallback or dim mismatch: keyword heuristics.
      intent = this.fallbackIntent(prompt, ctx, options?.skillHint);
    } else {
      throw new NluUnavailableError('NLU intent classifier unavailable');
    }

    // 4. Tool filtering by skill
    stages.push('tool_filter');
    let tools = this.toolSchemas;
    if (intent.skillId && this.filterToolsForSkill) {
      tools = this.filterToolsForSkill(intent.skillId, this.toolSchemas);
    }

    // 5. Tool order: skill allow-list only on hot path (no per-tool TFLite embeds).
    // Cosine ranking was O(n tools) inference and hung chat on device.
    stages.push('tool_rank');
    const expandedQuery = expandQuery(prompt, entities);
    const rankedTools = tools;

    // 6. Retrieval (BM25 + dense RRF) — never block chat on live PubMed/etc.
    stages.push('retrieve');
    const budget = INTENT_BUDGETS[intent.primary] ?? INTENT_BUDGETS.other;
    const retrieval = await this.retriever.retrieve({
      intent: expandedQuery,
      conditions: ctx.conditions,
      activeMeds: ctx.medications,
      kTools: Math.max(budget.maxTools, 1),
      kChunks: Math.max(budget.maxChunks, 1),
      allowLiveSupplement: false,
    });

    // Prefer cosine-ranked skill tools; fall back to retriever tool-RAG hits.
    const toolByName = new Map<string, McpToolSummary>();
    for (const t of [...rankedTools, ...retrieval.tools]) {
      if (!toolByName.has(t.name)) toolByName.set(t.name, t);
    }
    const mergedTools = Array.from(toolByName.values());

    // 7. Vitals slot extraction if vitals intent
    stages.push('vitals_gate');
    let slots: PreSlmPacket['slots'];
    if (intent.primary === 'vitals_what_if' || hasVitalsOrWhatIfIntent(prompt)) {
      slots = extractVitalsFromUserText(prompt) ?? undefined;
    }

    // 8. Budget assembly
    stages.push('budget_assemble');
    const totalMs = performance.now() - t0;

    const packet = assembleBudgetedPacket({
      prompt,
      entities,
      intent,
      tools: mergedTools,
      chunks: retrieval.chunks,
      slots,
      budget,
      trace: {
        latencyMs: Math.round(totalMs),
        embedMs: embedMs ? Math.round(embedMs) : undefined,
        stages,
        backend:
          this.embedder.dimensions === 768 &&
          intentHeadCoeffs &&
          embedding.length === 768
            ? 'tflite'
            : 'development_fallback',
        developmentFallback:
          !(
            this.embedder.dimensions === 768 &&
            intentHeadCoeffs &&
            embedding.length === 768
          ),
      },
    });

    console.log(
      `[PreSlmNlu] intent=${intent.primary} conf=${intent.confidence.toFixed(2)} ` +
      `entities=${entities.length} tools=${packet.tools.length} chunks=${packet.chunks.length} ` +
      `latency=${totalMs.toFixed(0)}ms`,
    );

    return packet;
  }

  /**
   * Keyword-based fallback intent when no trained head is available.
   */
  private fallbackIntent(
    prompt: string,
    ctx: PatientNluContext,
    skillHint?: SkillId,
  ): PreSlmPacket['intent'] {
    const lower = prompt.toLowerCase();

    // Vitals what-if
    if (hasVitalsOrWhatIfIntent(prompt)) {
      return { primary: 'vitals_what_if', confidence: 0.7, alternatives: [], skillId: skillHint ?? 'caregiver-chat' };
    }

    // Explain anomaly
    if (/\b(alert|anomal|explain|what happened|why is)\b/i.test(lower)) {
      return { primary: 'explain_anomaly', confidence: 0.6, alternatives: [], skillId: skillHint ?? 'explain-anomaly' };
    }

    // Med check
    if (ctx.medications.some((m) => lower.includes(m.toLowerCase().split(/\s+/)[0]))) {
      return { primary: 'med_check', confidence: 0.6, alternatives: [], skillId: skillHint ?? 'caregiver-chat' };
    }

    // Schedule
    if (/\b(schedule|appointment|visit|book)\b/i.test(lower)) {
      return { primary: 'schedule_care', confidence: 0.6, alternatives: [], skillId: skillHint ?? 'next-steps' };
    }

    // Clinical keywords → knowledge_qa
    if (ctx.conditions.some((c) => lower.includes(c.toLowerCase())) ||
        ctx.symptoms.some((s) => lower.includes(s.toLowerCase()))) {
      return { primary: 'knowledge_qa', confidence: 0.5, alternatives: [], skillId: skillHint ?? 'caregiver-chat' };
    }

    // Default
    return {
      primary: 'caregiver_chat_general',
      confidence: 0.4,
      alternatives: [],
      skillId: skillHint ?? 'caregiver-chat',
    };
  }
}

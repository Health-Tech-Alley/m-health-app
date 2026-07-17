/**
 * Pre-SLM NLU types (planning/35).
 *
 * Defines the NLU intent labels, linked entities, and the PreSlmPacket
 * that gates what tools/chunks the SLM sees on each turn.
 */

import type { McpToolSummary, RetrievedChunk } from '@/knowledge/types';
import type { SkillId } from '@/orchestration/skills/skill-registry';
import type { HypotheticalVitalsArgs } from '@/services/slm/vitals-tool-nlp';

export type NluIntentLabel =
  | 'knowledge_qa'
  | 'vitals_what_if'
  | 'med_check'
  | 'explain_anomaly'
  | 'clarifying_qa'
  | 'next_steps'
  | 'schedule_care'
  | 'visit_prep'
  | 'portal_draft'
  | 'summarize_ehr'
  | 'detect_care_gaps'
  | 'draft_care_plan'
  | 'caregiver_chat_general'
  | 'other';

export type LinkedEntityType =
  | 'medication'
  | 'condition'
  | 'symptom'
  | 'vital'
  | 'knowledge_keyword'
  | 'tool';

export type LinkedEntity = {
  type: LinkedEntityType;
  id: string;
  label: string;
  score: number;
  span?: { start: number; end: number };
};

export type NluIntent = {
  primary: NluIntentLabel;
  confidence: number;
  alternatives: { id: NluIntentLabel; confidence: number }[];
  skillId?: SkillId;
};

export type PreSlmPacket = {
  prompt: string;
  entities: LinkedEntity[];
  intent: NluIntent;
  tools: McpToolSummary[];
  chunks: RetrievedChunk[];
  slots?: HypotheticalVitalsArgs;
  budget: {
    maxTools: number;
    maxChunks: number;
    maxChunkChars: number;
    maxToolChars: number;
  };
  trace: {
    latencyMs: number;
    embedMs?: number;
    stages: string[];
    backend: 'tflite' | 'development_fallback';
    developmentFallback?: boolean;
  };
};

/**
 * Patient context snapshot for NLU — assembled from PatientRecordStore.
 * Lightweight; no SLM required.
 */
export type PatientNluContext = {
  patientId: string;
  patientName: string;
  conditions: string[];
  comorbidities: string[];
  medications: string[];
  symptoms: string[];
  knowledgeKeywords: string[];
  functionalScales?: {
    gmfcs?: string;
    macs?: string;
    cfcs?: string;
    edacs?: string;
  };
  vitalTypes: string[];
  activePersona?: string;
};

export type NluRunOptions = {
  /** Force a skill (e.g. explain-anomaly from orchestrator). */
  skillHint?: SkillId;
  /** Override the intent label (skip classifier). */
  intentOverride?: NluIntentLabel;
};

/**
 * Interface for the embedder used by NLU (extends the knowledge Embedder
 * with query-prefix support).
 */
export interface NluEmbedder {
  readonly dimensions: number;
  embed(text: string, opts?: { isQuery?: boolean }): Promise<number[]>;
}

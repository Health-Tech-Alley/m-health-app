/**
 * Intent label definitions, skill mapping, and confidence thresholds.
 */

import type { NluIntentLabel } from './types';
import type { SkillId } from '@/orchestration/skills/skill-registry';

export const INTENT_LABELS: NluIntentLabel[] = [
  'knowledge_qa',
  'vitals_what_if',
  'med_check',
  'explain_anomaly',
  'clarifying_qa',
  'next_steps',
  'schedule_care',
  'visit_prep',
  'portal_draft',
  'summarize_ehr',
  'detect_care_gaps',
  'draft_care_plan',
  'caregiver_chat_general',
  'other',
];

/**
 * Map NLU intent label → primary SkillId.
 * Some intents map to the same skill (e.g. knowledge_qa → caregiver-chat).
 */
export const INTENT_TO_SKILL: Record<NluIntentLabel, SkillId | undefined> = {
  knowledge_qa: 'caregiver-chat',
  vitals_what_if: 'caregiver-chat',
  med_check: 'caregiver-chat',
  explain_anomaly: 'explain-anomaly',
  clarifying_qa: 'clarifying-qa',
  next_steps: 'next-steps',
  schedule_care: 'next-steps',
  visit_prep: 'visit-prep',
  portal_draft: 'portal-message-draft',
  summarize_ehr: 'summarize-ehr',
  detect_care_gaps: 'detect-care-gaps',
  draft_care_plan: 'draft-care-plan',
  caregiver_chat_general: 'caregiver-chat',
  other: undefined,
};

/**
 * Budget per intent — max tools, max chunks, max chunk chars.
 * Matches planning/35 §7.4.
 */
export const INTENT_BUDGETS: Record<
  NluIntentLabel,
  { maxTools: number; maxChunks: number; maxChunkChars: number; maxToolChars: number }
> = {
  knowledge_qa: { maxTools: 1, maxChunks: 5, maxChunkChars: 1500, maxToolChars: 400 },
  vitals_what_if: { maxTools: 1, maxChunks: 2, maxChunkChars: 800, maxToolChars: 400 },
  med_check: { maxTools: 2, maxChunks: 5, maxChunkChars: 1500, maxToolChars: 400 },
  explain_anomaly: { maxTools: 3, maxChunks: 12, maxChunkChars: 3000, maxToolChars: 600 },
  clarifying_qa: { maxTools: 1, maxChunks: 3, maxChunkChars: 1000, maxToolChars: 400 },
  next_steps: { maxTools: 3, maxChunks: 3, maxChunkChars: 1000, maxToolChars: 600 },
  schedule_care: { maxTools: 3, maxChunks: 3, maxChunkChars: 1000, maxToolChars: 600 },
  visit_prep: { maxTools: 3, maxChunks: 5, maxChunkChars: 1500, maxToolChars: 600 },
  portal_draft: { maxTools: 2, maxChunks: 3, maxChunkChars: 1000, maxToolChars: 400 },
  summarize_ehr: { maxTools: 2, maxChunks: 8, maxChunkChars: 2500, maxToolChars: 400 },
  detect_care_gaps: { maxTools: 2, maxChunks: 8, maxChunkChars: 2500, maxToolChars: 400 },
  draft_care_plan: { maxTools: 2, maxChunks: 8, maxChunkChars: 2500, maxToolChars: 400 },
  caregiver_chat_general: { maxTools: 2, maxChunks: 4, maxChunkChars: 1500, maxToolChars: 400 },
  other: { maxTools: 2, maxChunks: 4, maxChunkChars: 1500, maxToolChars: 400 },
};

/** Below this confidence, treat the intent as knowledge_qa or other. */
export const CONFIDENCE_THRESHOLD = 0.55;

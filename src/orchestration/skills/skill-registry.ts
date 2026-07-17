/**
 * Skill registry — first-class caregiver-concierge skills.
 *
 * Per planning/17_tula-health-skills-integration.md: a "skill" is a
 * self-contained unit (prompt fragment + allowed MCP tools + an eval task
 * set) that the orchestrator selects per turn. This mirrors Tula's
 * "discrete, evaluable skill per health task" model adapted to our
 * in-process MCP orchestrator and on-device SLM.
 *
 * Selection strategy (per doc 17 open question #1): explicit for the first
 * pass — `explainAlert` always uses `explain-anomaly`; `answerClarifyingQuestion`
 * reuses the same skill; the chat screen defaults to `caregiver-chat`.
 * Inference-based selection is future work.
 *
 * Strict allow-list (per doc 17 open question #4): a skill only sees its
 * allowed tools. The orchestrator's tool-RAG filter reads this list.
 *
 * Eval suite is adapted from Tula's Patient Agent Eval Standard v0.1
 * (Apache-2.0). See ./eval/caregiver-eval-tasks.ts.
 */

import type { ToolSchema } from '@/orchestration/mcp/tool-registry';

export type SkillId =
  | 'explain-anomaly'
  | 'clarifying-qa'
  | 'next-steps'
  | 'portal-message-draft'
  | 'caregiver-chat'
  | 'visit-prep'
  | 'summarize-ehr'
  | 'detect-care-gaps'
  | 'draft-care-plan'
  | 'explain-rehab-trajectory'
  | 'uc4-provider-summary-rewrite';

export type Skill = {
  /** Stable identifier — referenced in traces, eval results, and the prompt. */
  id: SkillId;
  /** Human-readable name. */
  name: string;
  /** Tula analog (when one exists). Used in planning docs and trace labels. */
  tulaAnalog?: string;
  /** What the skill is for. Drives the orchestrator's selection logic. */
  purpose: string;
  /** The MCP tool names the skill is allowed to use. */
  allowedTools: string[];
  /** Eval task IDs that this skill must pass to ship. */
  evalTaskIds: string[];
  /**
   * Prompt fragment appended to the system prompt when this skill is
   * active. Kept short and skill-specific so the orchestrator can compose
   * the final system prompt by concatenation.
   */
  promptFragment: string;
};

const SKILL_REGISTRY: Map<SkillId, Skill> = new Map();

export function registerSkill(skill: Skill): void {
  if (SKILL_REGISTRY.has(skill.id)) {
    throw new Error(`Skill already registered: ${skill.id}`);
  }
  SKILL_REGISTRY.set(skill.id, skill);
}

export function getSkill(id: SkillId): Skill | undefined {
  return SKILL_REGISTRY.get(id);
}

export function listSkills(): Skill[] {
  return Array.from(SKILL_REGISTRY.values());
}

/**
 * Return the prompt fragment for a skill, or an empty string if the skill
 * is not registered. Safe to call with an unknown id.
 */
export function getSkillPromptFragment(id: SkillId | string | undefined): string {
  if (!id) return '';
  const skill = SKILL_REGISTRY.get(id as SkillId);
  if (!skill) return '';
  return skill.promptFragment;
}

/**
 * Filter a list of MCP tool schemas to the allow-list of a skill. Used by
 * the orchestrator's tool-RAG to ensure a skill never sees tools it
 * shouldn't call. Tools without an `allowedSkills` field are treated as
 * orchestrator-internal and are excluded from any user-facing skill.
 */
export function filterToolsForSkill(
  id: SkillId | string,
  tools: ToolSchema[],
): ToolSchema[] {
  const skill = SKILL_REGISTRY.get(id as SkillId);
  if (!skill) return [];
  return tools.filter((t) => {
    const tagged = t.allowedSkills ?? [];
    return tagged.includes(id as SkillId);
  });
}

/**
 * Inverse — return the skills that are allowed to use a given tool. Useful
 * for debugging and trace labels.
 */
export function skillsForTool(toolName: string): Skill[] {
  return Array.from(SKILL_REGISTRY.values()).filter((s) => s.allowedTools.includes(toolName));
}

/** True if the given tool is allowed in the given skill. */
export function isToolAllowedInSkill(id: SkillId | string, toolName: string): boolean {
  const skill = SKILL_REGISTRY.get(id as SkillId);
  if (!skill) return false;
  return skill.allowedTools.includes(toolName);
}

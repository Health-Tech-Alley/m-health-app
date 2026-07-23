import { FiredRule, UC4ScoreTrace, UC4TemplateId, UC4RuleContext } from "./uc4Types";

interface ScoreCandidateInput {
  ctx: UC4RuleContext;
  templateId: UC4TemplateId;
  firedRules: FiredRule[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getRepeatPenalty(ctx: UC4RuleContext, templateId: UC4TemplateId): number {
  const recentSameTemplate = ctx.previousPriorities.filter(
    (priority) => priority.templateId === templateId,
  );

  if (recentSameTemplate.length === 0) return 0;

  return Math.min(0.18, recentSameTemplate.length * 0.06);
}

function getDismissPenalty(ctx: UC4RuleContext, templateId: UC4TemplateId): number {
  const dismissedCount = ctx.previousPriorities.filter(
    (priority) =>
      priority.templateId === templateId &&
      (priority.caregiverResponse === "dismissed" ||
        priority.caregiverResponse === "not_relevant"),
  ).length;

  return Math.min(0.24, dismissedCount * 0.12);
}

function getUsefulnessBonus(ctx: UC4RuleContext, templateId: UC4TemplateId): number {
  const helpfulCount = ctx.previousPriorities.filter(
    (priority) =>
      priority.templateId === templateId &&
      (priority.caregiverResponse === "helpful" ||
        priority.caregiverResponse === "logged_observation"),
  ).length;

  return Math.min(0.12, helpfulCount * 0.06);
}

function getBlindSpotBonus(ctx: UC4RuleContext, templateId: UC4TemplateId): number {
  const previousShown = ctx.previousPriorities.some((priority) => priority.templateId === templateId);

  if (previousShown) return 0;

  const blindSpotTemplates: UC4TemplateId[] = [
    "SKIN_PRESSURE_AFTER_SEATED_PERIOD",
    "MEDICATION_WINDOW_FATIGUE_TRACKING",
    "BOWEL_ROUTINE_DISCOMFORT_CONTEXT",
  ];

  return blindSpotTemplates.includes(templateId) ? 0.08 : 0;
}

export function scoreCandidate(input: ScoreCandidateInput): UC4ScoreTrace {
  const { ctx, templateId, firedRules } = input;

  const rawRuleScore = firedRules.reduce((sum, rule) => sum + rule.weight, 0);
  const ruleScore = clamp01(rawRuleScore);

  const blindSpotBonus = getBlindSpotBonus(ctx, templateId);
  const usefulnessBonus = getUsefulnessBonus(ctx, templateId);
  const repeatPenalty = getRepeatPenalty(ctx, templateId);
  const dismissPenalty = getDismissPenalty(ctx, templateId);

  const normalizedScore = clamp01(
    ruleScore + blindSpotBonus + usefulnessBonus - repeatPenalty - dismissPenalty,
  );

  return {
    ruleScore,
    blindSpotBonus,
    usefulnessBonus,
    repeatPenalty,
    dismissPenalty,
    normalizedScore,
  };
}
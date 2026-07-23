import { UC4_RULE_REGISTRY } from "./uc4RuleRegistry";
import {
  FiredRule,
  UC4Candidate,
  UC4RuleContext,
  UC4Template,
  UC4TemplateId,
} from "./uc4Types";
import { UC4_TEMPLATE_REGISTRY } from "./uc4TemplateRegistry";
import { scoreCandidate } from "./uc4Scoring";

export function fireUC4Rules(ctx: UC4RuleContext): FiredRule[] {
  const firedRules: FiredRule[] = [];

  for (const rule of UC4_RULE_REGISTRY) {
    const fired = rule.evaluate(ctx);
    if (fired) {
      firedRules.push(fired);
    }
  }

  return firedRules;
}

function groupRulesByTemplate(firedRules: FiredRule[]): Map<UC4TemplateId, FiredRule[]> {
  const map = new Map<UC4TemplateId, FiredRule[]>();

  for (const rule of firedRules) {
    for (const templateId of rule.appliesToTemplates) {
      const existing = map.get(templateId) ?? [];
      existing.push(rule);
      map.set(templateId, existing);
    }
  }

  return map;
}

function hasValidTemplate(template: UC4Template | undefined): template is UC4Template {
  if (!template) return false;
  if (!template.templateId) return false;
  if (!template.whatToLogNextSchema || template.whatToLogNextSchema.length === 0) return false;
  return true;
}

export function generateUC4Candidates(ctx: UC4RuleContext): UC4Candidate[] {
  const firedRules = fireUC4Rules(ctx);
  const byTemplate = groupRulesByTemplate(firedRules);
  const candidates: UC4Candidate[] = [];

  for (const template of UC4_TEMPLATE_REGISTRY) {
    if (!hasValidTemplate(template)) continue;

    const rulesForTemplate = byTemplate.get(template.templateId) ?? [];
    if (rulesForTemplate.length === 0) continue;

    const scoreTrace = scoreCandidate({
      ctx,
      templateId: template.templateId,
      firedRules: rulesForTemplate,
    });

    candidates.push({
      patientId: ctx.patient.patientId,
      templateId: template.templateId,
      firedRules: rulesForTemplate,
      scoreTrace,
      finalScore: scoreTrace.normalizedScore,
    });
  }

  return candidates.sort((a, b) => b.finalScore - a.finalScore);
}

export function selectTopUC4Candidates(
  candidates: UC4Candidate[],
  maxCards = 3,
): UC4Candidate[] {
  const selected: UC4Candidate[] = [];
  const usedDomains = new Set<string>();

  for (const candidate of candidates) {
    if (selected.length >= maxCards) break;

    const template = UC4_TEMPLATE_REGISTRY.find((t) => t.templateId === candidate.templateId);
    if (!template) continue;

    if (usedDomains.has(template.domain) && selected.length > 0) {
      continue;
    }

    selected.push(candidate);
    usedDomains.add(template.domain);
  }

  if (selected.length < maxCards) {
    for (const candidate of candidates) {
      if (selected.length >= maxCards) break;
      if (selected.some((existing) => existing.templateId === candidate.templateId)) continue;
      selected.push(candidate);
    }
  }

  return selected;
}
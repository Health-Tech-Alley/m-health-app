import {
  EvidenceRef,
  UC4Candidate,
  UC4PriorityCard,
  UC4RunInput,
  UC4_SCHEMA_VERSION,
  UC4_TEMPLATE_REGISTRY_VERSION,
  UC4_RULE_REGISTRY_VERSION,
  UC4_SCORING_VERSION,
  UC4_ENGINE_VERSION,
} from "./uc4Types";
import { getTemplateById } from "./uc4TemplateRegistry";

function renderTemplateText(templateText: string, params: Record<string, string>): string {
  let rendered = templateText;

  for (const [key, value] of Object.entries(params)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  }

  return rendered;
}

function flattenEvidence(candidate: UC4Candidate): EvidenceRef[] {
  return candidate.firedRules.flatMap((rule) => rule.evidence);
}

export function renderUC4PriorityCard(
  candidate: UC4Candidate,
  input: UC4RunInput,
): UC4PriorityCard | null {
  const template = getTemplateById(candidate.templateId);

  if (!template) return null;
  if (!template.whatToLogNextSchema || template.whatToLogNextSchema.length === 0) return null;

  const params = {
    patientName: input.patient.displayName,
  };

  return {
    patientId: input.patient.patientId,
    templateId: template.templateId,
    title: renderTemplateText(template.titleTemplate, params),
    body: renderTemplateText(template.bodyTemplate, params),
    priorityKind: template.priorityKind,
    domain: template.domain,
    score: candidate.finalScore,
    firedRuleCodes: candidate.firedRules.map((rule) => rule.ruleCode),
    evidence: flattenEvidence(candidate),
    whatToLogNextSchema: template.whatToLogNextSchema,
    freeTextUsedForScoring: false,
    safetyBoundary: template.safetyBoundary,
    generatedAtIso: input.nowIso,
    versions: {
      schema: UC4_SCHEMA_VERSION,
      templateRegistry: UC4_TEMPLATE_REGISTRY_VERSION,
      ruleRegistry: UC4_RULE_REGISTRY_VERSION,
      scoring: UC4_SCORING_VERSION,
      engine: UC4_ENGINE_VERSION,
    },
  };
}
import { UC4_TEMPLATE_REGISTRY } from "./uc4TemplateRegistry";
import { UC4_RULE_REGISTRY } from "./uc4RuleRegistry";

export interface UC4ValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

export function validateUC4Registries(): UC4ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const templateIds = new Set(UC4_TEMPLATE_REGISTRY.map((template) => template.templateId));

  for (const template of UC4_TEMPLATE_REGISTRY) {
    if (!template.templateId) {
      errors.push("Template missing templateId.");
    }

    if (!template.titleTemplate || !template.bodyTemplate) {
      errors.push(`Template ${template.templateId} missing title/body template.`);
    }

    if (!template.whatToLogNextSchema || template.whatToLogNextSchema.length === 0) {
      errors.push(
        `Template ${template.templateId} has no whatToLogNextSchema. It cannot produce caregiver-facing output.`,
      );
    }

    for (const field of template.whatToLogNextSchema) {
      if (field.type === "short_text_provider_context" && field.usedForScoring) {
        errors.push(
          `Template ${template.templateId} field ${field.fieldId} uses free text for scoring. Not allowed.`,
        );
      }
    }
  }

  for (const rule of UC4_RULE_REGISTRY) {
    if (!rule.ruleCode) {
      errors.push("Rule missing ruleCode.");
    }

    if (rule.weight < 0 || rule.weight > 1) {
      errors.push(`Rule ${rule.ruleCode} has invalid weight ${rule.weight}.`);
    }

    for (const templateId of rule.appliesToTemplates) {
      if (!templateIds.has(templateId)) {
        errors.push(
          `Rule ${rule.ruleCode} applies to missing template ${templateId}.`,
        );
      }
    }

    if (!rule.evidenceFields || rule.evidenceFields.length === 0) {
      warnings.push(`Rule ${rule.ruleCode} has no declared evidenceFields.`);
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
  };
}
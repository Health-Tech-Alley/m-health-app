import { FiredRule, UC4AuditRecord, UC4Candidate, UC4PriorityCard } from "./uc4Types";

function makeAuditId(): string {
  return `uc4-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function auditRunStarted(patientId: string, timestampIso: string): UC4AuditRecord {
  return {
    auditId: makeAuditId(),
    patientId,
    timestampIso,
    action: "UC4_RUN_STARTED",
  };
}

export function auditPausedForEmergency(
  patientId: string,
  timestampIso: string,
): UC4AuditRecord {
  return {
    auditId: makeAuditId(),
    patientId,
    timestampIso,
    action: "UC4_PAUSED_FOR_EMERGENCY",
    details: {
      reason: "UC1/UC2 Severity 3 emergency context active. Routine UC4 checklist generation paused.",
    },
  };
}

export function auditRuleFired(
  patientId: string,
  timestampIso: string,
  rule: FiredRule,
): UC4AuditRecord {
  return {
    auditId: makeAuditId(),
    patientId,
    timestampIso,
    action: "UC4_RULE_FIRED",
    ruleCode: rule.ruleCode,
    details: {
      description: rule.description,
      weight: rule.weight,
      evidence: rule.evidence,
      safetyTags: rule.safetyTags,
    },
  };
}

export function auditCandidateScored(
  timestampIso: string,
  candidate: UC4Candidate,
): UC4AuditRecord {
  return {
    auditId: makeAuditId(),
    patientId: candidate.patientId,
    timestampIso,
    action: "UC4_CANDIDATE_SCORED",
    templateId: candidate.templateId,
    score: candidate.finalScore,
    details: {
      scoreTrace: candidate.scoreTrace,
      firedRuleCodes: candidate.firedRules.map((rule) => rule.ruleCode),
    },
  };
}

export function auditCardRendered(
  timestampIso: string,
  card: UC4PriorityCard,
): UC4AuditRecord {
  return {
    auditId: makeAuditId(),
    patientId: card.patientId,
    timestampIso,
    action: "UC4_CARD_RENDERED",
    templateId: card.templateId,
    score: card.score,
    details: {
      firedRuleCodes: card.firedRuleCodes,
      freeTextUsedForScoring: card.freeTextUsedForScoring,
      safetyBoundary: card.safetyBoundary,
    },
  };
}

export function auditRunCompleted(
  patientId: string,
  timestampIso: string,
  selectedCardCount: number,
): UC4AuditRecord {
  return {
    auditId: makeAuditId(),
    patientId,
    timestampIso,
    action: "UC4_RUN_COMPLETED",
    details: {
      selectedCardCount,
    },
  };
}
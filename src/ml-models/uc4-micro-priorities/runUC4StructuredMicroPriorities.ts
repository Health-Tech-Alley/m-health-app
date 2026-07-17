import { buildUC4RuleContext } from "./uc4Aggregation";
import { generateUC4Candidates, selectTopUC4Candidates } from "./uc4RuleEngine";
import { renderUC4PriorityCard } from "./uc4Renderer";
import {
  UC4RunInput,
  UC4RunOutput,
} from "./uc4Types";
import {
  auditCandidateScored,
  auditCardRendered,
  auditPausedForEmergency,
  auditRuleFired,
  auditRunCompleted,
  auditRunStarted,
} from "./uc4Audit";

export function runUC4StructuredMicroPriorities(input: UC4RunInput): UC4RunOutput {
  const auditRecords = [auditRunStarted(input.patient.patientId, input.nowIso)];

  if (
    input.uc1ActiveEmergency ||
    input.currentSeverityContext === "uc1_or_uc2_severity_3_emergency"
  ) {
    auditRecords.push(auditPausedForEmergency(input.patient.patientId, input.nowIso));

    return {
      patientId: input.patient.patientId,
      paused: true,
      pauseReason:
        "Routine UC4 checklist generation paused because active UC1/UC2 Severity 3 emergency context is present.",
      candidates: [],
      selectedCards: [],
      auditRecords,
    };
  }

  const ctx = buildUC4RuleContext(input);
  const candidates = generateUC4Candidates(ctx);

  for (const candidate of candidates) {
    for (const rule of candidate.firedRules) {
      auditRecords.push(auditRuleFired(input.patient.patientId, input.nowIso, rule));
    }

    auditRecords.push(auditCandidateScored(input.nowIso, candidate));
  }

  const selectedCandidates = selectTopUC4Candidates(candidates, 3);

  const selectedCards = selectedCandidates
    .map((candidate) => renderUC4PriorityCard(candidate, input))
    .filter((card): card is NonNullable<typeof card> => card !== null);

  for (const card of selectedCards) {
    auditRecords.push(auditCardRendered(input.nowIso, card));
  }

  auditRecords.push(
    auditRunCompleted(input.patient.patientId, input.nowIso, selectedCards.length),
  );

  return {
    patientId: input.patient.patientId,
    paused: false,
    candidates,
    selectedCards,
    auditRecords,
  };
}
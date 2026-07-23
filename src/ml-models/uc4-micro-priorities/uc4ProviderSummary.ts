import { UC4PriorityCard, UC4StructuredEvent } from "./uc4Types";

export function renderUC4ProviderSummary(params: {
  patientName: string;
  patientId: string;
  cards: UC4PriorityCard[];
  recentEvents: UC4StructuredEvent[];
  generatedAtIso: string;
}): string {
  const { patientName, patientId, cards, recentEvents, generatedAtIso } = params;

  const lines: string[] = [];

  lines.push(`UC4 Structured Care Priority Summary`);
  lines.push(`Generated: ${generatedAtIso}`);
  lines.push(`Patient: ${patientName}`);
  lines.push(`Patient ID: ${patientId}`);
  lines.push("");
  lines.push(`Safety note: This summary is generated from structured caregiver, wearable, care-plan, and UC1/UC2 context. It is not a diagnosis or treatment recommendation.`);
  lines.push("");

  lines.push(`Selected UC4 Priorities:`);
  if (cards.length === 0) {
    lines.push(`- No routine UC4 priorities generated.`);
  }

  for (const card of cards) {
    lines.push(`- ${card.title}`);
    lines.push(`  Template: ${card.templateId}`);
    lines.push(`  Score: ${card.score.toFixed(3)}`);
    lines.push(`  Rules: ${card.firedRuleCodes.join(", ")}`);
    lines.push(`  Safety boundary: ${card.safetyBoundary}`);
  }

  lines.push("");
  lines.push(`Recent Structured Event Count: ${recentEvents.length}`);
  lines.push(`Free text used for scoring: false`);

  return lines.join("\n");
}
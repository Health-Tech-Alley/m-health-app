import { EHRRehabContext } from "./types";
import { clamp, round } from "./mathUtils";

export interface ComplexityScoreBreakdown {
  finalScore: number;
  contributingFactors: string[];
  factorScores: Record<string, number>;
}

/**
 * Calculates a normalized patient rehab complexity score from 0.0 to 1.0.
 *
 * This is intentionally transparent and rule-based for app-readiness.
 *
 * Higher score means:
 * - more complex rehab baseline
 * - greater need for cautious trajectory interpretation
 * - more context needed during clinician review
 *
 * This score does NOT diagnose risk or determine emergencies.
 */
export function calculateComplexityScore(
  ehrContext: Omit<EHRRehabContext, "complexityScore"> | EHRRehabContext
): ComplexityScoreBreakdown {
  const factorScores: Record<string, number> = {};
  const contributingFactors: string[] = [];

  const textBlob = [
    ehrContext.conditionGroup,
    ...(ehrContext.mobilityLimitations || []),
    ...(ehrContext.relevantHistory || []),
    ...(ehrContext.safetyConsiderations || []),
    ehrContext.sourceSummary || ""
  ]
    .join(" ")
    .toLowerCase();

  function hasAny(terms: string[]): boolean {
    return terms.some((term) => textBlob.includes(term.toLowerCase()));
  }

  function addFactor(
    key: string,
    score: number,
    label: string,
    terms: string[]
  ) {
    if (hasAny(terms)) {
      factorScores[key] = score;
      contributingFactors.push(label);
    } else {
      factorScores[key] = 0;
    }
  }

  addFactor(
    "neurologic_condition",
    0.18,
    "Neurologic condition affecting rehabilitation",
    [
      "stroke",
      "post-stroke",
      "cerebral palsy",
      "spastic",
      "tbi",
      "traumatic brain injury",
      "neurologic",
      "hemiparesis",
      "weakness"
    ]
  );

  addFactor(
    "mobility_limitation",
    0.16,
    "Baseline mobility limitation",
    [
      "limited walking",
      "walking endurance",
      "wheelchair",
      "walker",
      "cane",
      "transfer",
      "gait",
      "ambulation",
      "balance",
      "fall risk",
      "stander"
    ]
  );

  addFactor(
    "range_of_motion_limitation",
    0.14,
    "Range-of-motion or contracture limitation",
    [
      "reduced range of motion",
      "rom",
      "contracture",
      "limited range",
      "tightness",
      "spasticity",
      "tone"
    ]
  );

  addFactor(
    "pain_burden",
    0.12,
    "Pain may interfere with rehabilitation",
    [
      "pain",
      "chronic pain",
      "hip pain",
      "shoulder pain",
      "severe pain"
    ]
  );

  addFactor(
    "fatigue_or_deconditioning",
    0.10,
    "Fatigue or deconditioning may limit progress",
    [
      "fatigue",
      "deconditioning",
      "weakness",
      "low endurance",
      "icu",
      "hospitalization"
    ]
  );

  addFactor(
    "caregiver_dependence",
    0.10,
    "Caregiver-assisted rehabilitation context",
    [
      "caregiver",
      "assisted",
      "dependent",
      "home-assisted",
      "requires caregiver",
      "non-clinical caregiver"
    ]
  );

  addFactor(
    "connectivity_or_access_barrier",
    0.08,
    "Access or connectivity barrier",
    [
      "rural",
      "intermittent connectivity",
      "offline",
      "transportation",
      "limited access"
    ]
  );

  addFactor(
    "safety_monitoring_need",
    0.10,
    "Safety monitoring considerations present",
    [
      "new weakness",
      "fall",
      "fall with injury",
      "shortness of breath",
      "chest pain",
      "confusion",
      "loss of consciousness",
      "dvt",
      "blood clot"
    ]
  );

  addFactor(
    "multiple_rehab_barriers",
    0.12,
    "Multiple rehabilitation barriers documented",
    [
      "multiple barriers",
      "complex",
      "high complexity",
      "multimorbidity",
      "multiple limitations"
    ]
  );

  const rawScore = Object.values(factorScores).reduce(
    (sum, value) => sum + value,
    0
  );

  const finalScore = round(clamp(rawScore, 0, 1), 3);

  return {
    finalScore,
    contributingFactors,
    factorScores
  };
}
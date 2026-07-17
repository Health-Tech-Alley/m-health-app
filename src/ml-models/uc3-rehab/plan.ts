import {
  EHRRehabContext,
  PatientContext,
  RehabMetricName,
  RehabMetricPlan,
  RehabPlan,
  RehabPlanBuildOptions,
  MetricTargetOverride,
} from "./types";

import { calculateComplexityScore } from "./complexity";

export function buildEhrRehabContextFromExtractedProfile(input: {
  conditionGroup: string;
  mobilityLimitations?: string[];
  relevantHistory?: string[];
  safetyConsiderations?: string[];
  sourceSummary?: string;
}): EHRRehabContext {
  const baseContext = {
    conditionGroup: input.conditionGroup,
    mobilityLimitations: input.mobilityLimitations ?? [],
    relevantHistory: input.relevantHistory ?? [],
    safetyConsiderations: input.safetyConsiderations ?? [],
    sourceSummary: input.sourceSummary ?? ""
  };

  const complexity = calculateComplexityScore(baseContext);

  return {
    ...baseContext,
    complexityScore: complexity.finalScore,
    complexityMetadata: complexity
  };
}

function createMetricPlan(
  metricName: RehabMetricName,
  baselineValue: number,
  targetValue: number,
  durationDays: number,
  higherIsBetter: boolean,
): RehabMetricPlan {
  const dailyStep =
    durationDays > 1 ? (targetValue - baselineValue) / (durationDays - 1) : 0;

  const expectedValues = Array.from({ length: durationDays }, (_, dayIndex) => {
    return baselineValue + dailyStep * dayIndex;
  });

  return {
    metricName,
    baselineValue,
    targetValue,
    durationDays,
    higherIsBetter,
    expectedValues,
  };
}

function applyMetricOverride(
  metricName: RehabMetricName,
  defaultBaseline: number,
  defaultTarget: number,
  defaultHigherIsBetter: boolean,
  durationDays: number,
  override?: MetricTargetOverride,
): RehabMetricPlan {
  const baselineValue = override?.baselineValue ?? defaultBaseline;
  const targetValue = override?.targetValue ?? defaultTarget;
  const higherIsBetter = override?.higherIsBetter ?? defaultHigherIsBetter;

  return createMetricPlan(
    metricName,
    baselineValue,
    targetValue,
    durationDays,
    higherIsBetter,
  );
}

function getOverriddenMetricNames(
  metricTargets?: RehabPlanBuildOptions["metricTargets"],
): RehabMetricName[] {
  if (!metricTargets) return [];

  return Object.entries(metricTargets)
    .filter(([, override]) => override !== undefined)
    .map(([metricName]) => metricName as RehabMetricName);
}

function getOverriddenRuleNames(
  ruleOverrides?: RehabPlanBuildOptions["ruleOverrides"],
): string[] {
  if (!ruleOverrides) return [];

  return Object.entries(ruleOverrides)
    .filter(([, value]) => value !== undefined)
    .map(([ruleName]) => ruleName);
}

export function buildRehabPlan(
  patient: PatientContext,
  ehrContext: EHRRehabContext,
  options: RehabPlanBuildOptions = {},
): RehabPlan {
  const durationDays = options.durationDays ?? 28;

  const metricTargets = options.metricTargets ?? {};
  const ruleOverrides = options.ruleOverrides ?? {};

  // 1. Map Target Metrics to Age/Condition
  let defaultRomBaseline = 30;
  let defaultRomTarget = 64.5;

  const isOlderStroke =
    patient.ageYears >= 65
  const isYoungerSports =
    patient.ageYears < 40

  if (isYoungerSports) {
    defaultRomBaseline = 45;
    defaultRomTarget = 90.0;
  } else if (!isOlderStroke && patient.ageYears < 50) {
    defaultRomTarget = 75.0;
  }

  const metrics: Record<RehabMetricName, RehabMetricPlan> = {
    romDegrees: applyMetricOverride(
      "romDegrees",
      defaultRomBaseline,
      defaultRomTarget,
      true,
      durationDays,
      metricTargets.romDegrees,
    ),

    exerciseReps: applyMetricOverride(
      "exerciseReps",
      8,
      18.5,
      true,
      durationDays,
      metricTargets.exerciseReps,
    ),

    adherence: applyMetricOverride(
      "adherence",
      0.65,
      0.89,
      true,
      durationDays,
      metricTargets.adherence,
    ),

    painScore: applyMetricOverride(
      "painScore",
      4.5,
      2.2,
      false,
      durationDays,
      metricTargets.painScore,
    ),

    fatigueScore: applyMetricOverride(
      "fatigueScore",
      5.5,
      3.2,
      false,
      durationDays,
      metricTargets.fatigueScore,
    ),

    walkingMinutes: applyMetricOverride(
      "walkingMinutes",
      3,
      12.5,
      true,
      durationDays,
      metricTargets.walkingMinutes,
    ),
  };

  const milestones: Record<RehabMetricName, number[]> = {
    romDegrees: metrics.romDegrees.expectedValues,
    exerciseReps: metrics.exerciseReps.expectedValues,
    adherence: metrics.adherence.expectedValues,
    painScore: metrics.painScore.expectedValues,
    fatigueScore: metrics.fatigueScore.expectedValues,
    walkingMinutes: metrics.walkingMinutes.expectedValues,
  };

  // 2. Scale Rules by Complexity Score
  let defaultRomGapThreshold = 0.18;
  let defaultPlateauDaysThreshold = 9;

  // Extremely complex cases get more forgiving thresholds
  if (ehrContext.complexityScore > 0.89) {
    defaultRomGapThreshold = 0.25;
    defaultPlateauDaysThreshold = 12;
  }
  // Low complexity cases are held to stricter thresholds
  else if (ehrContext.complexityScore < 0.4) {
    defaultRomGapThreshold = 0.15;
    defaultPlateauDaysThreshold = 7;
  }

  const ruleThresholds = {
    romGapThreshold: ruleOverrides.romGapThreshold ?? defaultRomGapThreshold,
    plateauDaysThreshold:
      ruleOverrides.plateauDaysThreshold ?? defaultPlateauDaysThreshold,
    adherenceMinimum: ruleOverrides.adherenceMinimum ?? 0.8,
    painConcernThreshold: ruleOverrides.painConcernThreshold ?? 4,
    fatigueConcernThreshold: ruleOverrides.fatigueConcernThreshold ?? 5,
    insufficientDataMinimumDays:
      ruleOverrides.insufficientDataMinimumDays ?? 7,
  };

  const overriddenMetrics = getOverriddenMetricNames(metricTargets);
  const overriddenRules = getOverriddenRuleNames(ruleOverrides);

  return {
    planId: `rehab_plan_${patient.patientId}`,
    scenario: "trajectory_failure",
    patient,
    conditionGroup: ehrContext.conditionGroup,
    complexityScore: ehrContext.complexityScore,

    metricRelevance: {
      romDegrees: 1.0,
      exerciseReps: 0.75,
      adherence: 0.95,
      painScore: 0.8,
      fatigueScore: 0.7,
      walkingMinutes: 0.65,
    },

    durationDays,
    metrics,
    milestones,

    clinicianAuthoredGoals: [
      "Maintain high home exercise adherence.",
      "Improve functional range of motion according to expected recovery trajectory.",
      "Identify plateau or delayed recovery before routine follow-up.",
      "Escalate urgent symptoms separately from non-emergency trajectory failure.",
    ],

    safetyBoundaries: [
      "New chest pain, severe shortness of breath, new neurologic deficit, or fall with injury should trigger urgent safety escalation.",
      "Trajectory failure alerts are non-emergency review prompts unless emergency thresholds are crossed.",
      "Caregiver-entered symptoms should be reviewed in context by a clinician.",
    ],

    ruleThresholds,

    overrideMetadata: {
      hasOverrides: overriddenMetrics.length > 0 || overriddenRules.length > 0,
      planSource: options.planSource,
      planNote: options.planNote,
      overriddenMetrics,
      overriddenRules,
    },
  };
}
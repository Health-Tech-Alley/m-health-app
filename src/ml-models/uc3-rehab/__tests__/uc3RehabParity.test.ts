import {
  buildEhrRehabContextFromExtractedProfile,
  buildRehabPlan,
  deriveAdherenceFromDailyLog,
  evaluateRehabTrajectory,
} from "../";
import type { DailyRehabLog, EHRRehabContext, PatientContext, RehabPlan } from "../types";

const patient: PatientContext = {
  patientId: "uc3-v2-parity-fixture",
  displayName: "UC3 v2 parity fixture",
  ageYears: 67,
  condition: "Post-stroke rehabilitation",
  setting: "Home-assisted",
  caregiverName: "Caregiver",
  locationContext: "Rural Maryland, intermittent connectivity",
};

const extractedProfile = {
  conditionGroup: "post_stroke_rehabilitation",
  mobilityLimitations: [
    "reduced range of motion",
    "limited walking endurance",
    "requires caregiver-assisted home rehabilitation",
  ],
  relevantHistory: [
    "post-stroke rehabilitation",
    "home PT monitoring",
    "intermittent connectivity limits real-time escalation",
  ],
  safetyConsiderations: [
    "monitor for new weakness",
    "monitor for severe sudden pain",
    "monitor for falls with injury",
    "monitor for shortness of breath or chest pain",
  ],
  sourceSummary:
    "EHR context used as baseline risk and personalization context; daily home logs drive trajectory monitoring.",
};

const romDegrees = [
  36.0, 38.2, 40.1, 42.8, 45.2, 47.4, 49.1, 50.5, 51.2, 51.9, 52.4,
  52.8, 52.7, 52.6, 52.5, 52.4, 52.3, 52.2, 52.2, 52.1, 52.11,
];

const exerciseReps = [
  9, 10, 10.5, 11, 12, 12.5, 13, 13.2, 13.8, 14.1, 14.6, 15, 15.3,
  15.7, 16.1, 16.4, 16.8, 17.1, 17.3, 17.5, 17.67,
];

const sourceAdherence = [
  0.84, 0.86, 0.87, 0.88, 0.89, 0.87, 0.88, 0.86, 0.89, 0.87, 0.88,
  0.87, 0.88, 0.87, 0.86, 0.87, 0.88, 0.87, 0.87, 0.88, 0.87,
];

const painScore = [
  4.2, 4.1, 4.0, 3.9, 3.8, 3.9, 3.7, 3.8, 3.7, 3.8, 3.6, 3.7, 3.6,
  3.6, 3.7, 3.6, 3.6, 3.7, 3.6, 3.6, 3.61,
];

const fatigueScore = [
  5.2, 5.1, 5.0, 4.9, 4.8, 4.9, 4.7, 4.8, 4.7, 4.8, 4.7, 4.6, 4.7,
  4.6, 4.7, 4.6, 4.7, 4.6, 4.7, 4.6, 4.66,
];

const walkingMinutes = [
  5.5, 5.9, 6.2, 6.6, 6.9, 7.1, 7.4, 7.6, 7.8, 8.0, 8.2, 8.4, 8.5,
  8.6, 8.7, 8.8, 8.85, 8.9, 8.95, 9.0, 9.03,
];

function buildEhrContext(): EHRRehabContext {
  return buildEhrRehabContextFromExtractedProfile(extractedProfile);
}

function buildTrajectoryFailureLogs(): DailyRehabLog[] {
  return romDegrees.map((romValue, index) => ({
    dayIndex: index + 1,
    romDegrees: romValue,
    exerciseReps: exerciseReps[index],
    exercisesAssigned: 10,
    exercisesCompleted: Math.round(10 * sourceAdherence[index]),
    therapyMinutesPlanned: 30,
    therapyMinutesCompleted: Math.round(30 * sourceAdherence[index]),
    sessionCompleted: sourceAdherence[index] > 0,
    painScore: painScore[index],
    fatigueScore: fatigueScore[index],
    walkingMinutes: walkingMinutes[index],
    symptoms: [],
    notes: "Exercises completed with caregiver support, but range of motion feels stuck.",
    offlineCreatedAt: "2026-07-15T09:00:00Z",
  }));
}

function buildDelivered28DayPlan(ehrContext: EHRRehabContext): RehabPlan {
  return buildRehabPlan(patient, ehrContext, {
    durationDays: 28,
    planSource: "demo_patient_specific_plan",
    metricTargets: {
      romDegrees: {
        baselineValue: 30,
        targetValue: 64.5,
        higherIsBetter: true,
        source: "demo_default",
      },
    },
    ruleOverrides: {
      romGapThreshold: 0.18,
      plateauDaysThreshold: 9,
      adherenceMinimum: 0.8,
    },
  });
}

function buildDiagnostic21DayPlan(ehrContext: EHRRehabContext): RehabPlan {
  return buildRehabPlan(patient, ehrContext, {
    durationDays: 21,
    metricTargets: {
      romDegrees: { baselineValue: 30, targetValue: 64.5, higherIsBetter: true },
      exerciseReps: { baselineValue: 8, targetValue: 18.5, higherIsBetter: true },
      adherence: { baselineValue: 0.7, targetValue: 0.89, higherIsBetter: true },
      painScore: { baselineValue: 4.5, targetValue: 2.24, higherIsBetter: false },
      fatigueScore: { baselineValue: 5.2, targetValue: 3.2, higherIsBetter: false },
      walkingMinutes: { baselineValue: 5, targetValue: 12.5, higherIsBetter: true },
    },
    ruleOverrides: {
      romGapThreshold: 0.18,
      plateauDaysThreshold: 9,
      adherenceMinimum: 0.8,
      insufficientDataMinimumDays: 14,
    },
  });
}

describe("UC3 rehab v2 source parity", () => {
  it("preserves the executable v2 28-day trajectory scenario result", () => {
    const ehrContext = buildEhrContext();
    const decision = evaluateRehabTrajectory(
      buildDelivered28DayPlan(ehrContext),
      buildTrajectoryFailureLogs(),
      ehrContext,
    );

    expect(decision.modelVersion).toBe("rehab_trajectory_rules_v0.2.0");
    expect(decision.eventType).toBe("NO_TRAJECTORY_FAILURE");
    expect(decision.severity).toBe("none");
    expect(decision.requiresHumanReview).toBe(false);
    expect(decision.emergencyThresholdBreach).toBe(false);
    expect(decision.reviewPriorityScore).toBe(0.844);
    expect(decision.reasonCodes).toEqual([
      "NO_EMERGENCY_THRESHOLD_BREACH",
      "HIGH_ADHERENCE",
      "NINE_DAY_PLATEAU",
    ]);
    expect(decision.metricAnalyses.romDegrees).toMatchObject({
      finalActual: 52.11,
      finalExpected: 55.56,
      gap: 3.45,
      gapPercent: 0.062,
      recentSlope: -0.078,
      plateauDays: 9,
      dataPoints: 21,
    });
    expect(decision.metricAnalyses.adherence).toMatchObject({
      finalActual: 0.89,
      finalExpected: 0.83,
      gap: 0,
      gapPercent: 0,
      recentSlope: 0,
      plateauDays: 9,
      dataPoints: 21,
    });
    expect(decision.dataQuality).toMatchObject({
      totalExpectedDays: 28,
      totalLoggedDays: 21,
      missingDays: [22, 23, 24, 25, 26, 27, 28],
      completenessRatio: 0.75,
      sufficientData: true,
      warnings: [],
    });
  });

  it("preserves the executable v2 21-day diagnostic trajectory result", () => {
    const ehrContext = buildEhrContext();
    const decision = evaluateRehabTrajectory(
      buildDiagnostic21DayPlan(ehrContext),
      buildTrajectoryFailureLogs(),
      ehrContext,
    );

    expect(decision.eventType).toBe("TRAJECTORY_FAILURE_DETECTED");
    expect(decision.severity).toBe("non_emergency");
    expect(decision.requiresHumanReview).toBe(true);
    expect(decision.emergencyThresholdBreach).toBe(false);
    expect(decision.reviewPriorityScore).toBe(0.947);
    expect(decision.reasonCodes).toEqual([
      "NO_EMERGENCY_THRESHOLD_BREACH",
      "HIGH_ADHERENCE",
      "ROM_BELOW_MILESTONE",
      "NINE_DAY_PLATEAU",
    ]);
    expect(decision.metricAnalyses.romDegrees).toMatchObject({
      finalActual: 52.11,
      finalExpected: 64.5,
      gap: 12.39,
      gapPercent: 0.192,
      recentSlope: -0.078,
      plateauDays: 9,
      dataPoints: 21,
    });
    expect(decision.metricAnalyses.adherence).toMatchObject({
      finalActual: 0.89,
      finalExpected: 0.89,
      gap: 0,
      gapPercent: 0,
      recentSlope: 0,
      plateauDays: 9,
      dataPoints: 21,
    });
    expect(decision.dataQuality).toMatchObject({
      totalExpectedDays: 21,
      totalLoggedDays: 21,
      missingDays: [],
      completenessRatio: 1,
      sufficientData: true,
      warnings: [],
    });
  });

  it("preserves urgent safety emergency behavior", () => {
    const ehrContext = buildEhrContext();
    const logs = buildTrajectoryFailureLogs();
    logs[logs.length - 1] = {
      ...logs[logs.length - 1],
      symptoms: ["new_weakness", "severe_pain"],
    };

    const decision = evaluateRehabTrajectory(
      buildRehabPlan(patient, ehrContext),
      logs,
      ehrContext,
    );

    expect(decision.eventType).toBe("URGENT_SAFETY_ESCALATION");
    expect(decision.severity).toBe("urgent");
    expect(decision.requiresHumanReview).toBe(true);
    expect(decision.emergencyThresholdBreach).toBe(true);
    expect(decision.reviewPriorityScore).toBe(1);
    expect(decision.reasonCodes).toEqual(["EMERGENCY_SYMPTOM_REPORTED"]);
    expect(decision.explanations).toEqual([
      "Urgent safety symptom reported: new_weakness, severe_pain. This bypasses ordinary rehab review scoring.",
    ]);
  });

  it("preserves the executable v2 low-adherence default-plan result", () => {
    const ehrContext = buildEhrContext();
    const logs = buildTrajectoryFailureLogs().map((log) => ({
      ...log,
      exercisesCompleted: 4,
      therapyMinutesCompleted: 14,
      notes:
        "Caregiver reports exercises were often skipped because of fatigue and motivation barriers.",
    }));

    const decision = evaluateRehabTrajectory(
      buildRehabPlan(patient, ehrContext),
      logs,
      ehrContext,
    );

    expect(decision.eventType).toBe("NO_TRAJECTORY_FAILURE");
    expect(decision.severity).toBe("none");
    expect(decision.requiresHumanReview).toBe(false);
    expect(decision.reviewPriorityScore).toBe(0.819);
    expect(decision.reasonCodes).toEqual(["NO_EMERGENCY_THRESHOLD_BREACH"]);
    expect(decision.metricAnalyses.romDegrees).toMatchObject({
      finalActual: 52.11,
      finalExpected: 55.56,
      gap: 3.45,
      gapPercent: 0.062,
      recentSlope: -0.078,
      plateauDays: 9,
      dataPoints: 21,
    });
    expect(decision.metricAnalyses.adherence).toMatchObject({
      finalActual: 0.42,
      finalExpected: 0.83,
      gap: 0.41,
      gapPercent: 0.493,
      recentSlope: 0,
      plateauDays: 9,
      dataPoints: 21,
    });
  });

  it("derives adherence from Jay's weighted exercise and therapy-minute formula", () => {
    const result = deriveAdherenceFromDailyLog({
      dayIndex: 1,
      exercisesAssigned: 10,
      exercisesCompleted: 7,
      therapyMinutesPlanned: 30,
      therapyMinutesCompleted: 15,
      sessionCompleted: true,
    });

    expect(result.adherence).toBeCloseTo(0.7 * 0.7 + 0.5 * 0.3, 12);
    expect(result.source).toBe("derived_from_daily_log");
    expect(result.components).toMatchObject({
      exerciseCompletionRatio: 0.7,
      minutesCompletionRatio: 0.5,
      sessionCompletedCredit: 1,
      medicallyExcused: false,
    });
    expect(result.reasonCodes).toEqual([
      "EXERCISE_COMPLETION_USED",
      "THERAPY_MINUTES_USED",
    ]);
  });

  it("calculates complexity from Jay's source formula", () => {
    const ehrContext = buildEhrContext();

    expect(ehrContext.complexityScore).toBe(0.98);
    expect(ehrContext.complexityMetadata).toMatchObject({
      finalScore: 0.98,
      contributingFactors: [
        "Neurologic condition affecting rehabilitation",
        "Baseline mobility limitation",
        "Range-of-motion or contracture limitation",
        "Pain may interfere with rehabilitation",
        "Fatigue or deconditioning may limit progress",
        "Caregiver-assisted rehabilitation context",
        "Access or connectivity barrier",
        "Safety monitoring considerations present",
      ],
      factorScores: {
        neurologic_condition: 0.18,
        mobility_limitation: 0.16,
        range_of_motion_limitation: 0.14,
        pain_burden: 0.12,
        fatigue_or_deconditioning: 0.1,
        caregiver_dependence: 0.1,
        connectivity_or_access_barrier: 0.08,
        safety_monitoring_need: 0.1,
        multiple_rehab_barriers: 0,
      },
    });
  });

  it("uses v2 duration-minus-one milestone calculation", () => {
    const plan = buildDiagnostic21DayPlan(buildEhrContext());

    expect(plan.milestones.romDegrees).toHaveLength(21);
    expect(plan.milestones.romDegrees[0]).toBe(30);
    expect(plan.milestones.romDegrees[1]).toBeCloseTo(31.725, 12);
    expect(plan.milestones.romDegrees[10]).toBeCloseTo(47.25, 12);
    expect(plan.milestones.romDegrees[20]).toBe(64.5);
  });
});

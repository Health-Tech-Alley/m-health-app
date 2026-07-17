import {
  EvidenceRef,
  FiredRule,
  MedicationWatchCode,
  RuleValidator,
  UC4RuleContext,
  UC4TemplateId,
} from "./uc4Types";

function evidence(
  fieldPath: string,
  value: EvidenceRef["value"],
  comparator: EvidenceRef["comparator"],
  threshold: EvidenceRef["threshold"],
  source: EvidenceRef["source"],
): EvidenceRef {
  return {
    fieldPath,
    value,
    comparator,
    threshold,
    source,
  };
}

function numericFeature(ctx: UC4RuleContext, key: string): number {
  const value = ctx.aggregateFeatures[key];
  return typeof value === "number" ? value : 0;
}

function booleanFeature(ctx: UC4RuleContext, key: string): boolean {
  return ctx.aggregateFeatures[key] === true;
}

function hasMedicationWatchArea(ctx: UC4RuleContext, watchCode: MedicationWatchCode): boolean {
  return ctx.medications.some((med) => med.watchAreas.includes(watchCode));
}

function makeRule(params: {
  ruleCode: string;
  description: string;
  weight: number;
  appliesToTemplates: UC4TemplateId[];
  evidenceFields: string[];
  safetyTags: string[];
  evaluate: (ctx: UC4RuleContext) => EvidenceRef[] | null;
}): RuleValidator {
  return {
    ruleCode: params.ruleCode,
    description: params.description,
    weight: params.weight,
    appliesToTemplates: params.appliesToTemplates,
    evidenceFields: params.evidenceFields,
    safetyTags: params.safetyTags,
    evaluate: (ctx) => {
      const evidenceRefs = params.evaluate(ctx);
      if (!evidenceRefs) return null;

      const fired: FiredRule = {
        ruleCode: params.ruleCode,
        description: params.description,
        weight: params.weight,
        appliesToTemplates: params.appliesToTemplates,
        evidence: evidenceRefs,
        safetyTags: params.safetyTags,
      };

      return fired;
    },
  };
}

export const UC4_RULE_REGISTRY: RuleValidator[] = [
  makeRule({
    ruleCode: "R_FATIGUE_RECURRENCE",
    description: "Repeated fatigue observations were logged.",
    weight: 0.22,
    appliesToTemplates: ["MEDICATION_WINDOW_FATIGUE_TRACKING"],
    evidenceFields: ["aggregateFeatures.fatigueEventCount"],
    safetyTags: ["no_diagnosis", "structured_observation_only"],
    evaluate: (ctx) => {
      const count = numericFeature(ctx, "fatigueEventCount");
      if (count < 2) return null;
      return [
        evidence("aggregateFeatures.fatigueEventCount", count, "gte", 2, "aggregate_features"),
      ];
    },
  }),

  makeRule({
    ruleCode: "R_MED_WATCH_AREA_MATCH_FATIGUE",
    description:
      "Medication profile includes fatigue/sleepiness as a known watch area. This is timing context only, not causality.",
    weight: 0.18,
    appliesToTemplates: ["MEDICATION_WINDOW_FATIGUE_TRACKING"],
    evidenceFields: ["medications.watchAreas"],
    safetyTags: ["no_medication_causality", "no_treatment_change"],
    evaluate: (ctx) => {
      const matched = hasMedicationWatchArea(ctx, "SLEEPINESS_FATIGUE");
      if (!matched) return null;
      return [
        evidence(
          "medications.watchAreas",
          "SLEEPINESS_FATIGUE",
          "contains",
          "SLEEPINESS_FATIGUE",
          "medication_profile",
        ),
      ];
    },
  }),

  makeRule({
    ruleCode: "R_MED_TIMING_CONTEXT_MISSING",
    description: "Fatigue was logged without clear medication-timing context.",
    weight: 0.12,
    appliesToTemplates: ["MEDICATION_WINDOW_FATIGUE_TRACKING"],
    evidenceFields: ["recentEvents.contextCodes"],
    safetyTags: ["no_medication_causality", "structured_context_needed"],
    evaluate: (ctx) => {
      const fatigueCount = numericFeature(ctx, "fatigueEventCount");
      const hasTimingContext = ctx.recentEvents.some((event) =>
        event.contextCodes.includes("AROUND_MEDICATION_TIME"),
      );
      if (fatigueCount < 1 || hasTimingContext) return null;
      return [
        evidence("aggregateFeatures.fatigueEventCount", fatigueCount, "gte", 1, "aggregate_features"),
        evidence(
          "recentEvents.contextCodes",
          hasTimingContext,
          "eq",
          false,
          "structured_events",
        ),
      ];
    },
  }),

  makeRule({
    ruleCode: "R_MISSED_DELAYED_MEDICATION_LOGGED",
    description: "Missed or delayed medication was logged.",
    weight: 0.24,
    appliesToTemplates: ["MISSED_DELAYED_MEDICATION_CONTEXT"],
    evidenceFields: ["aggregateFeatures.missedMedicationEventCount"],
    safetyTags: ["no_medication_change", "provider_context_only"],
    evaluate: (ctx) => {
      const count = numericFeature(ctx, "missedMedicationEventCount");
      if (count < 1) return null;
      return [
        evidence(
          "aggregateFeatures.missedMedicationEventCount",
          count,
          "gte",
          1,
          "aggregate_features",
        ),
      ];
    },
  }),

  makeRule({
    ruleCode: "R_TRANSFER_DISCOMFORT_RECURRENCE",
    description: "Repeated transfer, positioning, or discomfort observations were logged.",
    weight: 0.24,
    appliesToTemplates: ["TRANSFER_DISCOMFORT_TRACKING"],
    evidenceFields: ["aggregateFeatures.transferDiscomfortEventCount"],
    safetyTags: ["no_spasticity_measurement", "no_treatment_recommendation"],
    evaluate: (ctx) => {
      const count = numericFeature(ctx, "transferDiscomfortEventCount");
      if (count < 2) return null;
      return [
        evidence(
          "aggregateFeatures.transferDiscomfortEventCount",
          count,
          "gte",
          2,
          "aggregate_features",
        ),
      ];
    },
  }),

  makeRule({
    ruleCode: "R_TRANSFER_CONTEXT_CLUSTER",
    description: "Transfer or seated-position context appears repeatedly.",
    weight: 0.16,
    appliesToTemplates: ["TRANSFER_DISCOMFORT_TRACKING", "SKIN_PRESSURE_AFTER_SEATED_PERIOD"],
    evidenceFields: [
      "aggregateFeatures.transferContextCount",
      "aggregateFeatures.seatedPositionContextCount",
    ],
    safetyTags: ["structured_observation_only"],
    evaluate: (ctx) => {
      const transferCount = numericFeature(ctx, "transferContextCount");
      const seatedCount = numericFeature(ctx, "seatedPositionContextCount");
      if (transferCount + seatedCount < 2) return null;
      return [
        evidence("aggregateFeatures.transferContextCount", transferCount, "gte", 0, "aggregate_features"),
        evidence(
          "aggregateFeatures.seatedPositionContextCount",
          seatedCount,
          "gte",
          0,
          "aggregate_features",
        ),
      ];
    },
  }),

  makeRule({
    ruleCode: "R_LOW_MOVEMENT_INCREASE",
    description: "Wearable or caregiver context suggests increased low movement.",
    weight: 0.18,
    appliesToTemplates: ["SKIN_PRESSURE_AFTER_SEATED_PERIOD", "TRANSFER_DISCOMFORT_TRACKING"],
    evidenceFields: [
      "aggregateFeatures.lowMovementEventCount",
      "aggregateFeatures.wearableLowMovementIncrease",
    ],
    safetyTags: ["no_wound_detection", "structured_observation_only"],
    evaluate: (ctx) => {
      const lowMovementCount = numericFeature(ctx, "lowMovementEventCount");
      const wearableFlag = booleanFeature(ctx, "wearableLowMovementIncrease");
      if (lowMovementCount < 1 && !wearableFlag) return null;
      return [
        evidence(
          "aggregateFeatures.lowMovementEventCount",
          lowMovementCount,
          "gte",
          0,
          "aggregate_features",
        ),
        evidence(
          "aggregateFeatures.wearableLowMovementIncrease",
          wearableFlag,
          "eq",
          true,
          "wearable_summary",
        ),
      ];
    },
  }),

  makeRule({
    ruleCode: "R_SKIN_PRESSURE_FOCUS",
    description: "Care plan contains skin or pressure-area focus.",
    weight: 0.14,
    appliesToTemplates: ["SKIN_PRESSURE_AFTER_SEATED_PERIOD"],
    evidenceFields: ["patient.carePlanFocusCodes"],
    safetyTags: ["no_wound_detection"],
    evaluate: (ctx) => {
      const matched = ctx.patient.carePlanFocusCodes.includes("SKIN_PRESSURE");
      if (!matched) return null;
      return [
        evidence(
          "patient.carePlanFocusCodes",
          "SKIN_PRESSURE",
          "contains",
          "SKIN_PRESSURE",
          "patient_profile",
        ),
      ];
    },
  }),

  makeRule({
    ruleCode: "R_SKIN_OR_PRESSURE_CONCERN_LOGGED",
    description: "Skin or pressure concern was logged by caregiver.",
    weight: 0.24,
    appliesToTemplates: ["SKIN_PRESSURE_AFTER_SEATED_PERIOD"],
    evidenceFields: ["aggregateFeatures.skinPressureEventCount"],
    safetyTags: ["no_wound_detection", "caregiver_reported_only"],
    evaluate: (ctx) => {
      const count = numericFeature(ctx, "skinPressureEventCount");
      if (count < 1) return null;
      return [
        evidence(
          "aggregateFeatures.skinPressureEventCount",
          count,
          "gte",
          1,
          "aggregate_features",
        ),
      ];
    },
  }),

  makeRule({
    ruleCode: "R_BOWEL_BLADDER_FOCUS",
    description: "Care plan contains bowel/bladder focus.",
    weight: 0.14,
    appliesToTemplates: ["BOWEL_ROUTINE_DISCOMFORT_CONTEXT"],
    evidenceFields: ["patient.carePlanFocusCodes"],
    safetyTags: ["no_diagnosis", "structured_observation_only"],
    evaluate: (ctx) => {
      const matched = ctx.patient.carePlanFocusCodes.includes("BOWEL_BLADDER");
      if (!matched) return null;
      return [
        evidence(
          "patient.carePlanFocusCodes",
          "BOWEL_BLADDER",
          "contains",
          "BOWEL_BLADDER",
          "patient_profile",
        ),
      ];
    },
  }),

  makeRule({
    ruleCode: "R_BOWEL_ROUTINE_CHANGE_LOGGED",
    description: "Bowel or bladder routine change was logged.",
    weight: 0.22,
    appliesToTemplates: ["BOWEL_ROUTINE_DISCOMFORT_CONTEXT"],
    evidenceFields: ["aggregateFeatures.bowelBladderEventCount"],
    safetyTags: ["no_diagnosis"],
    evaluate: (ctx) => {
      const count = numericFeature(ctx, "bowelBladderEventCount");
      if (count < 1) return null;
      return [
        evidence(
          "aggregateFeatures.bowelBladderEventCount",
          count,
          "gte",
          1,
          "aggregate_features",
        ),
      ];
    },
  }),

  makeRule({
    ruleCode: "R_APPETITE_HYDRATION_CHANGE_LOGGED",
    description: "Appetite or hydration change was logged.",
    weight: 0.18,
    appliesToTemplates: ["BOWEL_ROUTINE_DISCOMFORT_CONTEXT"],
    evidenceFields: ["aggregateFeatures.appetiteHydrationEventCount"],
    safetyTags: ["no_diagnosis"],
    evaluate: (ctx) => {
      const count = numericFeature(ctx, "appetiteHydrationEventCount");
      if (count < 1) return null;
      return [
        evidence(
          "aggregateFeatures.appetiteHydrationEventCount",
          count,
          "gte",
          1,
          "aggregate_features",
        ),
      ];
    },
  }),

  makeRule({
    ruleCode: "R_BREATHING_FOCUS",
    description: "Care plan contains breathing or oxygen context focus.",
    weight: 0.14,
    appliesToTemplates: ["BREATHING_CONCERN_CONTEXT"],
    evidenceFields: ["patient.carePlanFocusCodes"],
    safetyTags: ["no_respiratory_diagnosis", "emergency_rules_take_priority"],
    evaluate: (ctx) => {
      const matched = ctx.patient.carePlanFocusCodes.includes("BREATHING_CONTEXT");
      if (!matched) return null;
      return [
        evidence(
          "patient.carePlanFocusCodes",
          "BREATHING_CONTEXT",
          "contains",
          "BREATHING_CONTEXT",
          "patient_profile",
        ),
      ];
    },
  }),

  makeRule({
    ruleCode: "R_BREATHING_CONCERN_LOGGED",
    description: "Breathing or color/oxygen concern was logged.",
    weight: 0.26,
    appliesToTemplates: ["BREATHING_CONCERN_CONTEXT"],
    evidenceFields: [
      "aggregateFeatures.breathingConcernEventCount",
      "aggregateFeatures.colorOxygenConcernEventCount",
    ],
    safetyTags: ["no_respiratory_diagnosis", "emergency_rules_take_priority"],
    evaluate: (ctx) => {
      const breathing = numericFeature(ctx, "breathingConcernEventCount");
      const colorOxygen = numericFeature(ctx, "colorOxygenConcernEventCount");
      if (breathing + colorOxygen < 1) return null;
      return [
        evidence(
          "aggregateFeatures.breathingConcernEventCount",
          breathing,
          "gte",
          0,
          "aggregate_features",
        ),
        evidence(
          "aggregateFeatures.colorOxygenConcernEventCount",
          colorOxygen,
          "gte",
          0,
          "aggregate_features",
        ),
      ];
    },
  }),

  makeRule({
    ruleCode: "R_RESPIRATORY_WEARABLE_DELTA",
    description: "Wearable summary flagged respiratory-rate change.",
    weight: 0.16,
    appliesToTemplates: ["BREATHING_CONCERN_CONTEXT"],
    evidenceFields: ["aggregateFeatures.wearableRespiratoryRateDeltaFlag"],
    safetyTags: ["no_diagnosis", "emergency_rules_take_priority"],
    evaluate: (ctx) => {
      const flag = booleanFeature(ctx, "wearableRespiratoryRateDeltaFlag");
      if (!flag) return null;
      return [
        evidence(
          "aggregateFeatures.wearableRespiratoryRateDeltaFlag",
          flag,
          "eq",
          true,
          "wearable_summary",
        ),
      ];
    },
  }),

  makeRule({
    ruleCode: "R_RESPONSIVENESS_FOCUS",
    description: "Care plan contains responsiveness or neuro-observation context.",
    weight: 0.14,
    appliesToTemplates: ["UNUSUAL_RESPONSIVENESS_CONTEXT"],
    evidenceFields: ["patient.carePlanFocusCodes"],
    safetyTags: ["no_neurological_diagnosis"],
    evaluate: (ctx) => {
      const matched = ctx.patient.carePlanFocusCodes.includes("RESPONSIVENESS_CONTEXT");
      if (!matched) return null;
      return [
        evidence(
          "patient.carePlanFocusCodes",
          "RESPONSIVENESS_CONTEXT",
          "contains",
          "RESPONSIVENESS_CONTEXT",
          "patient_profile",
        ),
      ];
    },
  }),

  makeRule({
    ruleCode: "R_UNUSUAL_RESPONSIVENESS_LOGGED",
    description: "Unusual responsiveness was logged.",
    weight: 0.26,
    appliesToTemplates: ["UNUSUAL_RESPONSIVENESS_CONTEXT"],
    evidenceFields: ["aggregateFeatures.unusualResponsivenessEventCount"],
    safetyTags: ["no_neurological_diagnosis"],
    evaluate: (ctx) => {
      const count = numericFeature(ctx, "unusualResponsivenessEventCount");
      if (count < 1) return null;
      return [
        evidence(
          "aggregateFeatures.unusualResponsivenessEventCount",
          count,
          "gte",
          1,
          "aggregate_features",
        ),
      ];
    },
  }),

  makeRule({
    ruleCode: "R_CAREGIVER_REPORTED_SEIZURE_LIKE_EVENT",
    description: "Caregiver reported a seizure-like event. UC4 documents context only.",
    weight: 0.3,
    appliesToTemplates: ["CAREGIVER_REPORTED_SEIZURE_LIKE_EVENT_CONTEXT"],
    evidenceFields: ["aggregateFeatures.seizureLikeReportedEventCount"],
    safetyTags: ["no_seizure_detection", "caregiver_reported_only", "provider_context_only"],
    evaluate: (ctx) => {
      const count = numericFeature(ctx, "seizureLikeReportedEventCount");
      if (count < 1) return null;
      return [
        evidence(
          "aggregateFeatures.seizureLikeReportedEventCount",
          count,
          "gte",
          1,
          "aggregate_features",
        ),
      ];
    },
  }),

  makeRule({
    ruleCode: "R_THERAPY_ROUTINE_DIFFICULTY",
    description: "Therapy or rehab routine difficulty was logged.",
    weight: 0.26,
    appliesToTemplates: ["THERAPY_REHAB_ROUTINE_DIFFICULTY"],
    evidenceFields: ["aggregateFeatures.therapyDifficultyEventCount"],
    safetyTags: ["no_treatment_recommendation", "no_rehab_outcome_claim"],
    evaluate: (ctx) => {
      const count = numericFeature(ctx, "therapyDifficultyEventCount");
      if (count < 1) return null;
      return [
        evidence(
          "aggregateFeatures.therapyDifficultyEventCount",
          count,
          "gte",
          1,
          "aggregate_features",
        ),
      ];
    },
  }),

  makeRule({
    ruleCode: "R_REHAB_FOCUS",
    description: "Care plan contains rehab or therapy focus.",
    weight: 0.16,
    appliesToTemplates: ["THERAPY_REHAB_ROUTINE_DIFFICULTY"],
    evidenceFields: ["patient.carePlanFocusCodes"],
    safetyTags: ["no_treatment_recommendation"],
    evaluate: (ctx) => {
      const matched = ctx.patient.carePlanFocusCodes.includes("REHAB_THERAPY");
      if (!matched) return null;
      return [
        evidence(
          "patient.carePlanFocusCodes",
          "REHAB_THERAPY",
          "contains",
          "REHAB_THERAPY",
          "patient_profile",
        ),
      ];
    },
  }),

  makeRule({
    ruleCode: "R_FALL_OR_NEAR_FALL_LOGGED",
    description: "Fall or near-fall was logged.",
    weight: 0.3,
    appliesToTemplates: ["FALL_OR_NEAR_FALL_CONTEXT"],
    evidenceFields: ["aggregateFeatures.fallNearFallEventCount"],
    safetyTags: ["no_injury_assessment", "provider_context_only"],
    evaluate: (ctx) => {
      const count = numericFeature(ctx, "fallNearFallEventCount");
      if (count < 1) return null;
      return [
        evidence(
          "aggregateFeatures.fallNearFallEventCount",
          count,
          "gte",
          1,
          "aggregate_features",
        ),
      ];
    },
  }),

  makeRule({
    ruleCode: "R_CAREGIVER_PROVIDER_REVIEW_REQUESTED",
    description: "Caregiver requested provider review.",
    weight: 0.32,
    appliesToTemplates: ["CAREGIVER_PROVIDER_REVIEW_REQUEST"],
    evidenceFields: ["aggregateFeatures.providerReviewRequestCount"],
    safetyTags: ["provider_context_only"],
    evaluate: (ctx) => {
      const count = numericFeature(ctx, "providerReviewRequestCount");
      if (count < 1) return null;
      return [
        evidence(
          "aggregateFeatures.providerReviewRequestCount",
          count,
          "gte",
          1,
          "aggregate_features",
        ),
      ];
    },
  }),

  makeRule({
    ruleCode: "R_RECENT_SEVERITY2_OR_PROVIDER_RELEVANT_EVENT",
    description: "Recent UC2 Severity 2 or provider-review-relevant event exists.",
    weight: 0.16,
    appliesToTemplates: [
      "BREATHING_CONCERN_CONTEXT",
      "UNUSUAL_RESPONSIVENESS_CONTEXT",
      "CAREGIVER_PROVIDER_REVIEW_REQUEST",
      "THERAPY_REHAB_ROUTINE_DIFFICULTY",
    ],
    evidenceFields: ["aggregateFeatures.recentSeverity2Event"],
    safetyTags: ["uc2_follow_up_context_only", "does_not_override_emergency"],
    evaluate: (ctx) => {
      const hasSeverity2 = booleanFeature(ctx, "recentSeverity2Event");
      if (!hasSeverity2) return null;
      return [
        evidence(
          "aggregateFeatures.recentSeverity2Event",
          hasSeverity2,
          "eq",
          true,
          "uc1_uc2_context",
        ),
      ];
    },
  }),
];
import {
  ContextCode,
  ObservationCode,
  UC4RunInput,
  UC4RuleContext,
  UC4StructuredEvent,
} from "./uc4Types";

function countEventsWithObservation(
  events: UC4StructuredEvent[],
  code: ObservationCode,
): number {
  return events.filter((event) => event.observationCodes.includes(code)).length;
}

function countEventsWithContext(
  events: UC4StructuredEvent[],
  code: ContextCode,
): number {
  return events.filter((event) => event.contextCodes.includes(code)).length;
}

function hasRecentSeverity2Event(events: UC4StructuredEvent[]): boolean {
  return events.some((event) => event.severity === 2);
}

function hasRecentSeverity3Event(events: UC4StructuredEvent[]): boolean {
  return events.some((event) => event.severity === 3);
}

export function buildUC4RuleContext(input: UC4RunInput): UC4RuleContext {
  const events = input.recentEvents;

  const aggregateFeatures: UC4RuleContext["aggregateFeatures"] = {
    fatigueEventCount: countEventsWithObservation(events, "UNUSUAL_FATIGUE"),
    missedMedicationEventCount: countEventsWithObservation(events, "MISSED_OR_DELAYED_MEDICATION"),
    transferDiscomfortEventCount:
      countEventsWithObservation(events, "TRANSFER_OR_POSITIONING_CONTEXT") +
      countEventsWithObservation(events, "PAIN_OR_DISCOMFORT"),
    transferContextCount: countEventsWithContext(events, "DURING_TRANSFER"),
    seatedPositionContextCount: countEventsWithContext(events, "WHILE_SITTING_OR_POSITIONED"),
    lowMovementEventCount: countEventsWithObservation(events, "LOW_MOVEMENT"),
    skinPressureEventCount: countEventsWithObservation(events, "SKIN_OR_PRESSURE_CONCERN"),
    bowelBladderEventCount: countEventsWithObservation(events, "BOWEL_OR_BLADDER_CHANGE"),
    appetiteHydrationEventCount: countEventsWithObservation(events, "APPETITE_OR_HYDRATION_CHANGE"),
    breathingConcernEventCount: countEventsWithObservation(events, "BREATHING_CONCERN"),
    colorOxygenConcernEventCount: countEventsWithObservation(events, "COLOR_OR_OXYGEN_CONCERN"),
    unusualResponsivenessEventCount: countEventsWithObservation(events, "UNUSUAL_RESPONSIVENESS"),
    seizureLikeReportedEventCount: countEventsWithObservation(events, "SEIZURE_LIKE_EVENT_REPORTED"),
    therapyDifficultyEventCount: countEventsWithObservation(events, "THERAPY_ROUTINE_DIFFICULTY"),
    fallNearFallEventCount: countEventsWithObservation(events, "FALL_OR_NEAR_FALL"),
    providerReviewRequestCount: countEventsWithObservation(events, "CAREGIVER_WANTS_PROVIDER_REVIEW"),
    recentSeverity2Event: hasRecentSeverity2Event(events),
    recentSeverity3Event: hasRecentSeverity3Event(events),
    wearableLowMovementIncrease: input.wearableSummary?.lowMovementIncrease ?? false,
    wearableRespiratoryRateDeltaFlag: input.wearableSummary?.respiratoryRateDeltaFlag ?? false,
    wearableSleepDisruptionFlag: input.wearableSummary?.sleepDisruptionFlag ?? false,
    previousPriorityCount: input.previousPriorities.length,
  };

  return {
    patient: input.patient,
    medications: input.medications,
    recentEvents: input.recentEvents,
    wearableSummary: input.wearableSummary,
    previousPriorities: input.previousPriorities,
    uc1ActiveEmergency: input.uc1ActiveEmergency,
    currentSeverityContext: input.currentSeverityContext,
    aggregateFeatures,
  };
}
import { UC4Template } from "./uc4Types";
import { UC4_OPTION_SETS } from "./uc4OptionSets";

export const UC4_TEMPLATE_REGISTRY: UC4Template[] = [
  {
    templateId: "MEDICATION_WINDOW_FATIGUE_TRACKING",
    titleTemplate: "Track fatigue around medication timing",
    bodyTemplate:
      "{{patientName}} has repeated fatigue-related logs, and the medication profile includes known watch areas where timing context may be useful to track. This does not mean a medication caused the fatigue.",
    priorityKind: "recurring_concern",
    domain: "medication_timing_context",
    safetyBoundary:
      "Medication-aware context only. Does not infer medication causality or recommend medication changes.",
    allowedObservationCodes: ["UNUSUAL_FATIGUE", "MISSED_OR_DELAYED_MEDICATION", "NOT_SURE"],
    allowedContextCodes: ["AROUND_MEDICATION_TIME", "DURING_SLEEP_OR_NIGHT", "UNKNOWN_OR_NOT_SURE"],
    whatToLogNextSchema: [
      {
        fieldId: "fatigue_present",
        label: "Did fatigue seem unusual today?",
        type: "single_select",
        required: true,
        options: UC4_OPTION_SETS.yesNoNotSure,
        usedForScoring: true,
      },
      {
        fieldId: "timing_context",
        label: "When did it seem most noticeable?",
        type: "single_select",
        required: true,
        options: UC4_OPTION_SETS.fatigueTiming,
        usedForScoring: true,
      },
    ],
  },

  {
    templateId: "MISSED_DELAYED_MEDICATION_CONTEXT",
    titleTemplate: "Log missed or delayed medication context",
    bodyTemplate:
      "A missed or delayed medication was logged recently. Track timing and what was happening around it so the care team has clean context.",
    priorityKind: "provider_review_support",
    domain: "medication_adherence_context",
    safetyBoundary:
      "Does not advise changing dose, timing, or medication. Captures structured context only.",
    allowedObservationCodes: ["MISSED_OR_DELAYED_MEDICATION", "NOT_SURE"],
    allowedContextCodes: ["AROUND_MEDICATION_TIME", "UNKNOWN_OR_NOT_SURE"],
    whatToLogNextSchema: [
      {
        fieldId: "missed_or_delayed",
        label: "Was a dose missed or delayed?",
        type: "single_select",
        required: true,
        options: UC4_OPTION_SETS.yesNoNotSure,
        usedForScoring: true,
      },
      {
        fieldId: "caregiver_note_provider_context",
        label: "Optional note for provider context",
        type: "short_text_provider_context",
        required: false,
        usedForScoring: false,
      },
    ],
  },

  {
    templateId: "TRANSFER_DISCOMFORT_TRACKING",
    titleTemplate: "Watch discomfort during transfers or positioning",
    bodyTemplate:
      "{{patientName}} has recent discomfort or transfer-related context. Track when it appears so the care team can review the pattern.",
    priorityKind: "recurring_concern",
    domain: "mobility_positioning",
    safetyBoundary:
      "Observation support only. Does not assess tone, spasticity, injury, or prescribe therapy changes.",
    allowedObservationCodes: [
      "TRANSFER_OR_POSITIONING_CONTEXT",
      "PAIN_OR_DISCOMFORT",
      "LOW_MOVEMENT",
      "NOT_SURE",
    ],
    allowedContextCodes: ["DURING_TRANSFER", "WHILE_SITTING_OR_POSITIONED", "UNKNOWN_OR_NOT_SURE"],
    whatToLogNextSchema: [
      {
        fieldId: "discomfort_seen",
        label: "Did discomfort appear during transfer or positioning?",
        type: "single_select",
        required: true,
        options: UC4_OPTION_SETS.yesNoNotSure,
        usedForScoring: true,
      },
      {
        fieldId: "transfer_context",
        label: "Where was it most noticeable?",
        type: "single_select",
        required: true,
        options: UC4_OPTION_SETS.transferDiscomfortContext,
        usedForScoring: true,
      },
    ],
  },

  {
    templateId: "SKIN_PRESSURE_AFTER_SEATED_PERIOD",
    titleTemplate: "Add a skin/pressure check after long seated periods",
    bodyTemplate:
      "Recent context suggests skin or pressure-area checks may be worth tracking after seated or low-movement periods.",
    priorityKind: "blind_spot",
    domain: "skin_pressure_prevention_context",
    safetyBoundary:
      "Does not detect wounds or diagnose skin breakdown. Prompts structured observation only.",
    allowedObservationCodes: ["SKIN_OR_PRESSURE_CONCERN", "LOW_MOVEMENT", "NOT_SURE"],
    allowedContextCodes: ["WHILE_SITTING_OR_POSITIONED", "UNKNOWN_OR_NOT_SURE"],
    whatToLogNextSchema: [
      {
        fieldId: "skin_pressure_concern_seen",
        label: "Any skin or pressure concern noticed?",
        type: "single_select",
        required: true,
        options: UC4_OPTION_SETS.yesNoNotSure,
        usedForScoring: true,
      },
    ],
  },

  {
    templateId: "BOWEL_ROUTINE_DISCOMFORT_CONTEXT",
    titleTemplate: "Track bowel/bladder routine with discomfort context",
    bodyTemplate:
      "Bowel, bladder, appetite, hydration, or discomfort context has appeared recently. A structured log may help the provider see the pattern.",
    priorityKind: "emerging_pattern",
    domain: "bowel_bladder_hydration_context",
    safetyBoundary:
      "Observation support only. Does not diagnose bowel/bladder condition or recommend treatment.",
    allowedObservationCodes: [
      "BOWEL_OR_BLADDER_CHANGE",
      "APPETITE_OR_HYDRATION_CHANGE",
      "PAIN_OR_DISCOMFORT",
      "NOT_SURE",
    ],
    allowedContextCodes: [
      "BATHROOM_OR_BOWEL_BLADDER",
      "MEAL_OR_HYDRATION_RELATED",
      "UNKNOWN_OR_NOT_SURE",
    ],
    whatToLogNextSchema: [
      {
        fieldId: "bowel_bladder_change_seen",
        label: "Any bowel or bladder routine change?",
        type: "single_select",
        required: true,
        options: UC4_OPTION_SETS.yesNoNotSure,
        usedForScoring: true,
      },
      {
        fieldId: "hydration_or_appetite_change",
        label: "Any appetite or hydration change?",
        type: "single_select",
        required: false,
        options: UC4_OPTION_SETS.yesNoNotSure,
        usedForScoring: true,
      },
    ],
  },

  {
    templateId: "BREATHING_CONCERN_CONTEXT",
    titleTemplate: "Track breathing concern context",
    bodyTemplate:
      "Recent logs or wearable summaries suggest breathing-related context may be useful to track. Emergency rules still take priority for critical vital thresholds.",
    priorityKind: "provider_review_support",
    domain: "breathing_context",
    safetyBoundary:
      "Does not diagnose respiratory distress. Critical vitals must route through UC1/UC2 emergency rules.",
    allowedObservationCodes: ["BREATHING_CONCERN", "COLOR_OR_OXYGEN_CONCERN", "NOT_SURE"],
    allowedContextCodes: [
      "DURING_SLEEP_OR_NIGHT",
      "AFTER_ACTIVITY_OR_THERAPY",
      "WHILE_SITTING_OR_POSITIONED",
      "UNKNOWN_OR_NOT_SURE",
    ],
    whatToLogNextSchema: [
      {
        fieldId: "breathing_concern_seen",
        label: "Any breathing concern noticed?",
        type: "single_select",
        required: true,
        options: UC4_OPTION_SETS.yesNoNotSure,
        usedForScoring: true,
      },
      {
        fieldId: "breathing_context",
        label: "When was it noticed?",
        type: "single_select",
        required: true,
        options: UC4_OPTION_SETS.breathingContext,
        usedForScoring: true,
      },
    ],
  },

  {
    templateId: "UNUSUAL_RESPONSIVENESS_CONTEXT",
    titleTemplate: "Log unusual responsiveness context",
    bodyTemplate:
      "Unusual responsiveness was logged recently. Capture structured context for provider review if the pattern continues.",
    priorityKind: "provider_review_support",
    domain: "responsiveness_context",
    safetyBoundary:
      "Observation support only. Does not diagnose neurological status or emergency condition.",
    allowedObservationCodes: ["UNUSUAL_RESPONSIVENESS", "NOT_SURE"],
    allowedContextCodes: ["DURING_SLEEP_OR_NIGHT", "UNKNOWN_OR_NOT_SURE"],
    whatToLogNextSchema: [
      {
        fieldId: "unusual_responsiveness_seen",
        label: "Was unusual responsiveness noticed again?",
        type: "single_select",
        required: true,
        options: UC4_OPTION_SETS.yesNoNotSure,
        usedForScoring: true,
      },
    ],
  },

  {
    templateId: "CAREGIVER_REPORTED_SEIZURE_LIKE_EVENT_CONTEXT",
    titleTemplate: "Document caregiver-reported seizure-like event context",
    bodyTemplate:
      "A caregiver-reported seizure-like event was logged. UC4 only helps document context for provider review.",
    priorityKind: "provider_review_support",
    domain: "caregiver_reported_event_context",
    safetyBoundary:
      "Does not detect, classify, or diagnose seizures. Documents caregiver-reported context only.",
    allowedObservationCodes: ["SEIZURE_LIKE_EVENT_REPORTED", "NOT_SURE"],
    allowedContextCodes: ["UNKNOWN_OR_NOT_SURE", "DURING_SLEEP_OR_NIGHT"],
    whatToLogNextSchema: [
      {
        fieldId: "provider_review_wanted",
        label: "Would you like this included in a provider summary?",
        type: "single_select",
        required: true,
        options: UC4_OPTION_SETS.providerReviewIntent,
        usedForScoring: true,
      },
    ],
  },

  {
    templateId: "THERAPY_REHAB_ROUTINE_DIFFICULTY",
    titleTemplate: "Track rehab or therapy routine difficulty",
    bodyTemplate:
      "{{patientName}} has care-plan focus around therapy or rehab. Recent logs suggest it may help to track when the routine is difficult.",
    priorityKind: "emerging_pattern",
    domain: "rehab_therapy_context",
    safetyBoundary:
      "Does not prescribe therapy changes or assess recovery status. Captures structured context only.",
    allowedObservationCodes: ["THERAPY_ROUTINE_DIFFICULTY", "PAIN_OR_DISCOMFORT", "NOT_SURE"],
    allowedContextCodes: ["AFTER_ACTIVITY_OR_THERAPY", "UNKNOWN_OR_NOT_SURE"],
    whatToLogNextSchema: [
      {
        fieldId: "therapy_difficulty_seen",
        label: "Was the therapy routine difficult today?",
        type: "single_select",
        required: true,
        options: UC4_OPTION_SETS.yesNoNotSure,
        usedForScoring: true,
      },
    ],
  },

  {
    templateId: "FALL_OR_NEAR_FALL_CONTEXT",
    titleTemplate: "Document fall or near-fall context",
    bodyTemplate:
      "A fall or near-fall was logged. Structured context may help the provider understand when and where it happened.",
    priorityKind: "provider_review_support",
    domain: "fall_context",
    safetyBoundary:
      "Does not assess injury or replace emergency care. Documents caregiver-reported context only.",
    allowedObservationCodes: ["FALL_OR_NEAR_FALL", "NOT_SURE"],
    allowedContextCodes: [
      "DURING_TRANSFER",
      "WHILE_SITTING_OR_POSITIONED",
      "AFTER_ACTIVITY_OR_THERAPY",
      "UNKNOWN_OR_NOT_SURE",
    ],
    whatToLogNextSchema: [
      {
        fieldId: "fall_or_near_fall_seen",
        label: "Was there a fall or near-fall?",
        type: "single_select",
        required: true,
        options: UC4_OPTION_SETS.yesNoNotSure,
        usedForScoring: true,
      },
    ],
  },

  {
    templateId: "CAREGIVER_PROVIDER_REVIEW_REQUEST",
    titleTemplate: "Prepare structured provider-review summary",
    bodyTemplate:
      "The caregiver requested provider review. UC4 can organize recent structured context into a provider-ready summary.",
    priorityKind: "provider_review_support",
    domain: "provider_review",
    safetyBoundary:
      "Summarizes structured observations only. Does not diagnose or recommend treatment.",
    allowedObservationCodes: ["CAREGIVER_WANTS_PROVIDER_REVIEW", "NOT_SURE"],
    allowedContextCodes: ["UNKNOWN_OR_NOT_SURE"],
    whatToLogNextSchema: [
      {
        fieldId: "provider_review_requested",
        label: "Include this pattern in provider summary?",
        type: "single_select",
        required: true,
        options: UC4_OPTION_SETS.providerReviewIntent,
        usedForScoring: true,
      },
    ],
  },
];

export function getTemplateById(templateId: string): UC4Template | undefined {
  return UC4_TEMPLATE_REGISTRY.find((template) => template.templateId === templateId);
}
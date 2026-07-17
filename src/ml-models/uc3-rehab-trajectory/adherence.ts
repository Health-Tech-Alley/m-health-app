import { DailyRehabLog } from "./types";

export interface AdherenceDerivationInput {
  overwriteExisting?: boolean;
  exerciseCompletionWeight?: number;
  minutesCompletionWeight?: number;
  excuseMedicallySkippedDays?: boolean;
}

export interface AdherenceDerivationResult {
  log: DailyRehabLog;
  adherence: number;
  source: "existing_app_value" | "derived_from_daily_log" | "missing";
  components: {
    exerciseCompletionRatio?: number;
    minutesCompletionRatio?: number;
    sessionCompletedCredit?: number;
    medicallyExcused?: boolean;
  };
  reasonCodes: string[];
}

const DEFAULT_OPTIONS: Required<AdherenceDerivationInput> = {
  overwriteExisting: false,
  exerciseCompletionWeight: 0.7,
  minutesCompletionWeight: 0.3,
  excuseMedicallySkippedDays: true,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function safeRatio(numerator?: number, denominator?: number): number | undefined {
  if (
    numerator === undefined ||
    denominator === undefined ||
    denominator <= 0 ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator)
  ) {
    return undefined;
  }

  return clamp01(numerator / denominator);
}

function isMedicallyExcused(log: DailyRehabLog): boolean {
  const skippedReason = log.skippedReason?.toLowerCase() ?? "";
  const symptoms = log.symptoms?.map((s) => s.toLowerCase()) ?? [];

  const medicallyExcusedKeywords = [
    "fever",
    "vomiting",
    "chest pain",
    "shortness of breath",
    "severe pain",
    "fall",
    "injury",
    "clinician told us to stop",
    "doctor told us to stop",
    "nurse told us to stop",
    "urgent",
    "emergency",
  ];

  return medicallyExcusedKeywords.some((keyword) => {
    return (
      skippedReason.includes(keyword) ||
      symptoms.some((symptom) => symptom.includes(keyword))
    );
  });
}

export function deriveAdherenceFromDailyLog(
  log: DailyRehabLog,
  options: AdherenceDerivationInput = {},
): AdherenceDerivationResult {
  const config = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  const reasonCodes: string[] = [];

  if (
    log.adherence !== undefined &&
    log.adherence !== null &&
    Number.isFinite(log.adherence) &&
    !config.overwriteExisting
  ) {
    return {
      log: {
        ...log,
        adherence: clamp01(log.adherence),
        adherenceSource: "existing_app_value",
      },
      adherence: clamp01(log.adherence),
      source: "existing_app_value",
      components: {},
      reasonCodes: ["EXISTING_APP_ADHERENCE_USED"],
    };
  }

  const medicallyExcused = isMedicallyExcused(log);

  if (medicallyExcused && config.excuseMedicallySkippedDays) {
    return {
      log: {
        ...log,
        adherence: 1.0,
        adherenceSource: "derived_from_daily_log",
        adherenceDerivationNote:
          "Day was medically excused and was not counted as non-adherence.",
      },
      adherence: 1.0,
      source: "derived_from_daily_log",
      components: {
        medicallyExcused: true,
      },
      reasonCodes: ["MEDICALLY_EXCUSED_SKIP"],
    };
  }

  const exerciseCompletionRatio = safeRatio(
    log.exercisesCompleted,
    log.exercisesAssigned,
  );

  const minutesCompletionRatio = safeRatio(
    log.therapyMinutesCompleted,
    log.therapyMinutesPlanned,
  );

  let sessionCompletedCredit: number | undefined;

  if (log.sessionCompleted !== undefined) {
    sessionCompletedCredit = log.sessionCompleted ? 1.0 : 0.0;
  }

  let weightedNumerator = 0;
  let totalWeight = 0;

  if (exerciseCompletionRatio !== undefined) {
    weightedNumerator +=
      exerciseCompletionRatio * config.exerciseCompletionWeight;
    totalWeight += config.exerciseCompletionWeight;
    reasonCodes.push("EXERCISE_COMPLETION_USED");
  }

  if (minutesCompletionRatio !== undefined) {
    weightedNumerator +=
      minutesCompletionRatio * config.minutesCompletionWeight;
    totalWeight += config.minutesCompletionWeight;
    reasonCodes.push("THERAPY_MINUTES_USED");
  }

  if (totalWeight === 0 && sessionCompletedCredit !== undefined) {
    weightedNumerator = sessionCompletedCredit;
    totalWeight = 1;
    reasonCodes.push("SESSION_COMPLETED_FALLBACK_USED");
  }

  if (totalWeight === 0) {
    return {
      log: {
        ...log,
        adherence: undefined,
        adherenceSource: "missing",
        adherenceDerivationNote:
          "Could not derive adherence because completion fields were missing.",
      },
      adherence: 0,
      source: "missing",
      components: {
        exerciseCompletionRatio,
        minutesCompletionRatio,
        sessionCompletedCredit,
        medicallyExcused: false,
      },
      reasonCodes: ["ADHERENCE_INPUTS_MISSING"],
    };
  }

  const adherence = clamp01(weightedNumerator / totalWeight);

  return {
    log: {
      ...log,
      adherence,
      adherenceSource: "derived_from_daily_log",
    },
    adherence,
    source: "derived_from_daily_log",
    components: {
      exerciseCompletionRatio,
      minutesCompletionRatio,
      sessionCompletedCredit,
      medicallyExcused: false,
    },
    reasonCodes,
  };
}

export function deriveAdherenceForLogs(
  logs: DailyRehabLog[],
  options: AdherenceDerivationInput = {},
): {
  logs: DailyRehabLog[];
  derivationResults: AdherenceDerivationResult[];
} {
  const derivationResults = logs.map((log) =>
    deriveAdherenceFromDailyLog(log, options),
  );

  return {
    logs: derivationResults.map((result) => result.log),
    derivationResults,
  };
}

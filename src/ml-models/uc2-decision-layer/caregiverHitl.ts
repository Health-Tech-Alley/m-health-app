import type {
    CaregiverHitlInput,
    CaregiverHitlResult,
    CaregiverObservationCode,
    SensorAnomalyType,
    Severity,
} from "./uc2Types";
import { evaluateCaregiverObservationMatrix } from "./caregiverHitlMatrix";
import { CAREGIVER_CODE_ALIASES } from "./uc2Constants";

// @compat Old function preserved
export function buildCaregiverPrompt(
    patientName: string,
    contextualType: string
): string {
    const readableContext = contextualType
        .toLowerCase()
        .split("_")
        .join(" ");

    return `${patientName}'s recent health pattern looks different than usual. We noticed a ${readableContext} pattern. Was anything unusual happening around this time? Select all that apply.`;
}

// @compat Old function preserved
export function shouldShowCaregiverPrompt(params: {
    emergency: boolean;
    isAnomaly: boolean;
}): boolean {
    const { emergency, isAnomaly } = params;

    if (emergency) return false;

    return isAnomaly;
}

// @compat Remaps old codes to new canonical ones
export function normalizeCaregiverCodes(codes: string[]): CaregiverObservationCode[] {
    return codes.map(code => {
        if (CAREGIVER_CODE_ALIASES[code]) {
            return CAREGIVER_CODE_ALIASES[code];
        }
        return code as CaregiverObservationCode;
    });
}

// New in v2
export function evaluateCaregiverHitl(
    input: CaregiverHitlInput | undefined,
    sensorType: SensorAnomalyType,
    preHitlSeverity: Severity
): CaregiverHitlResult {
    if (!input || input.selected_codes.length === 0) {
        return {
            caregiver_selected_codes: [],
            observation_severity_floor: 0,
            observation_reasons: [],
            data_quality_warning: false,
            human_context: "not_provided",
            anomaly_family: undefined,
            max_matrix_delta: 0,
            critical_route_triggered: false,
            critical_route_reasons: [],
        };
    }

    const codes = normalizeCaregiverCodes(input.selected_codes);
    const matrix = evaluateCaregiverObservationMatrix({
        selected_codes: codes,
        sensor_anomaly_type: sensorType,
    });

    const dataQualityWarning = codes.includes("SENSOR_OR_WATCH_ISSUE");

    let observationSeverityFloor: Severity;

    if (matrix.critical_route_triggered) {
        observationSeverityFloor = 3;
    } else {
        observationSeverityFloor = Math.min(
            2,
            preHitlSeverity + matrix.max_matrix_delta
        ) as Severity;
    }

    if (
        codes.includes("NOTHING_UNUSUAL_NOTICED") &&
        matrix.max_matrix_delta === 0 &&
        !matrix.critical_route_triggered
    ) {
        observationSeverityFloor = Math.max(0, preHitlSeverity) as Severity;
    }

    if (
        dataQualityWarning &&
        matrix.max_matrix_delta === 0 &&
        !matrix.critical_route_triggered
    ) {
        observationSeverityFloor = Math.max(0, preHitlSeverity) as Severity;
    }

    return {
        caregiver_selected_codes: codes,
        observation_severity_floor: observationSeverityFloor,
        observation_reasons: matrix.matrix_reasons,
        data_quality_warning: dataQualityWarning,
        human_context: inferHumanContext(codes, dataQualityWarning),
        anomaly_family: matrix.anomaly_family,
        max_matrix_delta: matrix.max_matrix_delta,
        critical_route_triggered: matrix.critical_route_triggered,
        critical_route_reasons: matrix.critical_route_reasons,
    };
}

function inferHumanContext(
    codes: CaregiverObservationCode[],
    dataQualityWarning: boolean
): CaregiverHitlResult["human_context"] {
    if (dataQualityWarning) return "sensor_issue";
    if (codes.includes("NOTHING_UNUSUAL_NOTICED")) return "no_observed_concern";
    if (codes.includes("NOT_SURE")) return "not_sure";
    return "caregiver_concern";
}

import { runUC2DecisionLayerV2 as runUC2DecisionLayer, ScalerParams } from "../";
import { evaluateCaregiverObservationMatrix } from "../caregiverHitlMatrix";

import {
    fixtureNormalRaw,
    fixtureNormalProfile,
} from "./fixtures/fixture_normal";

import {
    fixtureSlowPathGiRaw,
    fixtureSlowPathGiProfile,
    fixtureSlowPathGiCaregiver,
} from "./fixtures/fixture_slow_path_gi";

import {
    fixtureRespiratoryRaw,
    fixtureRespiratoryProfile,
    fixtureRespiratoryCaregiver,
} from "./fixtures/fixture_respiratory_followup";

import {
    fixtureEmergencyRaw,
    fixtureEmergencyProfile,
} from "./fixtures/fixture_emergency_fast_path";

import {
    fixtureSensorIssueRaw,
    fixtureSensorIssueProfile,
    fixtureSensorIssueCaregiver,
} from "./fixtures/fixture_sensor_issue";

import {
    fixtureRecurrenceRaw,
    fixtureRecurrenceProfile,
    fixtureRecurrenceCaregiver,
    fixtureRecurrenceHistory,
} from "./fixtures/fixture_recurrence_escalation";

import {
    fixtureEhrBaselineRaw,
    fixtureEhrBaselineProfile,
    fixtureEhrBaselineCaregiver,
} from "./fixtures/fixture_ehr_baseline_threshold";

import {
    fixtureMatrixBreathingRespRaw,
    fixtureMatrixBreathingRespProfile,
    fixtureMatrixBreathingRespCaregiver,
} from "./fixtures/fixture_matrix_breathing_resp";

import {
    fixtureMatrixVomitingGiRaw,
    fixtureMatrixVomitingGiProfile,
    fixtureMatrixVomitingGiCaregiver,
} from "./fixtures/fixture_matrix_vomiting_gi";

import {
    fixtureMatrixWeakConfusedSeizureRaw,
    fixtureMatrixWeakConfusedSeizureProfile,
    fixtureMatrixWeakConfusedSeizureCaregiver,
} from "./fixtures/fixture_matrix_weak_confused_seizure_like";

const mockScaler: ScalerParams = {
    mean: new Array(12).fill(0),
    scale: new Array(12).fill(1),
};

type Uc2Result = Awaited<ReturnType<typeof runUC2DecisionLayer>>;

const results: Record<string, Uc2Result> = {};

beforeAll(async () => {
    const runs: [string, Parameters<typeof runUC2DecisionLayer>[0]][] = [
        ["normal", { raw: fixtureNormalRaw, profile: fixtureNormalProfile, scaler: mockScaler }],
        ["gi", { raw: fixtureSlowPathGiRaw, profile: fixtureSlowPathGiProfile, caregiverInput: fixtureSlowPathGiCaregiver, scaler: mockScaler }],
        ["respiratory", { raw: fixtureRespiratoryRaw, profile: fixtureRespiratoryProfile, caregiverInput: fixtureRespiratoryCaregiver, scaler: mockScaler }],
        ["emergency", { raw: fixtureEmergencyRaw, profile: fixtureEmergencyProfile, scaler: mockScaler }],
        ["sensorIssue", { raw: fixtureSensorIssueRaw, profile: fixtureSensorIssueProfile, caregiverInput: fixtureSensorIssueCaregiver, scaler: mockScaler }],
        ["recurrence", { raw: fixtureRecurrenceRaw, profile: fixtureRecurrenceProfile, caregiverInput: fixtureRecurrenceCaregiver, history: fixtureRecurrenceHistory, scaler: mockScaler }],
        ["ehrBaseline", { raw: fixtureEhrBaselineRaw, profile: fixtureEhrBaselineProfile, caregiverInput: fixtureEhrBaselineCaregiver, scaler: mockScaler }],
        ["breathingResp", { raw: fixtureMatrixBreathingRespRaw, profile: fixtureMatrixBreathingRespProfile, caregiverInput: fixtureMatrixBreathingRespCaregiver, scaler: mockScaler }],
        ["vomitingGi", { raw: fixtureMatrixVomitingGiRaw, profile: fixtureMatrixVomitingGiProfile, caregiverInput: fixtureMatrixVomitingGiCaregiver, scaler: mockScaler }],
        ["weakConfusedSeizure", { raw: fixtureMatrixWeakConfusedSeizureRaw, profile: fixtureMatrixWeakConfusedSeizureProfile, caregiverInput: fixtureMatrixWeakConfusedSeizureCaregiver, scaler: mockScaler }],
    ];
    for (const [key, input] of runs) {
        results[key] = await runUC2DecisionLayer(input);
    }
});

describe("UC2 decision layer v2 — emergency fast path", () => {
    it("triggers the hard rule and bypasses AE + payloads", () => {
        const emergency = results.emergency;
        expect(emergency.emergency.is_emergency).toBe(true);
        expect(emergency.ae).toBeNull();
        expect(emergency.initial_mcp_payload).toBeNull();
        expect(emergency.final_slm_payload).toBeNull();
        expect(emergency.final_decision.final_notification_type).toBe(
            "CRITICAL_EMERGENCY_ALERT",
        );
    });

    it("keeps EHR thresholds from suppressing emergency severity", () => {
        expect(results.emergency.final_decision.post_hitl_severity).toBe(3);
    });
});

describe("UC2 decision layer v2 — severity behavior", () => {
    it("never decreases post-HITL severity", () => {
        for (const key of ["normal", "gi", "respiratory", "sensorIssue", "recurrence", "ehrBaseline"]) {
            const result = results[key];
            const pre = result.sensor_classification?.pre_hitl_severity ?? 0;
            const post = result.final_decision.post_hitl_severity!;
            expect(post).toBeGreaterThanOrEqual(pre);
        }
    });

    it("escalates caregiver GI observations to provider follow-up", () => {
        const gi = results.gi;
        expect(gi.final_decision.post_hitl_severity!).toBeGreaterThanOrEqual(2);
        expect(gi.final_slm_payload).not.toBeNull();
    });

    it("routes respiratory caregiver concern as respiratory concern", () => {
        expect(results.respiratory.final_decision.post_hitl_anomaly_type).toBe(
            "RESPIRATORY_CONCERN",
        );
    });

    it("flags sensor issue with a data-quality warning and no unsafe downgrade", () => {
        const sensorIssue = results.sensorIssue;
        expect(sensorIssue.caregiver_hitl?.data_quality_warning).toBe(true);
        expect(sensorIssue.final_decision.post_hitl_severity!).toBeGreaterThanOrEqual(
            sensorIssue.sensor_classification?.pre_hitl_severity ?? 0,
        );
    });

    it("caps recurrence non-emergency escalation at Severity 2", () => {
        const recurrence = results.recurrence;
        expect(recurrence.recurrence!.recurrence_severity_floor).toBeLessThanOrEqual(2);
        expect(recurrence.final_decision.post_hitl_severity!).toBeLessThanOrEqual(2);
    });

    it("raises the severity floor with EHR personalized thresholds", () => {
        expect(
            results.ehrBaseline.personalized_thresholds!
                .personalized_threshold_severity_floor,
        ).toBeGreaterThanOrEqual(2);
    });
});

describe("UC2 decision layer v2 — SLM payload", () => {
    it("includes recurrence and personalized-threshold fields", () => {
        const payload = results.gi.final_slm_payload;
        expect(payload).not.toBeNull();
        expect(typeof payload!.baseline_deviation_score).toBe("number");
        expect(typeof payload!.recurrence_risk_score).toBe("number");
        expect(typeof payload!.same_class_count).toBe("number");
        expect(typeof payload!.related_class_count).toBe("number");
    });
});

describe("UC2 decision layer v2 — caregiver observation matrix", () => {
    it("BREATHING_DIFFERENT + CARDIO_RESPIRATORY produces matrix delta +3", () => {
        expect(results.breathingResp.caregiver_hitl?.max_matrix_delta).toBe(3);
    });

    it("VOMITING_OR_DIARRHEA fixture classifies cardio-respiratory and produces matrix delta +1", () => {
        // The fixture's extreme vitals (BP 180/120, temp 103, glucose 200)
        // dominate the AE contributors, so its anomaly family is
        // CARDIO_RESPIRATORY — the VOMITING_OR_DIARRHEA row of the matrix
        // gives delta +1 there, not the +3 of the GI_AUTONOMIC family.
        expect(results.vomitingGi.caregiver_hitl?.anomaly_family).toBe(
            "CARDIO_RESPIRATORY",
        );
        expect(results.vomitingGi.caregiver_hitl?.max_matrix_delta).toBe(1);
    });

    it("VOMITING_OR_DIARRHEA + GI_AUTONOMIC matrix row produces delta +3", () => {
        // Direct matrix check for the GI_AUTONOMIC row (not reachable from the
        // cardio-dominant fixture above).
        const evaluation = evaluateCaregiverObservationMatrix({
            selected_codes: ["VOMITING_OR_DIARRHEA"],
            sensor_anomaly_type: "UNEXPLAINED_PHYSIOLOGIC_STRESS",
        });
        expect(evaluation.anomaly_family).toBe("GI_AUTONOMIC");
        expect(evaluation.max_matrix_delta).toBe(3);
    });

    it("WEAK_CONFUSED fixture classifies cardio-respiratory and produces matrix delta +2", () => {
        // The fixture's vitals (HR 122 vs baseline 72) dominate the AE
        // contributors, so its anomaly family is CARDIO_RESPIRATORY — the
        // WEAK_CONFUSED row of the matrix gives delta +2 there, not +3.
        expect(results.weakConfusedSeizure.caregiver_hitl?.anomaly_family).toBe(
            "CARDIO_RESPIRATORY",
        );
        expect(results.weakConfusedSeizure.caregiver_hitl?.max_matrix_delta).toBe(2);
    });

    it("WEAK_CONFUSED_NOT_BASELINE + SEIZURE_LIKE matrix row produces delta +3", () => {
        // Direct matrix check for the SEIZURE_LIKE row (not reachable from the
        // cardio-dominant fixture above).
        const evaluation = evaluateCaregiverObservationMatrix({
            selected_codes: ["WEAK_CONFUSED_NOT_BASELINE"],
            sensor_anomaly_type: "POSSIBLE_SEIZURE_LIKE_MOTION",
        });
        expect(evaluation.anomaly_family).toBe("SEIZURE_LIKE");
        expect(evaluation.max_matrix_delta).toBe(3);
    });
});

declare const process: any;

import { runUC2DecisionLayerV2 as runUC2DecisionLayer, ScalerParams } from "../";

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
    mean: new Array(18).fill(0),
    scale: new Array(18).fill(1),
};

function assert(condition: any, message: string) {
    if (!condition) {
        throw new Error(`Validation failed: ${message}`);
    }
}

async function main() {
    const normal = await runUC2DecisionLayer({
        raw: fixtureNormalRaw,
        profile: fixtureNormalProfile,
        scaler: mockScaler,
    });

    const gi = await runUC2DecisionLayer({
        raw: fixtureSlowPathGiRaw,
        profile: fixtureSlowPathGiProfile,
        caregiverInput: fixtureSlowPathGiCaregiver,
        scaler: mockScaler,
    });

    const respiratory = await runUC2DecisionLayer({
        raw: fixtureRespiratoryRaw,
        profile: fixtureRespiratoryProfile,
        caregiverInput: fixtureRespiratoryCaregiver,
        scaler: mockScaler,
    });

    const emergency = await runUC2DecisionLayer({
        raw: fixtureEmergencyRaw,
        profile: fixtureEmergencyProfile,
        scaler: mockScaler,
    });

    const sensorIssue = await runUC2DecisionLayer({
        raw: fixtureSensorIssueRaw,
        profile: fixtureSensorIssueProfile,
        caregiverInput: fixtureSensorIssueCaregiver,
        scaler: mockScaler,
    });

    const recurrence = await runUC2DecisionLayer({
        raw: fixtureRecurrenceRaw,
        profile: fixtureRecurrenceProfile,
        caregiverInput: fixtureRecurrenceCaregiver,
        history: fixtureRecurrenceHistory,
        scaler: mockScaler,
    });

    const ehrBaseline = await runUC2DecisionLayer({
        raw: fixtureEhrBaselineRaw,
        profile: fixtureEhrBaselineProfile,
        caregiverInput: fixtureEhrBaselineCaregiver,
        scaler: mockScaler,
    });

    const breathingResp = await runUC2DecisionLayer({
        raw: fixtureMatrixBreathingRespRaw,
        profile: fixtureMatrixBreathingRespProfile,
        caregiverInput: fixtureMatrixBreathingRespCaregiver,
        scaler: mockScaler,
    });

    const vomitingGi = await runUC2DecisionLayer({
        raw: fixtureMatrixVomitingGiRaw,
        profile: fixtureMatrixVomitingGiProfile,
        caregiverInput: fixtureMatrixVomitingGiCaregiver,
        scaler: mockScaler,
    });

    const weakConfusedSeizure = await runUC2DecisionLayer({
        raw: fixtureMatrixWeakConfusedSeizureRaw,
        profile: fixtureMatrixWeakConfusedSeizureProfile,
        caregiverInput: fixtureMatrixWeakConfusedSeizureCaregiver,
        scaler: mockScaler,
    });

    // 1. Emergency fast path has no AE score.
    assert(emergency.emergency.is_emergency, "Emergency fixture should trigger hard rule.");
    assert(emergency.ae === null, "Emergency fast path must not run AE.");
    assert(
        emergency.initial_mcp_payload === null,
        "Emergency fast path must not build initial MCP payload."
    );
    assert(
        emergency.final_slm_payload === null,
        "Emergency fast path must not build SLM payload initially."
    );
    assert(
        emergency.final_decision.final_notification_type ===
        "CRITICAL_EMERGENCY_ALERT",
        "Emergency must route to critical alert."
    );

    // 2. EHR thresholds never suppress emergency.
    assert(
        emergency.final_decision.post_hitl_severity === 3,
        "Emergency severity must remain 3."
    );

    // 3. No post-HITL severity decrease.
    for (const result of [normal, gi, respiratory, sensorIssue, recurrence, ehrBaseline]) {
        const pre = result.sensor_classification?.pre_hitl_severity ?? 0;
        const post = result.final_decision.post_hitl_severity!;
        assert(post >= pre, "Post-HITL severity must not decrease.");
    }

    // 4. Caregiver GI observations can escalate to provider follow-up.
    assert(
        gi.final_decision.post_hitl_severity! >= 2,
        "GI caregiver concern should create Severity 2 floor."
    );
    assert(
        gi.final_slm_payload !== null,
        "GI Severity 2 event should build final SLM/provider payload."
    );

    // 5. Respiratory caregiver concern should route as respiratory concern.
    assert(
        respiratory.final_decision.post_hitl_anomaly_type ===
        "RESPIRATORY_CONCERN",
        "Breathing different should map to respiratory concern."
    );

    // 6. Sensor issue should not downgrade unsafely.
    assert(
        sensorIssue.caregiver_hitl?.data_quality_warning === true,
        "Sensor issue should set data quality warning."
    );
    assert(
        sensorIssue.final_decision.post_hitl_severity! >=
        (sensorIssue.sensor_classification?.pre_hitl_severity ?? 0),
        "Sensor issue must not reduce severity."
    );

    // 7. Recurrence non-emergency escalation capped at Severity 2.
    assert(
        recurrence.recurrence!.recurrence_severity_floor <= 2,
        "Recurrence non-emergency floor should cap at Severity 2."
    );
    assert(
        recurrence.final_decision.post_hitl_severity! <= 2,
        "Non-emergency recurrence should not auto-route to Severity 3."
    );

    // 8. EHR personalized threshold can raise severity floor.
    assert(
        ehrBaseline.personalized_thresholds!
            .personalized_threshold_severity_floor >= 2,
        "EHR care-plan threshold should raise severity floor."
    );

    // 9. Payload includes recurrence and personalized threshold fields.
    if (gi.final_slm_payload) {
        assert(
            typeof gi.final_slm_payload.baseline_deviation_score === "number",
            "SLM payload must include baseline_deviation_score."
        );
        assert(
            typeof gi.final_slm_payload.recurrence_risk_score === "number",
            "SLM payload must include recurrence_risk_score."
        );
        assert(
            typeof gi.final_slm_payload.same_class_count === "number",
            "SLM payload must include same_class_count."
        );
        assert(
            typeof gi.final_slm_payload.related_class_count === "number",
            "SLM payload must include related_class_count."
        );
        // Matrix-specific validation
        assert(
            breathingResp.caregiver_hitl?.max_matrix_delta === 3,
            "BREATHING_DIFFERENT + CARDIO_RESPIRATORY should produce matrix delta +3."
        );

        console.log("vomitingGi caregiver_hitl:", vomitingGi.caregiver_hitl);
        assert(
            vomitingGi.caregiver_hitl?.max_matrix_delta === 3,
            "VOMITING_OR_DIARRHEA + GI_AUTONOMIC should produce matrix delta +3."
        );

        assert(
            weakConfusedSeizure.caregiver_hitl?.max_matrix_delta === 3,
            "WEAK_CONFUSED_NOT_BASELINE + SEIZURE_LIKE should produce matrix delta +3."
        );

        assert(
            sensorIssue.final_decision.post_hitl_severity! >=
            (sensorIssue.sensor_classification?.pre_hitl_severity ?? 0),
            "Sensor issue must not downgrade severity."
        );
    }

    console.log("All UC2 decision-layer validation checks passed.");

    console.log({
        normal: normal.final_decision,
        gi: gi.final_decision,
        respiratory: respiratory.final_decision,
        emergency: emergency.final_decision,
        sensorIssue: sensorIssue.final_decision,
        recurrence: recurrence.final_decision,
        ehrBaseline: ehrBaseline.final_decision,
    });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
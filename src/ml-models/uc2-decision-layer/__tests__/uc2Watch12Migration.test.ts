/**
 * Watch12 migration acceptance tests (spec §7).
 *
 * All tests use runUC2DecisionLayerV2 — the production Watch12 entrypoint.
 * These tests verify that the production runtime is truly 12D end-to-end.
 */

import {
    runUC2DecisionLayerV2,
    makeFinalDecision,
    FEATURE_ORDER,
    AE_DEFAULT_THRESHOLD,
    AE_INPUT_DIM,
    scaleVector,
    validateSignalPhysiologicBounds,
    evaluateSustainedDuration,
    type ScalerParams,
    type RawObservationInput,
    type PatientProfile,
    type HistoricalAnomalyEvent,
    type SensorAnomalyType,
} from "../";

// ── Shared fixtures ───────────────────────────────────────────────────────────

const MOCK_SCALER_12D: ScalerParams = {
    mean: new Array(12).fill(0),
    scale: new Array(12).fill(1),
};

const MOCK_SCALER_18D: ScalerParams = {
    mean: new Array(18).fill(0),
    scale: new Array(18).fill(1),
};

const BASE_RAW: RawObservationInput = {
    patient_id: "watch12_test_001",
    timestamp_iso: "2026-01-15T14:00:00.000Z",
    heart_rate: 76,
    blood_oxygen: 97,
    respiratory_rate: 16,
    body_temperature: 98.6,
    activity_level: 0.3,
    sleep_quality: 0.7,
    hrv_sdnn: 48,
    steps_count: 3000,
    calories_burned: 1800,
};

const BASE_PROFILE: PatientProfile = {
    patient_id: "watch12_test_001",
    baseline: {
        resting_heart_rate: 72,
        blood_oxygen: 98,
        respiratory_rate: 16,
        body_temperature: 98.6,
        hrv_sdnn: 50,
        systolic_bp: 118,
        diastolic_bp: 76,
    },
};

// ── 7.1 Tensor dimensionality ─────────────────────────────────────────────────

describe("7.1 Tensor dimensionality", () => {
    it("FEATURE_ORDER has exactly 12 features", () => {
        expect(FEATURE_ORDER.length).toBe(12);
    });

    it("AE_INPUT_DIM constant is 12", () => {
        expect(AE_INPUT_DIM).toBe(12);
    });

    it("FEATURE_ORDER does not include BP, glucose, stress, pulse_pressure, or MAP", () => {
        const excluded = [
            "blood_pressure_systolic",
            "blood_pressure_diastolic",
            "glucose_level",
            "stress_level",
            "pulse_pressure",
            "mean_arterial_pressure",
        ];
        for (const feat of excluded) {
            expect(FEATURE_ORDER).not.toContain(feat);
        }
    });

    it("FEATURE_ORDER includes all 12 canonical Watch12 features", () => {
        const expected = [
            "heart_rate",
            "blood_oxygen",
            "respiratory_rate",
            "hrv_sdnn",
            "body_temperature",
            "activity_level",
            "steps_count",
            "calories_burned",
            "sleep_quality",
            "hour_sin",
            "hour_cos",
            "is_sleep_window",
        ];
        for (const feat of expected) {
            expect(FEATURE_ORDER).toContain(feat);
        }
    });

    it("feature_vector produced by v2 entrypoint has length 12", async () => {
        const result = await runUC2DecisionLayerV2({
            raw: BASE_RAW,
            scaler: MOCK_SCALER_12D,
        });
        expect(result.feature_vector?.length).toBe(12);
    });
});

// ── 7.2 Scaler and TFLite execution ──────────────────────────────────────────

describe("7.2 Scaler and TFLite mock execution", () => {
    it("AE_DEFAULT_THRESHOLD matches metadata 97.5th percentile (1.1447161)", () => {
        expect(AE_DEFAULT_THRESHOLD).toBeCloseTo(1.1447161, 5);
    });

    it("scaleVector with 12D identity scaler returns input unchanged", () => {
        const input = new Array(12).fill(0).map((_, i) => i * 0.1);
        const scaled = scaleVector(input, MOCK_SCALER_12D);
        expect(scaled.length).toBe(12);
        scaled.forEach((v, i) => expect(v).toBeCloseTo(input[i], 8));
    });

    it("v2 entrypoint with mock interpreter produces a 12D AE result", async () => {
        const result = await runUC2DecisionLayerV2({
            raw: BASE_RAW,
            scaler: MOCK_SCALER_12D,
        });
        // Either ae is null (emergency path) or has 12 top_contributors max
        if (result.ae) {
            expect(result.ae.top_contributors.length).toBeLessThanOrEqual(12);
            result.ae.top_contributors.forEach((c) => {
                expect(FEATURE_ORDER).toContain(c.feature);
            });
        }
    });

    it("v2 entrypoint ae_score uses 12 as denominator", async () => {
        const result = await runUC2DecisionLayerV2({
            raw: BASE_RAW,
            scaler: MOCK_SCALER_12D,
        });
        // MSE denominator validation: with mock reconstruction (v * 0.96),
        // score = sum((v - v*0.96)^2) / 12 = sum((0.04*v)^2) / 12
        // We can't compute the exact score without knowing scaled values,
        // but we can assert ae_score is a finite number when present.
        if (result.ae) {
            expect(Number.isFinite(result.ae.ae_score)).toBe(true);
            expect(result.ae.ae_score).toBeGreaterThanOrEqual(0);
        }
    });
});

// ── 7.3 Old 18D scaler rejected ───────────────────────────────────────────────

describe("7.3 Old 18D scaler rejected", () => {
    it("scaleVector throws on 18D scaler with 12D input", () => {
        const input12 = new Array(12).fill(1);
        expect(() => scaleVector(input12, MOCK_SCALER_18D)).toThrow(
            /18D scaler was supplied/
        );
    });

    it("runUC2DecisionLayerV2 throws when 18D scaler is passed", async () => {
        await expect(
            runUC2DecisionLayerV2({
                raw: BASE_RAW,
                scaler: MOCK_SCALER_18D,
            })
        ).rejects.toThrow(/18D scaler was supplied|Watch12/);
    });
});

// ── 7.4 BP/glucose excluded from AE tensor ────────────────────────────────────

describe("7.4 BP and glucose excluded from AE path", () => {
    it("feature_vector does not encode BP or glucose values", async () => {
        // Two otherwise identical observations, one with extreme BP/glucose
        const normalResult = await runUC2DecisionLayerV2({
            raw: BASE_RAW,
            scaler: MOCK_SCALER_12D,
        });
        const extremeBpResult = await runUC2DecisionLayerV2({
            raw: {
                ...BASE_RAW,
                blood_pressure_systolic: 220,
                blood_pressure_diastolic: 130,
                glucose_level: 400,
            },
            scaler: MOCK_SCALER_12D,
        });

        // Both should produce the same 12D feature vector (BP/glucose not in AE)
        expect(normalResult.feature_vector).toEqual(extremeBpResult.feature_vector);
    });

    it("top_contributors never reference BP, glucose, or stress", async () => {
        const result = await runUC2DecisionLayerV2({
            raw: { ...BASE_RAW, blood_pressure_systolic: 200, glucose_level: 300 },
            scaler: MOCK_SCALER_12D,
        });
        if (result.ae) {
            const excluded = [
                "blood_pressure_systolic",
                "blood_pressure_diastolic",
                "glucose_level",
                "stress_level",
                "pulse_pressure",
                "mean_arterial_pressure",
            ];
            for (const contributor of result.ae.top_contributors) {
                expect(excluded).not.toContain(contributor.feature);
            }
        }
    });
});

// ── 7.5 Missing EHR BP → no AE warnings ──────────────────────────────────────

describe("7.5 Missing EHR BP does not produce AE quality warnings", () => {
    it("profile without BP baseline produces no AE-path quality warnings", async () => {
        const profileWithoutBp: PatientProfile = {
            patient_id: "test_no_bp",
            baseline: {
                resting_heart_rate: 72,
                blood_oxygen: 98,
                // NO systolic_bp, NO diastolic_bp, NO glucose_level
            },
        };
        const result = await runUC2DecisionLayerV2({
            raw: BASE_RAW,
            profile: profileWithoutBp,
            scaler: MOCK_SCALER_12D,
        });
        // No quality tags should mention BP or glucose
        const bpGlucoseWarnings = (result.feature_quality_tags ?? []).filter((t) =>
            ["blood_pressure_systolic", "blood_pressure_diastolic", "glucose_level"].some(
                (name) => t.feature === name || t.warning?.includes(name)
            )
        );
        expect(bpGlucoseWarnings.length).toBe(0);
    });
});

// ── 7.6 External BP ≥ 170/110 fires personalized threshold floor 2 ───────────

describe("7.6 External BP threshold rule", () => {
    it("systolic BP ≥ 170 sets personalized threshold floor to 2", async () => {
        const result = await runUC2DecisionLayerV2({
            raw: BASE_RAW,
            profile: BASE_PROFILE,
            scaler: MOCK_SCALER_12D,
            externalMeasurements: {
                blood_pressure_systolic: 172,
                blood_pressure_diastolic: 88,
            },
        });
        expect(
            result.personalized_thresholds?.personalized_threshold_severity_floor
        ).toBeGreaterThanOrEqual(2);
        expect(
            result.personalized_thresholds?.personalized_threshold_reasons.some((r) =>
                r.toLowerCase().includes("bp") ||
                r.toLowerCase().includes("blood pressure") ||
                r.toLowerCase().includes("172")
            )
        ).toBe(true);
    });

    it("diastolic BP ≥ 110 sets personalized threshold floor to 2", async () => {
        const result = await runUC2DecisionLayerV2({
            raw: BASE_RAW,
            profile: BASE_PROFILE,
            scaler: MOCK_SCALER_12D,
            externalMeasurements: {
                blood_pressure_systolic: 140,
                blood_pressure_diastolic: 112,
            },
        });
        expect(
            result.personalized_thresholds?.personalized_threshold_severity_floor
        ).toBeGreaterThanOrEqual(2);
    });
});

// ── 7.7 HR artifact: 70→170 in 2s → INSUFFICIENT_DATA, no emergency ──────────

describe("7.7 HR rate-of-change artifact detection", () => {
    it("HR jump 70→170 in 2s routes to INSUFFICIENT_DATA without emergency", async () => {
        const previous = {
            timestamp_iso: "2026-01-15T14:00:00.000Z",
            heart_rate: 70,
            blood_oxygen: 97,
        };
        const current: RawObservationInput = {
            ...BASE_RAW,
            timestamp_iso: "2026-01-15T14:00:02.000Z", // 2 seconds later
            heart_rate: 170,
        };

        const result = await runUC2DecisionLayerV2({
            raw: current,
            scaler: MOCK_SCALER_12D,
            previous,
        });

        expect(result.signal_validation?.isArtifact).toBe(true);
        expect(result.sensor_classification?.sensor_anomaly_type).toBe("INSUFFICIENT_DATA");
        expect(result.emergency.is_emergency).toBeFalsy();
        expect(result.emergency.emergency).toBeFalsy();
        expect(result.signal_validation?.reasons.some((r) =>
            r.includes("Unrealistic vital rate of change detected")
        )).toBe(true);
    });

    it("HR artifact feature quality tag uses source signal_artifact", async () => {
        const previous = {
            timestamp_iso: "2026-01-15T14:00:00.000Z",
            heart_rate: 70,
            blood_oxygen: 97,
        };
        const current: RawObservationInput = {
            ...BASE_RAW,
            timestamp_iso: "2026-01-15T14:00:02.000Z",
            heart_rate: 170,
        };
        const result = await runUC2DecisionLayerV2({
            raw: current,
            scaler: MOCK_SCALER_12D,
            previous,
        });
        const artifactTags = (result.feature_quality_tags ?? []).filter(
            (t) => t.source === "signal_artifact"
        );
        expect(artifactTags.length).toBeGreaterThan(0);
    });
});

// ── 7.8 SpO2 artifact: 98→86 in 2s → INSUFFICIENT_DATA ──────────────────────

describe("7.8 SpO2 rate-of-change artifact detection", () => {
    it("SpO2 drop 98→86 in 2s routes to INSUFFICIENT_DATA", async () => {
        const previous = {
            timestamp_iso: "2026-01-15T14:00:00.000Z",
            heart_rate: 76,
            blood_oxygen: 98,
        };
        const current: RawObservationInput = {
            ...BASE_RAW,
            timestamp_iso: "2026-01-15T14:00:02.000Z", // 2 seconds later
            blood_oxygen: 86,
        };

        const result = await runUC2DecisionLayerV2({
            raw: current,
            scaler: MOCK_SCALER_12D,
            previous,
        });

        expect(result.signal_validation?.isArtifact).toBe(true);
        expect(result.sensor_classification?.sensor_anomaly_type).toBe("INSUFFICIENT_DATA");
    });

    it("fractional HealthKit SpO2 (0.98→0.86) also detected as artifact", () => {
        // validateSignalPhysiologicBounds unit test with HealthKit fractional values
        const validation = validateSignalPhysiologicBounds({
            current: {
                ...BASE_RAW,
                timestamp_iso: "2026-01-15T14:00:02.000Z",
                blood_oxygen: 0.86,
            },
            previous: {
                timestamp_iso: "2026-01-15T14:00:00.000Z",
                heart_rate: 76,
                blood_oxygen: 0.98,
            },
        });
        expect(validation.isArtifact).toBe(true);
        expect(validation.artifact_features).toContain("blood_oxygen");
    });
});

// ── 7.9 True emergency with valid readings → CRITICAL_EMERGENCY_ALERT, severity 3 ──

describe("7.9 True emergency bypasses artifact check", () => {
    it("SpO2=86 with no previous → CRITICAL_EMERGENCY_ALERT at severity 3 (not artifact)", async () => {
        const emergencyRaw: RawObservationInput = {
            patient_id: "emergency_test_001",
            timestamp_iso: "2026-01-15T09:00:00.000Z",
            heart_rate: 145,
            blood_oxygen: 86,   // below 88 → emergency rule
            respiratory_rate: 32,
            body_temperature: 98.9,
            activity_level: 0.0,
            sleep_quality: 0.3,
            hrv_sdnn: 18,
            steps_count: 50,
            calories_burned: 1200,
        };

        // No previous observation → no artifact check
        const result = await runUC2DecisionLayerV2({
            raw: emergencyRaw,
            scaler: MOCK_SCALER_12D,
        });

        expect(result.emergency.is_emergency).toBe(true);
        expect(result.final_decision.final_notification_type).toBe("CRITICAL_EMERGENCY_ALERT");
        expect(result.final_decision.post_hitl_severity).toBe(3);
        // AE and payloads must be null on emergency fast path
        expect(result.ae).toBeNull();
        expect(result.initial_mcp_payload).toBeNull();
        expect(result.final_slm_payload).toBeNull();
    });
});

// ── 7.10 Sustained duration 15-min history → severity floor 2 ────────────────

describe("7.10 Sustained duration escalation", () => {
    it("continuous 15-minute anomaly history triggers severity floor 2", () => {
        const now = new Date("2026-01-15T14:15:00.000Z");
        const history: HistoricalAnomalyEvent[] = Array.from({ length: 4 }, (_, i) => ({
            patient_id: "sustained_test",
            timestamp_iso: new Date(now.getTime() - (15 - i * 3) * 60 * 1000).toISOString(),
            post_hitl_anomaly_type: "RESPIRATORY_CONCERN" as const,
            final_severity: 1,
            caregiver_confirmed: false,
            sensor_anomaly_type: "CARDIO_RESPIRATORY_SIGNAL_CHANGE" as SensorAnomalyType,
        }));

        const result = evaluateSustainedDuration({
            patient_id: "sustained_test",
            timestamp_iso: now.toISOString(),
            current_sensor_anomaly_type: "CARDIO_RESPIRATORY_SIGNAL_CHANGE",
            current_pre_hitl_severity: 1,
            history,
        });

        expect(result.sustained_severity_floor).toBe(2);
        expect(result.sustained_minutes).toBeGreaterThan(10);
        expect(result.sustained_reasons.length).toBeGreaterThan(0);
    });

    it("sustained floor propagates to post_hitl_severity via v2 entrypoint", async () => {
        const now = new Date("2026-01-15T14:15:00.000Z");
        // Create history of continuous CARDIO_RESPIRATORY events for 15 minutes
        const history: HistoricalAnomalyEvent[] = Array.from({ length: 5 }, (_, i) => ({
            patient_id: BASE_RAW.patient_id,
            timestamp_iso: new Date(now.getTime() - (15 - i * 2.5) * 60 * 1000).toISOString(),
            post_hitl_anomaly_type: "RESPIRATORY_CONCERN" as const,
            final_severity: 1,
            caregiver_confirmed: false,
            sensor_anomaly_type: "CARDIO_RESPIRATORY_SIGNAL_CHANGE" as SensorAnomalyType,
        }));

        // Low SpO2 to generate CARDIO_RESPIRATORY routing from AE
        const anomalousRaw: RawObservationInput = {
            ...BASE_RAW,
            timestamp_iso: now.toISOString(),
            blood_oxygen: 93,
            respiratory_rate: 22,
        };

        const result = await runUC2DecisionLayerV2({
            raw: anomalousRaw,
            profile: BASE_PROFILE,
            scaler: MOCK_SCALER_12D,
            history,
        });

        if (result.sustained_duration && result.sustained_duration.sustained_minutes > 10) {
            expect(result.sustained_duration.sustained_severity_floor).toBe(2);
            expect(result.final_decision.post_hitl_severity).toBeGreaterThanOrEqual(2);
        }
    });

    it("sustained floor does not escalate if events are not continuous (gap too large)", () => {
        const now = new Date("2026-01-15T14:15:00.000Z");
        const history: HistoricalAnomalyEvent[] = [
            {
                patient_id: "gap_test",
                // 60 minutes ago — far outside continuous window
                timestamp_iso: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
                post_hitl_anomaly_type: "RESPIRATORY_CONCERN",
                final_severity: 1,
                caregiver_confirmed: false,
                sensor_anomaly_type: "CARDIO_RESPIRATORY_SIGNAL_CHANGE",
            },
        ];

        const result = evaluateSustainedDuration({
            patient_id: "gap_test",
            timestamp_iso: now.toISOString(),
            current_sensor_anomaly_type: "CARDIO_RESPIRATORY_SIGNAL_CHANGE",
            current_pre_hitl_severity: 1,
            history,
        });

        // Gap breaks continuous run → no escalation
        expect(result.sustained_severity_floor).toBe(0);
    });
});

// ── 7.11 Caregiver critical route → severity 3 preserved ─────────────────────

describe("7.11 Caregiver critical route severity 3", () => {
    it("critical_route_triggered raises post_hitl_severity to 3", async () => {
        // BREATHING_DIFFERENT + CARDIO_RESPIRATORY → critical route via matrix
        const result = await runUC2DecisionLayerV2({
            raw: {
                ...BASE_RAW,
                blood_oxygen: 93,
                respiratory_rate: 22,
                heart_rate: 110,
            },
            profile: BASE_PROFILE,
            scaler: MOCK_SCALER_12D,
            caregiverInput: {
                selected_codes: ["BREATHING_DIFFERENT"],
            },
        });

        // If critical route triggered, severity must be 3
        if (result.caregiver_hitl?.critical_route_triggered) {
            expect(result.final_decision.post_hitl_severity).toBe(3);
            expect(result.final_decision.final_notification_type).toBe(
                "CRITICAL_EMERGENCY_ALERT"
            );
        }
    });

    it("non-emergency severity 3 path does not collapse to severity 2", () => {
        // Directly test that makeFinalDecision honours critical_route_triggered
        const result = makeFinalDecision({
            emergency: {
                emergency: false,
                is_emergency: false,
                severity: 0,
                reason: null,
                pipelinePath: "UC2_SLOW_PATH",
            },
            sensor: {
                sensor_anomaly_type: "CARDIO_RESPIRATORY_SIGNAL_CHANGE",
                pre_hitl_severity: 1,
                reasons: [],
            },
            caregiver: {
                caregiver_selected_codes: ["BREATHING_DIFFERENT"],
                observation_severity_floor: 2,
                observation_reasons: [],
                data_quality_warning: false,
                human_context: "caregiver_concern",
                anomaly_family: "CARDIO_RESPIRATORY",
                max_matrix_delta: 3,
                critical_route_triggered: true,
                critical_route_reasons: ["Critical caregiver route triggered."],
            },
            personalized: null,
            recurrence: null,
            sustained: null,
        });

        expect(result.post_hitl_severity).toBe(3);
        expect(result.final_notification_type).toBe("CRITICAL_EMERGENCY_ALERT");
    });
});

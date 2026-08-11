import {
    runUC2DecisionLayerV2,
    AlertHysteresisManager,
    globalAlertHysteresisManager,
    VitalsTTLCache,
    globalVitalsTTLCache,
    computeAdaptiveBaselineStats,
    getAdjustedAEThreshold,
    validateWatchWristContact,
    type ScalerParams,
    type RawObservationInput,
    type PatientProfile,
} from "../index";

const MOCK_SCALER_12D: ScalerParams = {
    mean: [75, 97, 16, 45, 98.6, 0.3, 2500, 1800, 0.7, 0, 1, 0],
    scale: [10, 2, 3, 10, 1.0, 0.2, 1000, 500, 0.2, 0.7, 0.7, 0.5],
};

const BASE_RAW: RawObservationInput = {
    patient_id: "patient_test_123",
    timestamp_iso: "2026-08-07T10:00:00.000Z",
    heart_rate: 76,
    blood_oxygen: 97,
    respiratory_rate: 16,
    body_temperature: 98.6,
    activity_level: 0.3,
    sleep_quality: 0.7,
    hrv_sdnn: 45,
    steps_count: 2500,
    calories_burned: 1800,
};

const ANOMALOUS_RAW: RawObservationInput = {
    ...BASE_RAW,
    heart_rate: 115,
    blood_oxygen: 90,
    respiratory_rate: 26,
    body_temperature: 101.5,
};

describe("Stateful Alert Suppression, Off-Wrist & TTL Stream Caching", () => {
    beforeEach(() => {
        globalAlertHysteresisManager.clearAll();
        globalVitalsTTLCache.clear();
    });

    describe("1. Alert Hysteresis & Suppression Engine", () => {
        let manager: AlertHysteresisManager;

        beforeEach(() => {
            manager = new AlertHysteresisManager();
        });

        it("transitions from NORMAL to ACTIVE_ALERT on anomaly trigger", () => {
            const res = manager.evaluateAndStep({
                patient_id: "patient_001",
                timestamp_iso: "2026-08-07T10:00:00.000Z",
                is_anomaly: true,
                sensor_anomaly_type: "CARDIO_RESPIRATORY_SIGNAL_CHANGE",
                pre_hitl_severity: 1,
            });

            expect(res.hysteresisState.state).toBe("ACTIVE_ALERT");
            expect(res.suppressionStatus.is_suppressed).toBe(false);
        });

        it("suppresses identical alert within 30-minute quiet cooldown window", () => {
            // First alert at 10:00
            manager.evaluateAndStep({
                patient_id: "patient_001",
                timestamp_iso: "2026-08-07T10:00:00.000Z",
                is_anomaly: true,
                sensor_anomaly_type: "CARDIO_RESPIRATORY_SIGNAL_CHANGE",
                pre_hitl_severity: 1,
            });

            // Identical alert at 10:15 (15 min later)
            const res2 = manager.evaluateAndStep({
                patient_id: "patient_001",
                timestamp_iso: "2026-08-07T10:15:00.000Z",
                is_anomaly: true,
                sensor_anomaly_type: "CARDIO_RESPIRATORY_SIGNAL_CHANGE",
                pre_hitl_severity: 1,
            });

            expect(res2.suppressionStatus.is_suppressed).toBe(true);
            expect(res2.suppressionStatus.reason).toContain("30-minute cooldown");
        });

        it("bypasses cooldown immediately on severity escalation (Severity 1 -> Severity 2)", () => {
            // First alert at 10:00 with Severity 1
            manager.evaluateAndStep({
                patient_id: "patient_001",
                timestamp_iso: "2026-08-07T10:00:00.000Z",
                is_anomaly: true,
                sensor_anomaly_type: "CARDIO_RESPIRATORY_SIGNAL_CHANGE",
                pre_hitl_severity: 1,
                final_severity: 1,
            });

            // Escalated alert at 10:10 with Severity 2
            const res2 = manager.evaluateAndStep({
                patient_id: "patient_001",
                timestamp_iso: "2026-08-07T10:10:00.000Z",
                is_anomaly: true,
                sensor_anomaly_type: "CARDIO_RESPIRATORY_SIGNAL_CHANGE",
                pre_hitl_severity: 2,
                final_severity: 2,
            });

            expect(res2.suppressionStatus.is_suppressed).toBe(false);
            expect(res2.suppressionStatus.reason).toContain("Severity escalated");
        });

        it("auto-resolves state back to NORMAL after 5 consecutive normal timesteps", () => {
            // Anomaly trigger
            manager.evaluateAndStep({
                patient_id: "patient_001",
                timestamp_iso: "2026-08-07T10:00:00.000Z",
                is_anomaly: true,
                sensor_anomaly_type: "CARDIO_RESPIRATORY_SIGNAL_CHANGE",
                pre_hitl_severity: 1,
            });

            // 4 normal timesteps
            for (let i = 1; i <= 4; i++) {
                const res = manager.evaluateAndStep({
                    patient_id: "patient_001",
                    timestamp_iso: `2026-08-07T10:0${i}:00.000Z`,
                    is_anomaly: false,
                });
                expect(res.hysteresisState.state).toBe("ACTIVE_ALERT");
            }

            // 5th normal timestep
            const res5 = manager.evaluateAndStep({
                patient_id: "patient_001",
                timestamp_iso: "2026-08-07T10:05:00.000Z",
                is_anomaly: false,
            });

            expect(res5.hysteresisState.state).toBe("NORMAL");
        });
    });

    describe("2. Watch Off-Wrist Filter", () => {
        it("detects off-wrist when isNearWrist === false or wrist_state === 'off'", () => {
            const check1 = validateWatchWristContact({
                ...BASE_RAW,
                isNearWrist: false,
            });
            expect(check1.isOffWrist).toBe(true);

            const check2 = validateWatchWristContact({
                ...BASE_RAW,
                wrist_state: "off",
            });
            expect(check2.isOffWrist).toBe(true);
        });

        it("bypasses AE inference, sets WATCH_OFF_WRIST tag, and routes to INSUFFICIENT_DATA passive display before emergency", async () => {
            const result = await runUC2DecisionLayerV2({
                raw: {
                    ...ANOMALOUS_RAW,
                    isNearWrist: false,
                },
                scaler: MOCK_SCALER_12D,
            });

            expect(result.ae).toBeNull();
            expect(result.sensor_classification?.sensor_anomaly_type).toBe("INSUFFICIENT_DATA");
            expect(result.feature_quality_tags?.some((t) => t.source === "WATCH_OFF_WRIST")).toBe(true);
            expect(result.final_decision.final_notification_type).toBe("MONITORING_ADVICE");
            expect(result.final_decision.final_notification_body).toContain("Patient watch is off wrist");
        });
    });

    describe("3. Asynchronous Stream & TTL Caching", () => {
        let ttlCache: VitalsTTLCache;

        beforeEach(() => {
            ttlCache = new VitalsTTLCache();
        });

        it("carries forward SpO2 within 30-minute TTL window", () => {
            ttlCache.updateSample("p1", "blood_oxygen", 96, "2026-08-07T10:00:00.000Z");

            const validSample = ttlCache.getCachedSample("p1", "blood_oxygen", "2026-08-07T10:25:00.000Z", 30 * 60 * 1000);
            expect(validSample?.value).toBe(96);

            const expiredSample = ttlCache.getCachedSample("p1", "blood_oxygen", "2026-08-07T10:35:00.000Z", 30 * 60 * 1000);
            expect(expiredSample).toBeUndefined();
        });

        it("flags INSUFFICIENT_DATA and suppresses AE when heart_rate TTL (>10 min) expires", async () => {
            const uniquePatientId = `ttl-test-${Date.now()}`;
            const { heart_rate, ...rawNoHr } = BASE_RAW;
            const rawWithUniqueId = { ...rawNoHr, patient_id: uniquePatientId };

            const result = await runUC2DecisionLayerV2({
                raw: rawWithUniqueId,
                scaler: MOCK_SCALER_12D,
            });

            expect(result.ae).toBeNull();
            expect(result.sensor_classification?.sensor_anomaly_type).toBe("INSUFFICIENT_DATA");
        });
    });

    describe("4. Adaptive Baseline Normalization & Personalized Thresholds", () => {
        it("computes rolling 7-day mean and std from history", () => {
            const history = [
                { heart_rate: 70, blood_oxygen: 98 },
                { heart_rate: 72, blood_oxygen: 98 },
                { heart_rate: 74, blood_oxygen: 96 },
            ];
            const stats = computeAdaptiveBaselineStats(history);
            expect(stats.rolling_7d_mean.heart_rate).toBe(72);
            expect(stats.rolling_7d_mean.blood_oxygen).toBe(97.33333333333333);
        });

        it("adjusts runtime AE trigger threshold according to patient clinical risk tier / GMFCS level", () => {
            const profileGmfcsV: PatientProfile = {
                patient_id: "p1",
                gmfcs_level: "V",
            };
            const adjustedThreshold = getAdjustedAEThreshold(1.1447, profileGmfcsV);
            expect(adjustedThreshold).toBeLessThan(1.1447);
        });
    });

    describe("5. Signal Validation & Off-Wrist Safety Pipeline Order", () => {
        it("routes HR artifact jump (70->170 in 2s) to INSUFFICIENT_DATA before emergency engine", async () => {
            const previous = {
                timestamp_iso: "2026-01-15T14:00:00.000Z",
                heart_rate: 70,
                blood_oxygen: 97,
            };
            const current: RawObservationInput = {
                ...BASE_RAW,
                timestamp_iso: "2026-01-15T14:00:02.000Z",
                heart_rate: 170, // Impossible artifact jump
            };

            const result = await runUC2DecisionLayerV2({
                raw: current,
                scaler: MOCK_SCALER_12D,
                previous,
            });

            expect(result.signal_validation?.isArtifact).toBe(true);
            expect(result.sensor_classification?.sensor_anomaly_type).toBe("INSUFFICIENT_DATA");
            expect(result.emergency.is_emergency).toBe(false);
        });

        it("routes off-wrist watch (isNearWrist: false) to passive monitoring before emergency engine", async () => {
            const result = await runUC2DecisionLayerV2({
                raw: {
                    ...BASE_RAW,
                    blood_oxygen: 85, // Low SpO2, but watch is off wrist
                    isNearWrist: false,
                },
                scaler: MOCK_SCALER_12D,
            });

            expect(result.emergency.is_emergency).toBe(false);
            expect(result.sensor_classification?.sensor_anomaly_type).toBe("INSUFFICIENT_DATA");
            expect(result.final_decision.final_notification_type).toBe("MONITORING_ADVICE");
            expect(result.final_decision.final_notification_body).toContain("Patient watch is off wrist");
        });

        it("fires severe emergency alert (HR >= 140 bpm) when on-wrist and non-artifact", async () => {
            const manager = new AlertHysteresisManager();

            const result = await runUC2DecisionLayerV2({
                raw: {
                    ...BASE_RAW,
                    patient_id: "p_emergency",
                    timestamp_iso: "2026-08-07T10:05:00.000Z",
                    heart_rate: 145, // Valid on-wrist emergency spike
                    isNearWrist: true,
                },
                scaler: MOCK_SCALER_12D,
                hysteresisManager: manager,
            });

            expect(result.emergency.is_emergency).toBe(true);
            expect(result.final_decision.final_notification_type).toBe("CRITICAL_EMERGENCY_ALERT");
        });
    });
});

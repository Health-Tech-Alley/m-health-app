/**
 * Unit tests: Watch12 v3 decision layer upgrades
 *   - AlertHysteresisManager (alert suppression state machine)
 *   - VitalsTTLCache (stream TTL caching)
 *   - validateWatchWristContact (off-wrist detection)
 *   - computeAdaptiveBaselineStats (rolling 7-day baseline)
 *   - getAdjustedAEThreshold (adaptive AE threshold)
 */

import { AlertHysteresisManager } from "../anomalyHistoryStore";
import { VitalsTTLCache } from "../featureImputation";
import { validateWatchWristContact } from "../signalValidation";
import { computeAdaptiveBaselineStats } from "../ehrProfileAdapter";
import { getAdjustedAEThreshold } from "../personalizedThresholds";

// ── AlertHysteresisManager ────────────────────────────────────────────────────

describe("AlertHysteresisManager", () => {
    let manager: AlertHysteresisManager;

    beforeEach(() => {
        manager = new AlertHysteresisManager();
    });

    it("starts in NORMAL state for new patient", () => {
        const state = manager.getState("patient-001");
        expect(state.state).toBe("NORMAL");
        expect(state.consecutive_normal_count).toBe(0);
    });

    it("transitions to ACTIVE_ALERT on first anomaly", () => {
        const result = manager.evaluateAndStep({
            patient_id: "p1",
            timestamp_iso: "2024-01-01T10:00:00Z",
            is_anomaly: true,
            sensor_anomaly_type: "CARDIO_RESPIRATORY_SIGNAL_CHANGE",
            pre_hitl_severity: 1,
        });
        expect(result.hysteresisState.state).toBe("ACTIVE_ALERT");
        expect(result.suppressionStatus.is_suppressed).toBe(false);
    });

    it("suppresses identical anomaly within 30-minute cooldown window", () => {
        const t0 = "2024-01-01T10:00:00Z";
        const t1 = "2024-01-01T10:10:00Z"; // 10 min later -- within 30 min

        manager.evaluateAndStep({
            patient_id: "p2",
            timestamp_iso: t0,
            is_anomaly: true,
            sensor_anomaly_type: "CARDIO_RESPIRATORY_SIGNAL_CHANGE",
            pre_hitl_severity: 1,
        });

        const result = manager.evaluateAndStep({
            patient_id: "p2",
            timestamp_iso: t1,
            is_anomaly: true,
            sensor_anomaly_type: "CARDIO_RESPIRATORY_SIGNAL_CHANGE",
            pre_hitl_severity: 1,
        });
        expect(result.suppressionStatus.is_suppressed).toBe(true);
        expect(result.suppressionStatus.reason).toMatch(/cooldown/i);
    });

    it("bypasses cooldown when severity escalates", () => {
        const t0 = "2024-01-01T10:00:00Z";
        const t1 = "2024-01-01T10:05:00Z";

        manager.evaluateAndStep({
            patient_id: "p3",
            timestamp_iso: t0,
            is_anomaly: true,
            sensor_anomaly_type: "CARDIO_RESPIRATORY_SIGNAL_CHANGE",
            pre_hitl_severity: 1,
        });

        const result = manager.evaluateAndStep({
            patient_id: "p3",
            timestamp_iso: t1,
            is_anomaly: true,
            sensor_anomaly_type: "CARDIO_RESPIRATORY_SIGNAL_CHANGE",
            pre_hitl_severity: 2,
        });
        expect(result.suppressionStatus.is_suppressed).toBe(false);
        expect(result.suppressionStatus.reason).toMatch(/escalat/i);
    });

    it("resets to NORMAL after 5 consecutive normal timesteps", () => {
        manager.evaluateAndStep({
            patient_id: "p4",
            timestamp_iso: "2024-01-01T10:00:00Z",
            is_anomaly: true,
            sensor_anomaly_type: "CARDIO_RESPIRATORY_SIGNAL_CHANGE",
            pre_hitl_severity: 1,
        });

        for (let i = 1; i <= 5; i++) {
            manager.evaluateAndStep({
                patient_id: "p4",
                timestamp_iso: `2024-01-01T10:0${i}:00Z`,
                is_anomaly: false,
            });
        }

        expect(manager.getState("p4").state).toBe("NORMAL");
    });

    it("emergency bypasses suppression and severity is forced to 3", () => {
        manager.evaluateAndStep({
            patient_id: "p5",
            timestamp_iso: "2024-01-01T10:00:00Z",
            is_anomaly: true,
            sensor_anomaly_type: "CRITICAL_VITAL_THRESHOLD",
            pre_hitl_severity: 2,
        });

        const result = manager.evaluateAndStep({
            patient_id: "p5",
            timestamp_iso: "2024-01-01T10:05:00Z",
            is_anomaly: true,
            sensor_anomaly_type: "CRITICAL_VITAL_THRESHOLD",
            pre_hitl_severity: 2,
            is_emergency: true,
        });
        expect(result.suppressionStatus.is_suppressed).toBe(false);
        expect(result.hysteresisState.last_alert_severity).toBe(3);
    });

    it("allows different anomaly type through during cooldown without suppression", () => {
        manager.evaluateAndStep({
            patient_id: "p6",
            timestamp_iso: "2024-01-01T10:00:00Z",
            is_anomaly: true,
            sensor_anomaly_type: "CARDIO_RESPIRATORY_SIGNAL_CHANGE",
            pre_hitl_severity: 1,
        });

        const result = manager.evaluateAndStep({
            patient_id: "p6",
            timestamp_iso: "2024-01-01T10:05:00Z",
            is_anomaly: true,
            sensor_anomaly_type: "SLEEP_RECOVERY_DEVIATION",
            pre_hitl_severity: 1,
        });
        expect(result.suppressionStatus.is_suppressed).toBe(false);
    });

    it("allows identical anomaly after 30-minute cooldown expires", () => {
        manager.evaluateAndStep({
            patient_id: "p7",
            timestamp_iso: "2024-01-01T10:00:00Z",
            is_anomaly: true,
            sensor_anomaly_type: "CARDIO_RESPIRATORY_SIGNAL_CHANGE",
            pre_hitl_severity: 1,
        });

        const result = manager.evaluateAndStep({
            patient_id: "p7",
            timestamp_iso: "2024-01-01T10:31:00Z", // 31 min later -- cooldown expired
            is_anomaly: true,
            sensor_anomaly_type: "CARDIO_RESPIRATORY_SIGNAL_CHANGE",
            pre_hitl_severity: 1,
        });
        expect(result.suppressionStatus.is_suppressed).toBe(false);
    });
});

// ── VitalsTTLCache ────────────────────────────────────────────────────────────

describe("VitalsTTLCache", () => {
    let cache: VitalsTTLCache;

    beforeEach(() => {
        cache = new VitalsTTLCache();
    });

    it("returns sample within TTL window", () => {
        cache.updateSample("p1", "heart_rate", 72, "2024-01-01T10:00:00Z");
        const sample = cache.getCachedSample("p1", "heart_rate", "2024-01-01T10:05:00Z", 10 * 60 * 1000);
        expect(sample).toBeDefined();
        expect(sample?.value).toBe(72);
    });

    it("returns undefined when sample exceeds TTL", () => {
        cache.updateSample("p1", "heart_rate", 72, "2024-01-01T10:00:00Z");
        const sample = cache.getCachedSample("p1", "heart_rate", "2024-01-01T10:11:00Z", 10 * 60 * 1000);
        expect(sample).toBeUndefined();
    });

    it("returns undefined for unknown patient", () => {
        const sample = cache.getCachedSample("unknown", "heart_rate", "2024-01-01T10:00:00Z", 10 * 60 * 1000);
        expect(sample).toBeUndefined();
    });

    it("overwrites stale sample with newer value", () => {
        cache.updateSample("p1", "heart_rate", 72, "2024-01-01T09:00:00Z");
        cache.updateSample("p1", "heart_rate", 80, "2024-01-01T10:00:00Z");
        const sample = cache.getCachedSample("p1", "heart_rate", "2024-01-01T10:05:00Z", 10 * 60 * 1000);
        expect(sample?.value).toBe(80);
    });

    it("clear() for specific patient does not affect other patients", () => {
        cache.updateSample("p1", "heart_rate", 72, "2024-01-01T10:00:00Z");
        cache.updateSample("p2", "heart_rate", 65, "2024-01-01T10:00:00Z");
        cache.clear("p1");
        expect(cache.getCachedSample("p1", "heart_rate", "2024-01-01T10:02:00Z", 10 * 60 * 1000)).toBeUndefined();
        expect(cache.getCachedSample("p2", "heart_rate", "2024-01-01T10:02:00Z", 10 * 60 * 1000)).toBeDefined();
    });

    it("exact TTL boundary returns sample (inclusive)", () => {
        cache.updateSample("p1", "heart_rate", 72, "2024-01-01T10:00:00Z");
        // exactly 10 min later -- at TTL boundary
        const sample = cache.getCachedSample("p1", "heart_rate", "2024-01-01T10:10:00Z", 10 * 60 * 1000);
        expect(sample).toBeDefined();
    });
});

// ── validateWatchWristContact ─────────────────────────────────────────────────

describe("validateWatchWristContact", () => {
    it("returns isOffWrist=false when no wrist fields set", () => {
        const result = validateWatchWristContact({
            patient_id: "p1",
            timestamp_iso: "2024-01-01T10:00:00Z",
        });
        expect(result.isOffWrist).toBe(false);
        expect(result.reasons).toHaveLength(0);
        expect(result.feature_quality_tags).toHaveLength(0);
    });

    it("returns isOffWrist=true when isNearWrist is false", () => {
        const result = validateWatchWristContact({
            patient_id: "p1",
            timestamp_iso: "2024-01-01T10:00:00Z",
            isNearWrist: false,
        });
        expect(result.isOffWrist).toBe(true);
        expect(result.reasons[0]).toMatch(/off wrist/i);
    });

    it("returns isOffWrist=true when wrist_state is 'off'", () => {
        const result = validateWatchWristContact({
            patient_id: "p1",
            timestamp_iso: "2024-01-01T10:00:00Z",
            wrist_state: "off",
        });
        expect(result.isOffWrist).toBe(true);
    });

    it("returns isOffWrist=false when isNearWrist is true", () => {
        const result = validateWatchWristContact({
            patient_id: "p1",
            timestamp_iso: "2024-01-01T10:00:00Z",
            isNearWrist: true,
        });
        expect(result.isOffWrist).toBe(false);
    });

    it("returns isOffWrist=false when wrist_state is 'on'", () => {
        const result = validateWatchWristContact({
            patient_id: "p1",
            timestamp_iso: "2024-01-01T10:00:00Z",
            wrist_state: "on",
        });
        expect(result.isOffWrist).toBe(false);
    });

    it("tags both heart_rate and blood_oxygen with WATCH_OFF_WRIST source", () => {
        const result = validateWatchWristContact({
            patient_id: "p1",
            timestamp_iso: "2024-01-01T10:00:00Z",
            isNearWrist: false,
            heart_rate: 55,
            blood_oxygen: 90,
        });
        expect(result.feature_quality_tags).toHaveLength(2);
        const sources = result.feature_quality_tags.map((t) => t.source);
        expect(sources).toContain("WATCH_OFF_WRIST");
    });
});

// ── computeAdaptiveBaselineStats ──────────────────────────────────────────────

describe("computeAdaptiveBaselineStats", () => {
    it("returns empty dicts for empty input", () => {
        const result = computeAdaptiveBaselineStats([]);
        expect(Object.keys(result.rolling_7d_mean)).toHaveLength(0);
        expect(Object.keys(result.rolling_7d_std)).toHaveLength(0);
    });

    it("computes correct mean for single feature across samples", () => {
        const result = computeAdaptiveBaselineStats([
            { heart_rate: 60 },
            { heart_rate: 70 },
            { heart_rate: 80 },
        ]);
        expect(result.rolling_7d_mean.heart_rate).toBeCloseTo(70, 1);
    });

    it("computes std=0 when all values are identical", () => {
        const result = computeAdaptiveBaselineStats([
            { heart_rate: 70 },
            { heart_rate: 70 },
            { heart_rate: 70 },
        ]);
        expect(result.rolling_7d_std.heart_rate).toBeCloseTo(0, 5);
    });

    it("ignores NaN values in mean computation", () => {
        const result = computeAdaptiveBaselineStats([
            { heart_rate: 70 },
            { heart_rate: NaN },
            { heart_rate: 90 },
        ]);
        expect(result.rolling_7d_mean.heart_rate).toBeCloseTo(80, 1);
    });

    it("handles multiple features independently", () => {
        const result = computeAdaptiveBaselineStats([
            { heart_rate: 60, blood_oxygen: 96 },
            { heart_rate: 80, blood_oxygen: 98 },
        ]);
        expect(result.rolling_7d_mean.heart_rate).toBeCloseTo(70, 1);
        expect(result.rolling_7d_mean.blood_oxygen).toBeCloseTo(97, 1);
    });
});

// ── getAdjustedAEThreshold ────────────────────────────────────────────────────

describe("getAdjustedAEThreshold", () => {
    const base = 0.5;

    it("returns base threshold when no profile is given", () => {
        expect(getAdjustedAEThreshold(base)).toBe(base);
    });

    it("returns lower threshold for CRITICAL risk tier", () => {
        expect(getAdjustedAEThreshold(base, { clinical_risk_tier: "CRITICAL" } as any)).toBeLessThan(base);
    });

    it("returns lower threshold for HIGH risk tier", () => {
        expect(getAdjustedAEThreshold(base, { clinical_risk_tier: "HIGH" } as any)).toBeLessThan(base);
    });

    it("returns higher threshold for LOW risk tier", () => {
        expect(getAdjustedAEThreshold(base, { clinical_risk_tier: "LOW" } as any)).toBeGreaterThan(base);
    });

    it("MEDIUM risk tier returns base threshold unchanged", () => {
        expect(getAdjustedAEThreshold(base, { clinical_risk_tier: "MEDIUM" } as any)).toBe(base);
    });

    it("GMFCS Level V lowers threshold", () => {
        expect(getAdjustedAEThreshold(base, { gmfcs_level: "V" } as any)).toBeLessThan(base);
    });

    it("GMFCS Level V combined with CRITICAL lowers threshold further than CRITICAL alone", () => {
        const critOnly = getAdjustedAEThreshold(base, { clinical_risk_tier: "CRITICAL" } as any);
        const combined = getAdjustedAEThreshold(base, { gmfcs_level: "V", clinical_risk_tier: "CRITICAL" } as any);
        expect(combined).toBeLessThan(critOnly);
    });
});

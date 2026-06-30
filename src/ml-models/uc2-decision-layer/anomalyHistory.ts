/**
 * Anomaly history utilities.
 *
 * New in EHR handoff v2. Provides helpers for filtering a patient's recent
 * anomaly history for use in recurrence risk scoring.
 *
 * Note: History storage is handled separately by AnomalyHistoryStore
 * (see anomalyHistoryStore.ts). This file is pure logic — no I/O.
 */

import type {
    HistoricalAnomalyEvent,
    PostHitlAnomalyType,
} from "./uc2Types";

// ── Time-window filtering ─────────────────────────────────────────────────────

/**
 * Filter recent history events to those that are:
 *   1. Belonging to the same patient
 *   2. Within the recurrence look-back window for the current anomaly type
 *   3. Not in the future relative to the current event
 */
export function filterRecentHistory(
    history: HistoricalAnomalyEvent[],
    patient_id: string,
    nowIso: string,
    currentType: PostHitlAnomalyType
): HistoricalAnomalyEvent[] {
    const now = new Date(nowIso).getTime();
    const hours = windowHoursForType(currentType);

    return history.filter((event) => {
        if (event.patient_id !== patient_id) return false;

        const t = new Date(event.timestamp_iso).getTime();
        const ageHours = (now - t) / (1000 * 60 * 60);

        return ageHours >= 0 && ageHours <= hours;
    });
}

// ── Related anomaly type groups ───────────────────────────────────────────────

/**
 * Returns true if anomaly types a and b are clinically related
 * (i.e., belong to the same recurrence group).
 *
 * Related types share physiologic pathways and may indicate a trend
 * even when not identical. Used to compute the related_class_count
 * component of the recurrence risk score.
 */
export function areRelatedAnomalyTypes(
    a: PostHitlAnomalyType,
    b: PostHitlAnomalyType
): boolean {
    if (a === b) return true;

    const respiratoryGroup: PostHitlAnomalyType[] = [
        "RESPIRATORY_CONCERN",
        "POSTICTAL_RECOVERY_CONCERN",
        "PROVIDER_REVIEW_RECOMMENDED",
    ];

    const giGroup: PostHitlAnomalyType[] = [
        "GI_AUTONOMIC_RISK",
        "MEDICATION_ADHERENCE_CONCERN",
        "PROVIDER_REVIEW_RECOMMENDED",
    ];

    const recoveryGroup: PostHitlAnomalyType[] = [
        "SLEEP_STRESS_RECOVERY",
        "PROVIDER_REVIEW_RECOMMENDED",
    ];

    const seizureGroup: PostHitlAnomalyType[] = [
        "POSTICTAL_RECOVERY_CONCERN",
        "SEIZURE_LIKE_EVENT_CONFIRMED",
        "RESPIRATORY_CONCERN",
    ];

    return (
        sameGroup(a, b, respiratoryGroup) ||
        sameGroup(a, b, giGroup) ||
        sameGroup(a, b, recoveryGroup) ||
        sameGroup(a, b, seizureGroup)
    );
}

function sameGroup(
    a: PostHitlAnomalyType,
    b: PostHitlAnomalyType,
    group: PostHitlAnomalyType[]
): boolean {
    return group.includes(a) && group.includes(b);
}

// ── Recurrence look-back windows by anomaly type ──────────────────────────────

/**
 * Time window (in hours) to look back for recurrence of each anomaly type.
 * Seizure/respiratory events use shorter windows (48–72h) to capture acute
 * clusters. Sleep/medication events use longer windows (7d) for trend tracking.
 */
export function windowHoursForType(type: PostHitlAnomalyType): number {
    switch (type) {
        case "RESPIRATORY_CONCERN":
            return 48;
        case "GI_AUTONOMIC_RISK":
            return 72;
        case "SLEEP_STRESS_RECOVERY":
            return 7 * 24;
        case "EXERTION_LIKE_PATTERN":
            return 24;
        case "POSTICTAL_RECOVERY_CONCERN":
        case "SEIZURE_LIKE_EVENT_CONFIRMED":
            return 72;
        case "MEDICATION_ADHERENCE_CONCERN":
            return 7 * 24;
        default:
            return 72;
    }
}

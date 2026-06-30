/**
 * Anomaly History Store.
 *
 * New in EHR handoff v2. Provides a clean interface for persisting and
 * retrieving historical anomaly events used by the recurrence risk scorer.
 *
 * Design:
 *   - AnomalyHistoryStore: abstract interface for any backing store.
 *   - InMemoryAnomalyHistoryStore: in-memory implementation for dev/testing.
 *   - SQLiteAnomalyHistoryStore: TODO stub — ready for encrypted SQLite/SQLCipher.
 *
 * The decision layer accepts HistoricalAnomalyEvent[] directly (pass-through
 * style) so it does not need to know about the store. Callers retrieve history
 * from the store and pass it to runUC2DecisionLayer({ history: [...] }).
 *
 * Future:
 *   Replace InMemoryAnomalyHistoryStore with SQLiteAnomalyHistoryStore when
 *   the data layer is ready. The interface will not change.
 */

import type {
    HistoricalAnomalyEvent,
    PostHitlAnomalyType,
    Severity,
} from "./uc2Types";

// ── Store interface ───────────────────────────────────────────────────────────

export interface AnomalyHistoryStore {
    /**
     * Persist a new anomaly event. Called after the decision layer completes
     * and the final result (post_hitl_type, severity, caregiver_confirmed)
     * is known.
     */
    append(event: HistoricalAnomalyEvent): Promise<void>;

    /**
     * Retrieve all events for a patient within the given look-back hours.
     * Returns most-recent events first.
     */
    getRecent(patient_id: string, withinHours: number): Promise<HistoricalAnomalyEvent[]>;

    /**
     * Retrieve all events for a patient (no time filter).
     * Useful for full audit trail.
     */
    getAll(patient_id: string): Promise<HistoricalAnomalyEvent[]>;

    /**
     * Remove events older than `olderThanHours` for the patient.
     * Used for store pruning / retention policy.
     */
    prune(patient_id: string, olderThanHours: number): Promise<void>;
}

// ── Helper: build a HistoricalAnomalyEvent from a completed decision ──────────

export function buildHistoricalAnomalyEvent(params: {
    patient_id: string;
    timestamp_iso: string;
    post_hitl_anomaly_type: PostHitlAnomalyType;
    final_severity: Severity;
    caregiver_confirmed: boolean;
}): HistoricalAnomalyEvent {
    return {
        patient_id: params.patient_id,
        timestamp_iso: params.timestamp_iso,
        post_hitl_anomaly_type: params.post_hitl_anomaly_type,
        final_severity: params.final_severity,
        caregiver_confirmed: params.caregiver_confirmed,
    };
}

// ── In-memory implementation ──────────────────────────────────────────────────

/**
 * In-memory anomaly history store for dev, testing, and Expo Go flows.
 *
 * State is reset on app restart. Use SQLiteAnomalyHistoryStore for
 * persistence across sessions.
 *
 * Thread safety: JavaScript is single-threaded; no locking required.
 */
export class InMemoryAnomalyHistoryStore implements AnomalyHistoryStore {
    private events: HistoricalAnomalyEvent[] = [];

    async append(event: HistoricalAnomalyEvent): Promise<void> {
        this.events.push(event);
    }

    async getRecent(
        patient_id: string,
        withinHours: number
    ): Promise<HistoricalAnomalyEvent[]> {
        const now = Date.now();
        const cutoff = withinHours * 60 * 60 * 1000;

        return this.events
            .filter((e) => {
                if (e.patient_id !== patient_id) return false;
                const age = now - new Date(e.timestamp_iso).getTime();
                return age >= 0 && age <= cutoff;
            })
            .sort(
                (a, b) =>
                    new Date(b.timestamp_iso).getTime() -
                    new Date(a.timestamp_iso).getTime()
            );
    }

    async getAll(patient_id: string): Promise<HistoricalAnomalyEvent[]> {
        return this.events
            .filter((e) => e.patient_id === patient_id)
            .sort(
                (a, b) =>
                    new Date(b.timestamp_iso).getTime() -
                    new Date(a.timestamp_iso).getTime()
            );
    }

    async prune(patient_id: string, olderThanHours: number): Promise<void> {
        const now = Date.now();
        const cutoff = olderThanHours * 60 * 60 * 1000;
        this.events = this.events.filter((e) => {
            if (e.patient_id !== patient_id) return true;
            const age = now - new Date(e.timestamp_iso).getTime();
            return age <= cutoff;
        });
    }

    /** For testing only — returns a snapshot of all stored events. */
    _snapshot(): HistoricalAnomalyEvent[] {
        return [...this.events];
    }

    /** For testing only — clear all stored events. */
    _clear(): void {
        this.events = [];
    }
}

// ── SQLite stub ───────────────────────────────────────────────────────────────

/**
 * TODO: SQLite-backed anomaly history store.
 *
 * Implementation guide (for later):
 *   - Use expo-sqlite or react-native-quick-sqlite with SQLCipher for encryption.
 *   - Table: anomaly_history (patient_id, timestamp_iso, post_hitl_anomaly_type,
 *     final_severity, caregiver_confirmed)
 *   - Index: (patient_id, timestamp_iso) for efficient time-window queries.
 *   - Encrypt with per-patient key from secure keychain.
 *   - Prune on append if count exceeds retention limit (e.g., 90 days).
 *
 * This class implements the AnomalyHistoryStore interface so it is a drop-in
 * replacement for InMemoryAnomalyHistoryStore with no changes to callers.
 */
export class SQLiteAnomalyHistoryStore implements AnomalyHistoryStore {
    constructor(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _dbPath: string,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _encryptionKey?: string
    ) {
        // TODO: open encrypted SQLite connection
    }

    async append(_event: HistoricalAnomalyEvent): Promise<void> {
        // TODO: INSERT INTO anomaly_history ...
        throw new Error(
            "SQLiteAnomalyHistoryStore.append: not yet implemented. Use InMemoryAnomalyHistoryStore for now."
        );
    }

    async getRecent(
        _patient_id: string,
        _withinHours: number
    ): Promise<HistoricalAnomalyEvent[]> {
        // TODO: SELECT * FROM anomaly_history WHERE patient_id = ? AND timestamp_iso >= ?
        throw new Error(
            "SQLiteAnomalyHistoryStore.getRecent: not yet implemented. Use InMemoryAnomalyHistoryStore for now."
        );
    }

    async getAll(_patient_id: string): Promise<HistoricalAnomalyEvent[]> {
        // TODO: SELECT * FROM anomaly_history WHERE patient_id = ?
        throw new Error(
            "SQLiteAnomalyHistoryStore.getAll: not yet implemented. Use InMemoryAnomalyHistoryStore for now."
        );
    }

    async prune(_patient_id: string, _olderThanHours: number): Promise<void> {
        // TODO: DELETE FROM anomaly_history WHERE patient_id = ? AND timestamp_iso < ?
        throw new Error(
            "SQLiteAnomalyHistoryStore.prune: not yet implemented. Use InMemoryAnomalyHistoryStore for now."
        );
    }
}

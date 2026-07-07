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

// ── SQLite implementation ────────────────────────────────────────────────────

/**
 * SQLite-backed anomaly history store.
 *
 * Persists to the main app database (`caregiver-concierge.db`), table
 * `anomaly_history`, defined by migration 21 in `src/data/migrations.ts`.
 *
 * Schema (per planning/14_uc2-ml-alert-notification-flow.md §13):
 *   patient_id        TEXT NOT NULL
 *   event_id          TEXT NOT NULL
 *   anomaly_type      TEXT NOT NULL  -- post_hitl_anomaly_type
 *   severity          INTEGER NOT NULL
 *   timestamp         TEXT NOT NULL  -- ISO-8601
 *   caregiver_confirmed INTEGER NOT NULL DEFAULT 0
 *   metadata_json     TEXT
 *
 * Indexes:
 *   (patient_id, timestamp)
 *   (patient_id, anomaly_type, timestamp)
 *
 * Encryption: SQLCipher is the planned encryption layer (doc 22). Until it
 * ships, the table is plaintext within the app DB — acceptable for
 * synthetic-only Track A data.
 */
export class SQLiteAnomalyHistoryStore implements AnomalyHistoryStore {
    constructor(_dbPath?: string, _encryptionKey?: string) {
        // The store uses the shared `getDatabase()` connection; per-tenant
        // SQLCipher keys will be wired here once doc 22 ships.
    }

    async append(event: HistoricalAnomalyEvent): Promise<void> {
        const { getDatabase } = await import("@/data/db");
        const db = getDatabase();
        const eventId = `anomaly-${event.patient_id}-${Date.parse(event.timestamp_iso)}-${Math.random()
            .toString(36)
            .slice(2, 8)}`;
        db.runSync(
            `INSERT OR REPLACE INTO anomaly_history
              (patient_id, event_id, anomaly_type, severity, timestamp,
               caregiver_confirmed, metadata_json)
             VALUES (?, ?, ?, ?, ?, ?, NULL);`,
            event.patient_id,
            eventId,
            event.post_hitl_anomaly_type,
            event.final_severity,
            event.timestamp_iso,
            event.caregiver_confirmed ? 1 : 0,
        );
    }

    async getRecent(
        patient_id: string,
        withinHours: number
    ): Promise<HistoricalAnomalyEvent[]> {
        const cutoff = new Date(
            Date.now() - withinHours * 60 * 60 * 1000
        ).toISOString();
        return this.queryWindow(patient_id, cutoff);
    }

    async getAll(patient_id: string): Promise<HistoricalAnomalyEvent[]> {
        return this.queryWindow(patient_id, null);
    }

    async prune(patient_id: string, olderThanHours: number): Promise<void> {
        const { getDatabase } = await import("@/data/db");
        const db = getDatabase();
        const cutoff = new Date(
            Date.now() - olderThanHours * 60 * 60 * 1000
        ).toISOString();
        db.runSync(
            `DELETE FROM anomaly_history
             WHERE patient_id = ? AND timestamp < ?;`,
            patient_id,
            cutoff,
        );
    }

    private queryWindow(
        patient_id: string,
        cutoff: string | null
    ): HistoricalAnomalyEvent[] {
        // Synchronous path: import is dynamic so this file is safe to load
        // in environments where the DB module isn't initialized yet.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getDatabase } = require("@/data/db") as typeof import("@/data/db");
        const db = getDatabase();
        const rows = cutoff
            ? db.getAllSync<{
                  anomaly_type: string;
                  severity: number;
                  timestamp: string;
                  caregiver_confirmed: number;
              }>(
                  `SELECT anomaly_type, severity, timestamp, caregiver_confirmed
                   FROM anomaly_history
                   WHERE patient_id = ? AND timestamp >= ?
                   ORDER BY timestamp DESC;`,
                  patient_id,
                  cutoff
              )
            : db.getAllSync<{
                  anomaly_type: string;
                  severity: number;
                  timestamp: string;
                  caregiver_confirmed: number;
              }>(
                  `SELECT anomaly_type, severity, timestamp, caregiver_confirmed
                   FROM anomaly_history
                   WHERE patient_id = ?
                   ORDER BY timestamp DESC;`,
                  patient_id
              );

        return rows.map((row) => ({
            patient_id,
            timestamp_iso: row.timestamp,
            post_hitl_anomaly_type: row.anomaly_type as PostHitlAnomalyType,
            final_severity: row.severity as Severity,
            caregiver_confirmed: row.caregiver_confirmed === 1,
        }));
    }
}

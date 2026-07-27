/**
 * Unified clinical knowledge bundle runner.
 *
 * Coordinates condition + medication + SDOH packs under a single lifecycle so
 * the UI does not flip to "complete" while DailyMed/OpenFDA are still running.
 * Owns bundle status + throttled snapshot refresh for progress bars.
 *
 * Skips network re-pull when the patient's clinical fingerprint is unchanged
 * and literature was bundled successfully within the last 24 hours (unless
 * `force: true`).
 */

import {
  getActiveMedications,
  getConditionsForPatient,
  getDatabase,
  getKnowledgeCacheStats,
  getBundleStatus,
  setBundlePending,
  setBundleStatus,
  type BundleStatus,
} from '@/data';
import {
  bundleConditionPack,
  bundleMedicationPack,
  bundleSdohPack,
  type BundleProgressUpdate,
} from './condition-bundler';

/** Fresh literature is reusable for one day when patient clinical inputs match. */
export const KNOWLEDGE_BUNDLE_FRESHNESS_MS = 24 * 60 * 60 * 1000;

const FINGERPRINT_KEY_PREFIX = 'knowledge_bundle_meta:';

type BundleMeta = {
  fingerprint: string;
  bundledAt: string;
  chunksAdded: number;
};

function refreshUi(patientId: string): void {
  // Dynamic import avoids a static cycle with patient-record-context.
  void import('@/contexts/patient-record-context')
    .then(({ refreshPatientRecord }) => {
      try {
        refreshPatientRecord(patientId);
      } catch {
        // Provider may not be mounted yet (seed path) — status still persists.
      }
    })
    .catch(() => {
      // ignore
    });
}

export type KnowledgeBundleResult = {
  chunksAdded: number;
  errors: string[];
  /** True when network packs were skipped due to fresh cache + same fingerprint. */
  skipped?: boolean;
};

export type RunKnowledgeBundleOptions = {
  location?: string;
  /** Bypass freshness/fingerprint skip (developer re-download). */
  force?: boolean;
  /** Extra progress sink (e.g. developer settings local state). */
  onProgress?: (update: BundleProgressUpdate & { progress: number }) => void;
};

/**
 * Stable hash of the clinical inputs that drive condition/med/SDOH packs.
 * Exported for tests.
 */
export function buildKnowledgeBundleFingerprint(
  patientId: string,
  location?: string,
): string {
  const conditions = getConditionsForPatient(patientId)
    .filter((c) => !c.needsReview)
    .map((c) =>
      [
        (c.icd10 ?? '').trim().toUpperCase(),
        c.name.trim().toLowerCase(),
        c.conditionRole ?? '',
      ].join('|'),
    )
    .sort();

  const meds = getActiveMedications(patientId)
    .map((m) =>
      [
        m.name.trim().toLowerCase(),
        (m.dosage ?? '').trim().toLowerCase(),
        (m.frequency ?? '').trim().toLowerCase(),
      ].join('|'),
    )
    .sort();

  const loc = (location ?? '').trim().toLowerCase();
  const payload = JSON.stringify({ conditions, meds, location: loc });
  return simpleHash(payload);
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

function metaKey(patientId: string): string {
  return `${FINGERPRINT_KEY_PREFIX}${patientId}`;
}

function readBundleMeta(patientId: string): BundleMeta | null {
  try {
    const db = getDatabase();
    const row = db.getFirstSync<{ value_json: string }>(
      `SELECT value_json FROM app_settings WHERE key = ?;`,
      metaKey(patientId),
    );
    if (!row?.value_json) return null;
    const parsed = JSON.parse(row.value_json) as BundleMeta;
    if (!parsed?.fingerprint || !parsed?.bundledAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeBundleMeta(patientId: string, meta: BundleMeta): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.runSync(
    `INSERT OR REPLACE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?);`,
    metaKey(patientId),
    JSON.stringify(meta),
    now,
  );
}

/** Literature / remote evidence only (excludes care-plan narrative rows). */
export function countLiteratureChunks(patientId: string): number {
  const stats = getKnowledgeCacheStats(patientId);
  const preserved = (stats.bySource['adcp_plan'] ?? 0) + (stats.bySource['patient-record'] ?? 0);
  return Math.max(0, stats.total - preserved);
}

/**
 * Whether automatic bundling can reuse the existing cache.
 * Exported for tests.
 */
export function shouldSkipKnowledgeBundle(
  patientId: string,
  options: { location?: string; force?: boolean; nowMs?: number } = {},
): { skip: boolean; reason: string; fingerprint: string } {
  const fingerprint = buildKnowledgeBundleFingerprint(patientId, options.location);
  if (options.force) {
    return { skip: false, reason: 'force', fingerprint };
  }

  const nowMs = options.nowMs ?? Date.now();
  const status = getBundleStatus(patientId);
  if (status.state === 'failed') {
    return { skip: false, reason: 'previous_failed', fingerprint };
  }
  if (status.state === 'in_flight') {
    const updatedMs = status.updatedAt ? Date.parse(status.updatedAt) : NaN;
    // Only treat as concurrent if the in-flight marker is recent; otherwise
    // a crashed run would permanently block refresh.
    if (Number.isFinite(updatedMs) && nowMs - updatedMs < 15 * 60 * 1000) {
      return { skip: true, reason: 'already_in_flight', fingerprint };
    }
    return { skip: false, reason: 'stale_in_flight', fingerprint };
  }

  const literature = countLiteratureChunks(patientId);
  if (literature <= 0) {
    return { skip: false, reason: 'empty_literature', fingerprint };
  }

  const meta = readBundleMeta(patientId);
  if (!meta) {
    return { skip: false, reason: 'no_meta', fingerprint };
  }
  if (meta.fingerprint !== fingerprint) {
    return { skip: false, reason: 'fingerprint_changed', fingerprint };
  }

  const bundledAtMs = Date.parse(meta.bundledAt);
  if (!Number.isFinite(bundledAtMs)) {
    return { skip: false, reason: 'bad_timestamp', fingerprint };
  }
  if (nowMs - bundledAtMs > KNOWLEDGE_BUNDLE_FRESHNESS_MS) {
    return { skip: false, reason: 'stale', fingerprint };
  }

  return { skip: true, reason: 'fresh_unchanged', fingerprint };
}

function selectConditionCount(patientId: string): number {
  const conditions = getConditionsForPatient(patientId).filter((c) => !c.needsReview);
  const hasRoles = conditions.some((c) => Boolean(c.conditionRole));
  if (!hasRoles) return Math.max(conditions.length, 0);
  let n = 0;
  if (conditions.some((c) => c.conditionRole === 'primary_diagnosis')) n += 1;
  n += conditions.filter((c) => c.conditionRole === 'active_comorbidity').length;
  return n;
}

function estimateTotalSteps(patientId: string): number {
  const conditionSteps = selectConditionCount(patientId) + 1; // + curated
  const medSteps = Math.max(getActiveMedications(patientId).length, 1);
  const sdohSteps = 1;
  return conditionSteps + medSteps + sdohSteps;
}

/**
 * Run the full knowledge download for a patient with unified progress.
 * Safe to fire-and-forget; always clears in_flight in finally (unless skipped).
 */
export async function runKnowledgeBundle(
  patientId: string,
  options: RunKnowledgeBundleOptions = {},
): Promise<KnowledgeBundleResult> {
  const decision = shouldSkipKnowledgeBundle(patientId, {
    location: options.location,
    force: options.force,
  });

  if (decision.skip) {
    const liveTotal = getKnowledgeCacheStats(patientId).total;
    const meta = readBundleMeta(patientId);
    const status: BundleStatus = {
      state: 'complete',
      chunksAdded: meta?.chunksAdded ?? liveTotal,
      progress: 1,
      phase:
        decision.reason === 'already_in_flight'
          ? 'Download already in progress'
          : 'Using cached clinical knowledge',
    };
    setBundlePending(patientId, false);
    // Don't clobber an in-flight status from a concurrent run.
    if (decision.reason !== 'already_in_flight') {
      setBundleStatus(patientId, status);
      refreshUi(patientId);
    }
    console.log(
      `[knowledge-bundle] Skipped for ${patientId}: ${decision.reason} ` +
        `(${liveTotal} chunks, fp=${decision.fingerprint.slice(0, 8)})`,
    );
    return { chunksAdded: liveTotal, errors: [], skipped: true };
  }

  const fingerprint = decision.fingerprint;
  const totalSteps = estimateTotalSteps(patientId);
  const errors: string[] = [];
  let chunksAdded = 0;
  let lastRefreshAt = 0;
  let lastStatusWriteAt = 0;

  const writeStatus = (partial: Omit<BundleStatus, 'updatedAt'>, forceWrite = false) => {
    const now = Date.now();
    if (!forceWrite && now - lastStatusWriteAt < 250) return;
    lastStatusWriteAt = now;
    setBundleStatus(patientId, partial);
    if (forceWrite || now - lastRefreshAt >= 400) {
      lastRefreshAt = now;
      refreshUi(patientId);
    }
  };

  const publishProgress = (update: BundleProgressUpdate) => {
    const progress =
      totalSteps > 0
        ? Math.min(0.99, update.completedSteps / totalSteps)
        : 0;
    chunksAdded = Math.max(chunksAdded, update.chunksAdded);
    const liveTotal = getKnowledgeCacheStats(patientId).total;
    writeStatus({
      state: 'in_flight',
      chunksAdded: Math.max(chunksAdded, liveTotal),
      progress,
      phase: update.phase,
      completedSteps: update.completedSteps,
      totalSteps: update.totalSteps,
    });
    options.onProgress?.({ ...update, progress, chunksAdded: Math.max(chunksAdded, liveTotal) });
  };

  setBundlePending(patientId, true);
  writeStatus(
    {
      state: 'in_flight',
      chunksAdded: countLiteratureChunks(patientId),
      progress: 0,
      phase: 'Starting clinical knowledge download',
      completedSteps: 0,
      totalSteps,
    },
    true,
  );

  const conditionSteps = selectConditionCount(patientId) + 1;
  const medSteps = Math.max(getActiveMedications(patientId).length, 1);

  try {
    // Conditions first (highest value for Concierge), then meds + SDOH.
    try {
      const n = await bundleConditionPack(patientId, {
        manageLifecycle: false,
        stepOffset: 0,
        totalSteps,
        onProgress: publishProgress,
      });
      chunksAdded += n;
    } catch (e) {
      errors.push(`condition: ${e instanceof Error ? e.message : String(e)}`);
    }

    try {
      const n = await bundleMedicationPack(patientId, {
        manageLifecycle: false,
        stepOffset: conditionSteps,
        totalSteps,
        onProgress: publishProgress,
      });
      chunksAdded += n;
    } catch (e) {
      errors.push(`medication: ${e instanceof Error ? e.message : String(e)}`);
    }

    try {
      const n = await bundleSdohPack(patientId, options.location, {
        manageLifecycle: false,
        stepOffset: conditionSteps + medSteps,
        totalSteps,
        onProgress: publishProgress,
      });
      chunksAdded += n;
    } catch (e) {
      errors.push(`sdoh: ${e instanceof Error ? e.message : String(e)}`);
    }
  } finally {
    const liveTotal = getKnowledgeCacheStats(patientId).total;
    const literature = countLiteratureChunks(patientId);
    const finalChunks = Math.max(chunksAdded, liveTotal);

    const status: BundleStatus =
      literature > 0
        ? {
            state: 'complete',
            chunksAdded: finalChunks,
            progress: 1,
            phase: 'Complete',
            error: errors.length > 0 ? errors.join('; ') : undefined,
            completedSteps: totalSteps,
            totalSteps,
          }
        : errors.length > 0
          ? {
              state: 'failed',
              chunksAdded: 0,
              progress: 1,
              phase: 'Failed',
              error: errors.join('; '),
              completedSteps: totalSteps,
              totalSteps,
            }
          : {
              state: 'complete',
              chunksAdded: 0,
              progress: 1,
              phase: 'Complete',
              completedSteps: totalSteps,
              totalSteps,
            };

    if (status.state === 'complete' && literature > 0) {
      writeBundleMeta(patientId, {
        fingerprint,
        bundledAt: new Date().toISOString(),
        chunksAdded: finalChunks,
      });
    }

    setBundlePending(patientId, false);
    setBundleStatus(patientId, status);
    refreshUi(patientId);
    console.log(
      `[knowledge-bundle] Finished for ${patientId}: ${status.state} (${finalChunks} chunks` +
        (errors.length ? `, ${errors.length} errors` : '') +
        `, fp=${fingerprint.slice(0, 8)})`,
    );
  }

  return { chunksAdded: Math.max(chunksAdded, getKnowledgeCacheStats(patientId).total), errors };
}

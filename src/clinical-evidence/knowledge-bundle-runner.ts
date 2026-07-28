/**
 * Unified clinical knowledge bundle runner.
 *
 * Always the global on-device pack path: installs/updates the device-wide
 * knowledge pack (union of ALL stored patient records) and seeds the
 * per-patient curated overlay. The legacy multi-host live bundler is retired;
 * switching profiles only swaps the overlay and checks for deltas.
 */

import {
  getAllActiveMedications,
  getAllConditions,
  getConditionsForPatient,
  getDatabase,
  getKnowledgeCacheStats,
  getBundleStatus,
  setBundlePending,
  setBundleStatus,
} from '@/data';
import { type BundleProgressUpdate } from './condition-bundler';
import { seedCuratedKnowledgePacks } from './curated-knowledge-packs';

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
  /**
   * profile_switch — overlay swap only when pack is ready (never full reinstall).
   * Other reasons may refresh med layers on a true union fingerprint delta.
   */
  reason?: 'profile_switch' | 'import' | 'med_change' | 'manual' | 'retry';
  /** Extra progress sink (e.g. developer settings local state). */
  onProgress?: (update: BundleProgressUpdate & { progress: number }) => void;
};

/**
 * Stable hash of the clinical inputs that drive condition/med/SDOH packs.
 * Covers ALL stored patient records (union) to match pack inputs.
 * Exported for tests.
 */
export function buildKnowledgeBundleFingerprint(
  patientId: string,
  location?: string,
): string {
  void patientId; // Kept for API compatibility; fingerprint is record-union scoped.
  const conditions = getAllConditions()
    .filter((c) => !c.needsReview)
    .map((c) =>
      [
        (c.icd10 ?? '').trim().toUpperCase(),
        c.name.trim().toLowerCase(),
        c.conditionRole ?? '',
      ].join('|'),
    )
    .sort();

  const meds = getAllActiveMedications()
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

function markPatientPackReady(patientId: string, totalChunks: number): void {
  setBundlePending(patientId, false);
  const current = getBundleStatus(patientId);
  if (
    current.state === 'complete' &&
    current.chunksAdded === totalChunks &&
    current.progress === 1
  ) {
    return;
  }
  setBundleStatus(patientId, {
    state: 'complete',
    chunksAdded: totalChunks,
    progress: 1,
    phase: 'Clinical knowledge pack ready',
  });
  refreshUi(patientId);
}

/** Primary path: global pack (union of all stored records) + patient overlay. */
async function runPackAsBundle(
  patientId: string,
  options: RunKnowledgeBundleOptions,
): Promise<KnowledgeBundleResult> {
  const overlayConditions = getConditionsForPatient(patientId)
    .filter((c) => !c.needsReview)
    .map((c) => c.name)
    .filter(Boolean);

  // Pack content inputs cover EVERY stored patient record so switching
  // profiles never re-downloads shared content — only true deltas install.
  const conditions = [
    ...new Set(
      getAllConditions()
        .filter((c) => !c.needsReview)
        .map((c) => c.name)
        .filter(Boolean),
    ),
  ];
  const medications = getAllActiveMedications()
    .map((m) => m.name)
    .filter(Boolean);

  const {
    runKnowledgePackInstall,
    isPackReady,
    countPackChunks,
    getPackState,
    updatePackState,
    MED_SCOPED_PACK_LAYER_IDS,
  } = await import('@/clinical-evidence/pack');
  const { buildMedicationSeedsFingerprint } = await import(
    '@/clinical-evidence/pack/pack-seeds'
  );

  const medFp = buildMedicationSeedsFingerprint(medications);
  const packState = getPackState();
  const priorFp = packState.medicationsFingerprint ?? null;
  const medsUntracked = priorFp == null;
  const medsChanged = priorFp != null && priorFp !== medFp;
  const packReady = isPackReady();
  const isProfileSwitch = options.reason === 'profile_switch';
  const medLayerChunks = packState.layers.meds_base?.chunkCount ?? 0;
  // Med-layer delta: union fingerprint changed, or first track with chart meds
  // but an empty meds_base (install ran before any patient meds were present).
  const needsMedLayerDelta =
    packReady &&
    !options.force &&
    (medsChanged || (medsUntracked && medications.length > 0 && medLayerChunks === 0));

  // Patient overlay: curated CPG/gaps for the current patient only.
  try {
    seedCuratedKnowledgePacks(patientId, overlayConditions);
  } catch {
    /* non-fatal */
  }

  // Healthy pack shortcuts — never a full graph/vector reinstall.
  if (packReady && !options.force) {
    const total = countPackChunks();

    // Profile switch: overlay swap only. Stamp fingerprint bookkeeping if
    // missing so the next switch stays silent (do not re-download).
    if (isProfileSwitch) {
      if (medsUntracked) {
        updatePackState({ medicationsFingerprint: medFp });
      }
      markPatientPackReady(patientId, total);
      return { chunksAdded: total, errors: [], skipped: true };
    }

    // Known fingerprint, unchanged union → silent.
    if (!medsChanged && !medsUntracked) {
      markPatientPackReady(patientId, total);
      return { chunksAdded: total, errors: [], skipped: true };
    }

    // First fingerprint after an install that already has med content (or no
    // chart meds at all): stamp only. If chart meds exist but meds_base is
    // empty, fall through so the med layer actually downloads once.
    if (medsUntracked && (medications.length === 0 || medLayerChunks > 0)) {
      updatePackState({ medicationsFingerprint: medFp });
      markPatientPackReady(patientId, total);
      return { chunksAdded: total, errors: [], skipped: true };
    }
    // else: needsMedLayerDelta → med-layer refresh below.
  }

  // Real install / med-layer delta below — show visible progress.
  const medLayerOnly = needsMedLayerDelta;
  setBundlePending(patientId, true);
  setBundleStatus(patientId, {
    state: 'in_flight',
    chunksAdded: medLayerOnly ? countPackChunks() : 0,
    progress: medLayerOnly ? 0.15 : 0,
    phase: medLayerOnly
      ? 'Updating medication clinical knowledge…'
      : 'Installing on-device clinical knowledge pack…',
  });
  refreshUi(patientId);

  try {
    const result = await runKnowledgePackInstall({
      conditions,
      medications,
      location: options.location,
      // Full force only for explicit re-download. Med deltas force only the
      // listed content layers; embeds stay incremental (missing vectors only).
      force: options.force === true,
      forceContentLayers: medLayerOnly,
      layerIds: medLayerOnly ? [...MED_SCOPED_PACK_LAYER_IDS] : undefined,
      partialUpdate: medLayerOnly,
      onProgress: (ui) => {
        setBundleStatus(patientId, {
          state: 'in_flight',
          chunksAdded: ui.chunksInstalled,
          progress: medLayerOnly ? Math.max(0.15, ui.overall) : ui.overall,
          phase:
            ui.sections.find((s) => s.state === 'running')?.label ??
            (medLayerOnly
              ? 'Updating medication clinical knowledge…'
              : 'Installing clinical knowledge…'),
          completedSteps: ui.sections.filter((s) => s.state === 'done').length,
          totalSteps: ui.sections.length,
        });
        options.onProgress?.({
          phase:
            ui.sections.find((s) => s.state === 'running')?.label ??
            'Installing clinical knowledge…',
          completedSteps: ui.sections.filter((s) => s.state === 'done').length,
          totalSteps: ui.sections.length,
          chunksAdded: ui.chunksInstalled,
          progress: ui.overall,
        });
        refreshUi(patientId);
      },
    });

    updatePackState({ medicationsFingerprint: medFp });

    setBundleStatus(patientId, {
      state: result.ready ? 'complete' : 'failed',
      chunksAdded: result.chunksInstalled,
      progress: result.ready ? 1 : 0.5,
      phase: result.ready
        ? medLayerOnly
          ? 'Medication clinical knowledge updated'
          : 'Clinical knowledge pack ready'
        : result.errors.join('; ') || 'Pack install incomplete',
      error: result.ready ? undefined : result.errors.join('; '),
    });
    setBundlePending(patientId, false);
    refreshUi(patientId);
    return {
      chunksAdded: result.chunksInstalled,
      errors: result.errors,
      skipped: false,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setBundleStatus(patientId, {
      state: 'failed',
      chunksAdded: 0,
      progress: 0,
      phase: 'Clinical knowledge pack failed',
      error: msg,
    });
    setBundlePending(patientId, false);
    refreshUi(patientId);
    return { chunksAdded: 0, errors: [msg], skipped: false };
  }
}

const medSyncTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Debounced refresh after med add/edit/remove (or FHIR med list change).
 * Safe to fire-and-forget from UI / orchestrator tools.
 */
export function scheduleMedicationKnowledgeSync(patientId: string): void {
  const id = patientId.trim();
  if (!id) return;
  const prev = medSyncTimers.get(id);
  if (prev) clearTimeout(prev);
  medSyncTimers.set(
    id,
    setTimeout(() => {
      medSyncTimers.delete(id);
      void runKnowledgeBundle(id, { reason: 'med_change' }).catch((err) => {
        console.warn(
          '[knowledge-bundle] Medication knowledge sync failed:',
          err instanceof Error ? err.message : err,
        );
      });
    }, 750),
  );
}

/**
 * Run the knowledge flow for a patient with unified progress.
 * Always the global pack path: installs/updates the device-wide pack (union
 * of all stored records) and seeds the per-patient curated overlay.
 * Profile switches on a healthy pack are silent skips. Safe to fire-and-forget.
 */
export async function runKnowledgeBundle(
  patientId: string,
  options: RunKnowledgeBundleOptions = {},
): Promise<KnowledgeBundleResult> {
  return runPackAsBundle(patientId, options);
}

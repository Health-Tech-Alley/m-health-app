/**
 * KnowledgePackRunner — fetch → normalize → pack DB → graph → embeds (doc 42).
 */

import { getAppSettings } from '@/data/repositories/appSettingsRepository';
import { setLiveClinicalFetch } from '@/clinical-evidence/fixture-mode';

import {
  getDefaultContentLayerIds,
  PACK_LAYER_CATALOG,
  PACK_SIZE_HARD_CAP_BYTES,
} from './catalog';
import { PACK_LAYER_MIN_CHUNKS } from './pack-seeds';
import { embedPackChunks } from './embed-layer';
import { rebuildPackEvidenceGraph } from './graph-rebuild';
import {
  countPackChunks,
  estimatePackOnDiskBytes,
  getPackSizeBytes,
  replaceLayerChunks,
  resetPackDatabase,
} from './pack-db';
import {
  clearPackState,
  getPackState,
  updatePackState,
} from './pack-state';
import {
  getKnowledgePackInstallState,
  markPackSection,
  patchKnowledgePackInstallState,
  refreshPackInstallMetrics,
  resetKnowledgePackInstallUi,
  setKnowledgePackInstallState,
} from './pack-install-store';
import type {
  PackChunkRow,
  PackLayerId,
  PackRunnerOptions,
  PackRunnerResult,
} from './types';

import { fetchSpineLayer } from './fetch/spine-layer';
import { fetchCpgLayer } from './fetch/cpg-layer';
import { fetchMedlinePlusLayer } from './fetch/medlineplus-layer';
import { fetchOrphanetLayer } from './fetch/orphanet-layer';
import { fetchPublicHealthLayer } from './fetch/public-health-layer';
import { fetchMedsBaseLayer } from './fetch/dailymed-layer';
import { fetchDdiLayer } from './fetch/ddi-layer';
import { fetchDmeLayer } from './fetch/dme-layer';
import { fetchLitLiteLayer } from './fetch/pubmed-lite-layer';
import { fetchOpenFdaLayer } from './fetch/openfda-layer';
import { fetchSdohLayer } from './fetch/sdoh-layer';

let activeRun: { cancelled: boolean } | null = null;

/**
 * The global pack is the only clinical knowledge system — always enabled.
 * (The legacy multi-host live bundler flag was retired.)
 */
export function isKnowledgePackRunnerEnabled(): boolean {
  return true;
}

export function cancelKnowledgePackInstall(): void {
  if (activeRun) activeRun.cancelled = true;
  patchKnowledgePackInstallState({
    status: getPackState().ready ? 'ready' : 'failed',
    lastError: 'Cancelled',
  });
}

async function runContentLayer(
  id: PackLayerId,
  opts: PackRunnerOptions,
): Promise<{ chunkCount: number; version: string; contentHash: string }> {
  const conditions = opts.conditions ?? [];
  const medications = opts.medications ?? [];
  markPackSection(id, { state: 'running', progress01: 0.1, detail: 'Downloading…' });

  let version = '1.0.0';
  let rows: Parameters<typeof replaceLayerChunks>[2] = [];

  switch (id) {
    case 'spine': {
      const r = await fetchSpineLayer(conditions);
      version = r.version;
      rows = r.rows;
      break;
    }
    case 'cpg': {
      const r = await fetchCpgLayer(conditions);
      version = r.version;
      rows = r.rows;
      break;
    }
    case 'medlineplus': {
      markPackSection('medlineplus', { state: 'running', progress01: 0.2, detail: 'Fetching condition topics…' });
      const r = await fetchMedlinePlusLayer(conditions, medications);
      version = r.version;
      rows = r.rows;
      markPackSection('medlineplus', { state: 'running', progress01: 0.8, detail: `${rows.length} topics` });
      break;
    }
    case 'orphanet': {
      const r = await fetchOrphanetLayer(conditions);
      version = r.version;
      rows = r.rows;
      break;
    }
    case 'public_health': {
      const r = await fetchPublicHealthLayer(conditions);
      version = r.version;
      rows = r.rows;
      break;
    }
    case 'meds_base': {
      const r = await fetchMedsBaseLayer(medications, {
        signal: opts.signal,
        onProgress: (p) => {
          const prog = p.total > 0 ? 0.1 + 0.8 * (p.done / p.total) : 0.1;
          markPackSection('meds_base', {
            state: 'running',
            progress01: Math.min(0.95, prog),
            detail: p.drug
              ? `${Math.min(p.done + 1, p.total)}/${p.total} · ${p.drug}`
              : `${p.done}/${p.total}`,
          });
          opts.onProgress?.(getKnowledgePackInstallState());
        },
      });
      version = r.version;
      rows = r.rows;
      break;
    }
    case 'ddi': {
      markPackSection('ddi', { state: 'running', progress01: 0.2, detail: 'Resolving drug names…' });
      const r = await fetchDdiLayer(medications);
      version = r.version;
      rows = r.rows;
      break;
    }
    case 'dme': {
      const r = await fetchDmeLayer(conditions);
      version = r.version;
      rows = r.rows;
      break;
    }
    case 'lit_lite': {
      markPackSection('lit_lite', { state: 'running', progress01: 0.2, detail: 'Fetching abstracts…' });
      const r = await fetchLitLiteLayer(conditions, {
        signal: opts.signal,
        onProgress: (p) => {
          const prog = p.total > 0 ? 0.2 + 0.7 * (p.done / p.total) : 0.2;
          markPackSection('lit_lite', {
            state: 'running',
            progress01: Math.min(0.9, prog),
            detail: `${Math.min(p.done + 1, p.total)}/${p.total} queries · ${p.chunks} abstracts`,
          });
          opts.onProgress?.(getKnowledgePackInstallState());
        },
      });
      version = r.version;
      rows = r.rows;
      markPackSection('lit_lite', { state: 'running', progress01: 0.9, detail: `${rows.length} abstracts` });
      break;
    }
    case 'openfda': {
      markPackSection('openfda', { state: 'running', progress01: 0.3, detail: 'Fetching FDA safety data…' });
      const r = await fetchOpenFdaLayer(medications);
      version = r.version;
      rows = r.rows;
      break;
    }
    case 'sdoh': {
      const r = await fetchSdohLayer(opts.location);
      version = r.version;
      rows = r.rows;
      break;
    }
    default:
      throw new Error(`Not a content layer: ${id}`);
  }

  if (opts.signal?.cancelled) {
    markPackSection(id, { state: 'failed', error: 'Cancelled' });
    return { chunkCount: 0, version, contentHash: '' };
  }

  markPackSection(id, { state: 'running', progress01: 0.7, detail: 'Saving…' });
  const written = replaceLayerChunks(id, version, rows);
  logLayerDepth(id, written);
  const contentHash = written[0]?.contentHash ?? `${id}:${written.length}`;
  markPackSection(id, {
    state: 'done',
    progress01: 1,
    detail: `${written.length} chunks`,
  });
  return { chunkCount: written.length, version, contentHash };
}

/** Log per-layer text depth so 3MB outcomes are diagnosable. */
function logLayerDepth(layerId: string, rows: PackChunkRow[]): void {
  const chars = rows.reduce((n, r) => n + r.text.length, 0);
  console.log(
    `[pack-runner] ${layerId} wrote ${rows.length} rows ≈${Math.round(chars / 1024)}KB text`,
  );
}

/**
 * Install or repair the global knowledge pack.
 */
export async function runKnowledgePackInstall(
  options: PackRunnerOptions = {},
): Promise<PackRunnerResult> {
  if (activeRun && !activeRun.cancelled) {
    return {
      chunksInstalled: countPackChunks(),
      layersUpdated: [],
      errors: ['Install already in progress'],
      ready: getPackState().ready,
    };
  }

  const signal = options.signal ?? { cancelled: false };
  activeRun = signal;

  // Honor Settings → Live clinical evidence (NLM). Default ON (first onboarding).
  const wantLive = getAppSettings().liveClinicalFetch !== false;
  setLiveClinicalFetch(wantLive);

  const contentIds =
    options.layerIds?.filter((id) =>
      PACK_LAYER_CATALOG.some((l) => l.id === id && l.isContent),
    ) ?? getDefaultContentLayerIds();
  const targeted = new Set(contentIds);
  const forceContent =
    options.force === true || options.forceContentLayers === true;
  // Partial med-layer refresh must not force-re-embed the whole curated set.
  const forceEmbeds = options.force === true && !options.partialUpdate;

  const errors: string[] = [];
  const layersUpdated: PackLayerId[] = [];
  /** When true, activeRun is cleared by the background embed job, not finally. */
  let embedsDeferred = false;

  if (options.partialUpdate) {
    // Keep already-installed sections marked done so overall progress does not
    // jump back to 0% (profile-adjacent med deltas, not a full reinstall).
    const state = getPackState();
    resetKnowledgePackInstallUi('in_flight');
    for (const layer of PACK_LAYER_CATALOG) {
      if (layer.isContent && !targeted.has(layer.id)) {
        const cached = state.layers[layer.id];
        markPackSection(layer.id, {
          state: 'done',
          progress01: 1,
          detail: cached
            ? `Cached v${cached.version} (${cached.chunkCount} chunks)`
            : 'Unchanged',
        });
      }
    }
    patchKnowledgePackInstallState({
      status: 'in_flight',
      lastError: null,
      chunksInstalled: countPackChunks(),
    });
  } else {
    resetKnowledgePackInstallUi('in_flight');
    patchKnowledgePackInstallState({ status: 'in_flight', overall: 0, lastError: null });
  }

  const publish = () => {
    const ui = getKnowledgePackInstallState();
    options.onProgress?.(ui);
  };
  publish();

  try {
    for (const id of contentIds) {
      if (signal.cancelled) break;
      const existing = getPackState().layers[id];
      const minChunks = PACK_LAYER_MIN_CHUNKS[id] ?? 1;
      const cachedCount = existing?.chunkCount ?? 0;
      // Skip only when cache is "fat enough". Thin packs (silent live fail →
      // tiny fallbacks) must re-fetch without requiring a full reset.
      if (existing && !forceContent && cachedCount >= minChunks) {
        markPackSection(id, {
          state: 'done',
          progress01: 1,
          detail: `Cached v${existing.version} (${cachedCount} chunks)`,
        });
        publish();
        continue;
      }
      if (existing && cachedCount < minChunks) {
        console.warn(
          `[pack-runner] Re-fetching thin layer ${id}: had ${cachedCount}, want ≥${minChunks}`,
        );
      }
      try {
        const result = await runContentLayer(id, { ...options, signal });
        layersUpdated.push(id);
        if (result.chunkCount < minChunks) {
          console.warn(
            `[pack-runner] Layer ${id} still thin after fetch: ${result.chunkCount} < ${minChunks}`,
          );
        }
        updatePackState({
          layers: {
            [id]: {
              version: result.version,
              contentHash: result.contentHash,
              installedAt: new Date().toISOString(),
              chunkCount: result.chunkCount,
            },
          },
          ready: false,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[pack-runner] Layer ${id} failed:`, msg);
        errors.push(`${id}: ${msg}`);
        markPackSection(id, { state: 'failed', error: msg, progress01: 0 });
      }
      refreshPackInstallMetrics();
      publish();

      const disk = Math.max(estimatePackOnDiskBytes(), getPackSizeBytes());
      if (disk > PACK_SIZE_HARD_CAP_BYTES) {
        errors.push('Pack exceeded hard size cap; stopping further layers');
        break;
      }
    }

    // Compact DB before final size measurement (deleted pages from prior runs).
    try {
      const { vacuumPackDatabase } = await import('./pack-db');
      vacuumPackDatabase();
    } catch {
      /* non-fatal */
    }

    // Graph
    if (!options.skipGraph && !signal.cancelled) {
      markPackSection('graph', { state: 'running', progress01: 0.2, detail: 'Building…' });
      publish();
      try {
        const edgeCount = rebuildPackEvidenceGraph();
        updatePackState({ graphRebuiltAt: new Date().toISOString() });
        markPackSection('graph', {
          state: 'done',
          progress01: 1,
          detail: `${edgeCount} edges`,
        });
        layersUpdated.push('graph');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`graph: ${msg}`);
        markPackSection('graph', { state: 'failed', error: msg });
      }
      publish();
    }

    // Content + graph is enough for BM25/graph retrieval. Mark pack ready
    // before dense vectors so install UX is not blocked on indexing.
    const totalAfterContent = countPackChunks();
    const hasSpine = Boolean(getPackState().layers.spine?.chunkCount);
    const contentReady =
      !signal.cancelled && hasSpine && totalAfterContent > 0;
    if (contentReady) {
      updatePackState({
        ready: true,
        lastError: errors.length > 0 ? errors.join('; ') : null,
      });
      refreshPackInstallMetrics();
      // Keep embeds section visible as running; overall pack is usable now.
      if (!options.skipEmbeds) {
        markPackSection('embeds', {
          state: 'running',
          progress01: 0,
          detail: 'Indexing in background…',
        });
      }
      setKnowledgePackInstallState({
        status: 'ready',
        overall: options.skipEmbeds ? 1 : Math.min(0.92, getKnowledgePackInstallState().overall),
        sections: getKnowledgePackInstallState().sections,
        lastError: errors.length > 0 ? errors.join('; ') : null,
        updatedAt: new Date().toISOString(),
        chunksInstalled: totalAfterContent,
        sizeBytes: getPackSizeBytes(),
      });
      publish();
    }

    const runEmbeds = async (): Promise<void> => {
      if (options.skipEmbeds || signal.cancelled) return;
      markPackSection('embeds', { state: 'running', progress01: 0, detail: 'Indexing…' });
      publish();
      try {
        const { embedderId, embedded } = await embedPackChunks({
          force: forceEmbeds,
          signal,
          onProgress: (p) => {
            const prog = p.total > 0 ? p.done / p.total : 0;
            markPackSection('embeds', {
              state: 'running',
              progress01: prog,
              detail: `${p.done}/${p.total}`,
            });
            publish();
          },
        });
        updatePackState({ embedderId });
        markPackSection('embeds', {
          state: 'done',
          progress01: 1,
          detail: `${embedded} vectors`,
        });
        layersUpdated.push('embeds');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`embeds: ${msg}`);
        markPackSection('embeds', { state: 'failed', error: msg });
      }
      publish();
    };

    // Full installs: embed in background so Home can leave "Updating…" after
    // content is ready. Partial med updates still await embeds (usually tiny).
    const deferEmbeds = contentReady && !options.partialUpdate && !options.skipEmbeds;
    if (deferEmbeds) {
      embedsDeferred = true;
      void runEmbeds()
        .then(() => {
          refreshPackInstallMetrics();
          const total = countPackChunks();
          setKnowledgePackInstallState({
            status: 'ready',
            overall: 1,
            sections: getKnowledgePackInstallState().sections,
            lastError: errors.length > 0 ? errors.join('; ') : null,
            updatedAt: new Date().toISOString(),
            chunksInstalled: total,
            sizeBytes: getPackSizeBytes(),
          });
          console.log(
            `[pack-runner] Background embeds finished chunks=${total} ` +
              `size≈${Math.round(getPackSizeBytes() / 1024 / 1024)}MB`,
          );
        })
        .catch((err) => {
          console.warn(
            '[pack-runner] Background embeds failed:',
            err instanceof Error ? err.message : err,
          );
        })
        .finally(() => {
          if (activeRun === signal) activeRun = null;
        });
    } else {
      await runEmbeds();
    }

    const total = countPackChunks();
    // Refresh metrics AFTER content (and embeds when not deferred).
    refreshPackInstallMetrics();
    const sizeBytes = getPackSizeBytes();
    const { getPackLayerStats } = await import('./pack-db');
    console.log(
      `[pack-runner] Install finish chunks=${total} size≈${Math.round(sizeBytes / 1024 / 1024)}MB` +
        (deferEmbeds ? ' (embeds continuing in background)' : ''),
    );
    for (const s of getPackLayerStats()) {
      console.log(
        `[pack-runner]   ${s.layer}: ${s.chunks} chunks ≈${Math.round(s.textChars / 1024)}KB text`,
      );
    }
    // Ready if spine present and we have some chunks (content is enough; embeds optional).
    const ready =
      contentReady ||
      (!signal.cancelled && hasSpine && total > 0);

    updatePackState({
      ready,
      lastError: errors.length > 0 ? errors.join('; ') : null,
    });

    // When embeds are deferred, keep status ready with overall < 1 until they finish.
    if (!embedsDeferred) {
      setKnowledgePackInstallState({
        status: ready ? 'ready' : errors.length > 0 ? 'failed' : 'ready',
        overall: ready ? 1 : getKnowledgePackInstallState().overall,
        sections: getKnowledgePackInstallState().sections,
        lastError: errors.length > 0 ? errors.join('; ') : null,
        updatedAt: new Date().toISOString(),
        chunksInstalled: total,
        sizeBytes,
      });
    }

    return {
      chunksInstalled: total,
      layersUpdated,
      errors,
      ready,
    };
  } finally {
    // Deferred embeds own clearing activeRun when they finish.
    if (!embedsDeferred && activeRun === signal) activeRun = null;
  }
}

/** Probe and refresh stale layers (Settings “Check for updates”). */
export async function checkForPackUpdates(
  options: PackRunnerOptions = {},
): Promise<PackRunnerResult> {
  // v1: force reinstall of default content layers that support remote probe
  const probeIds = PACK_LAYER_CATALOG.filter(
    (l) => l.isContent && l.defaultOn && l.supportsRemoteVersionProbe,
  ).map((l) => l.id);
  return runKnowledgePackInstall({
    ...options,
    force: true,
    layerIds: probeIds,
  });
}

/** Wipe global pack only — never patient overlay/CDA/ADCP. */
export async function resetKnowledgePack(
  options: PackRunnerOptions = {},
): Promise<PackRunnerResult> {
  resetPackDatabase();
  clearPackState();
  resetKnowledgePackInstallUi('idle');
  return runKnowledgePackInstall({ ...options, force: true });
}

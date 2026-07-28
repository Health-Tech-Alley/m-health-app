/**
 * Batch embed pack chunks with leaf-ir → float16 vectors (doc 42).
 *
 * Strategy:
 * 1. Probe TFLite once with a short string (serialized via embedder mutex).
 * 2. On probe failure, use padded HashMock for the whole pack and remember it
 *    so concurrent/re-run install paths do not spam TFLite errors.
 * 3. Only one pack embed job runs at a time (shared promise).
 */

import {
  createReadyEmbedder,
  getSharedTfliteEmbedder,
  HashMockEmbedder,
} from '@/knowledge/embedder';
import type { Embedder } from '@/knowledge/types';

import { PACK_EMBEDDER_ID, PACK_VECTOR_DIM, shouldEmbedPackLayer } from './catalog';
import { float32ArrayToFloat16Buffer } from './float16';
import {
  getAllPackChunks,
  getChunkIdsMissingVectors,
  upsertPackVectorsBatch,
} from './pack-db';

/**
 * Yield to the JS event loop less often. Each TFLite run is ~50–200ms; frequent
 * yields dominate wall time on large curated sets.
 */
const BATCH_YIELD_EVERY = 64;
/** Progress UI throttle (every N embeds) — avoid re-rendering 1:1 with TFLite. */
const PROGRESS_EVERY = 16;
/** SQLite write batch size (one transaction per batch). */
const VECTOR_WRITE_BATCH = 48;
/**
 * Truncate pack text for embed. leaf-ir max is 512 tokens; shorter inputs run
 * faster and are enough for top-50 dense rerank of curated digests.
 */
const EMBED_TEXT_MAX_CHARS = 320;
const MOCK_ID = `${PACK_EMBEDDER_ID}-mock`;

/** null = unprobed; sticky for process lifetime after first pack embed. */
let packEmbedBackend: 'tflite' | 'mock' | null = null;
let packEmbedJob: Promise<{ embedderId: string; embedded: number }> | null = null;

function paddedHashMockEmbedder(): Embedder {
  const mock = new HashMockEmbedder();
  return {
    dimensions: PACK_VECTOR_DIM,
    async embed(text, opts) {
      const v = await mock.embed(text, opts);
      const out = new Array(PACK_VECTOR_DIM).fill(0);
      for (let i = 0; i < PACK_VECTOR_DIM; i++) {
        out[i] = v[i % v.length] ?? 0;
      }
      return out;
    },
  };
}

async function tryLoadTfliteEmbedder(): Promise<Embedder | null> {
  try {
    const emb = await createReadyEmbedder(8_000, { allowDevelopmentFallback: false });
    if (emb.dimensions === PACK_VECTOR_DIM) return emb;
  } catch {
    /* fall through */
  }
  try {
    const shared = getSharedTfliteEmbedder();
    if (!shared.isReady()) {
      await shared.load();
    }
    if (shared.isReady() && shared.dimensions === PACK_VECTOR_DIM) {
      return shared;
    }
  } catch {
    /* Track A / Jest */
  }
  return null;
}

/**
 * Resolve pack embedder once. Probes native run before bulk work.
 */
async function resolvePackEmbedder(): Promise<{ embedder: Embedder; id: string }> {
  if (packEmbedBackend === 'mock') {
    return { embedder: paddedHashMockEmbedder(), id: MOCK_ID };
  }

  if (packEmbedBackend === 'tflite') {
    const emb = await tryLoadTfliteEmbedder();
    if (emb) return { embedder: emb, id: PACK_EMBEDDER_ID };
    packEmbedBackend = 'mock';
    return { embedder: paddedHashMockEmbedder(), id: MOCK_ID };
  }

  // Unprobed: try TFLite with a single short probe.
  const emb = await tryLoadTfliteEmbedder();
  if (emb) {
    try {
      await emb.embed('clinical knowledge pack probe', { isQuery: false });
      packEmbedBackend = 'tflite';
      return { embedder: emb, id: PACK_EMBEDDER_ID };
    } catch (err) {
      console.warn(
        '[pack-embed] TFLite run probe failed; using hash-mock for pack vectors.',
        err instanceof Error ? err.message : err,
      );
    }
  } else {
    console.warn('[pack-embed] TFLite embedder unavailable; using hash-mock for pack vectors.');
  }
  packEmbedBackend = 'mock';
  return { embedder: paddedHashMockEmbedder(), id: MOCK_ID };
}

function vectorToFloat16Blob(vec: number[]): Uint8Array {
  const f16 = float32ArrayToFloat16Buffer(vec.slice(0, PACK_VECTOR_DIM));
  if (f16.byteLength === PACK_VECTOR_DIM * 2) return f16;
  const buf = new Uint8Array(PACK_VECTOR_DIM * 2);
  buf.set(f16.subarray(0, buf.length));
  return buf;
}

export type EmbedProgress = {
  done: number;
  total: number;
};

async function embedPackChunksInner(opts?: {
  force?: boolean;
  onProgress?: (p: EmbedProgress) => void;
  signal?: { cancelled: boolean };
}): Promise<{ embedderId: string; embedded: number }> {
  let { embedder, id } = await resolvePackEmbedder();

  // Only curated layers get dense vectors (lit_lite excluded — see catalog).
  const embeddableIds = new Set(
    getAllPackChunks()
      .filter((c) => shouldEmbedPackLayer(c.packLayer))
      .map((c) => c.chunkId),
  );

  // Prefer missing vectors for the chosen backend; if force, all embeddable chunks.
  let ids = opts?.force
    ? [...embeddableIds]
    : getChunkIdsMissingVectors(id).filter((x) => embeddableIds.has(x));

  // If TFLite id has no missing but mock still missing (or vice versa), fill gaps.
  if (ids.length === 0 && !opts?.force) {
    const altId = id === MOCK_ID ? PACK_EMBEDDER_ID : MOCK_ID;
    const altMissing = getChunkIdsMissingVectors(altId);
    // Only backfill when primary is mock (we own mock vectors as the pack backend).
    if (id === MOCK_ID && altMissing.length > 0) {
      // All chunks already have mock? nothing to do. alt missing under tflite is fine.
    }
  }

  if (ids.length === 0 && opts?.force) {
    ids = [...embeddableIds];
  }

  const idSet = new Set(ids);
  // Prefer shorter digests first — they embed faster and cover spine/cpg/labels.
  const chunks = getAllPackChunks()
    .filter((c) => idSet.has(c.chunkId))
    .sort((a, b) => a.text.length - b.text.length);
  let embedded = 0;
  const total = chunks.length;
  let loggedRunError = false;
  const pendingWrites: {
    chunkId: string;
    embedderId: string;
    dim: number;
    vector: Uint8Array;
  }[] = [];

  const flushWrites = () => {
    if (pendingWrites.length === 0) return;
    upsertPackVectorsBatch(pendingWrites.splice(0, pendingWrites.length));
  };

  const t0 = Date.now();
  for (let i = 0; i < chunks.length; i++) {
    if (opts?.signal?.cancelled) break;
    const c = chunks[i];
    const text =
      c.text.length > EMBED_TEXT_MAX_CHARS
        ? c.text.slice(0, EMBED_TEXT_MAX_CHARS)
        : c.text;
    try {
      const vec = await embedder.embed(text, { isQuery: false });
      pendingWrites.push({
        chunkId: c.chunkId,
        embedderId: id,
        dim: PACK_VECTOR_DIM,
        vector: vectorToFloat16Blob(vec),
      });
      embedded++;
    } catch (err) {
      // Mid-batch TFLite failure → sticky switch to mock for remaining chunks.
      if (id !== MOCK_ID) {
        if (!loggedRunError) {
          loggedRunError = true;
          console.warn(
            '[pack-embed] TFLite run failed mid-batch; switching to hash-mock for remaining chunks.',
            err instanceof Error ? err.message : err,
          );
        }
        flushWrites();
        packEmbedBackend = 'mock';
        embedder = paddedHashMockEmbedder();
        id = MOCK_ID;
        try {
          const vec = await embedder.embed(text, { isQuery: false });
          pendingWrites.push({
            chunkId: c.chunkId,
            embedderId: id,
            dim: PACK_VECTOR_DIM,
            vector: vectorToFloat16Blob(vec),
          });
          embedded++;
        } catch (err2) {
          console.warn('[pack-embed] mock failed for', c.chunkId, err2);
        }
      } else if (!loggedRunError) {
        loggedRunError = true;
        console.warn('[pack-embed] mock embed failed for', c.chunkId, err);
      }
    }

    if (pendingWrites.length >= VECTOR_WRITE_BATCH) {
      flushWrites();
    }
    if ((i + 1) % PROGRESS_EVERY === 0 || i + 1 === total) {
      opts?.onProgress?.({ done: i + 1, total });
    }
    if ((i + 1) % BATCH_YIELD_EVERY === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  flushWrites();

  const ms = Date.now() - t0;
  console.log(
    `[pack-embed] done backend=${id} embedded=${embedded}/${total} ` +
      `textMax=${EMBED_TEXT_MAX_CHARS} ms=${ms}` +
      (total > 0 ? ` (~${Math.round(ms / total)}ms/chunk)` : ''),
  );

  return { embedderId: id, embedded };
}

/**
 * Embed missing (or all if force) pack chunks. Single-flight across callers.
 */
export async function embedPackChunks(opts?: {
  force?: boolean;
  onProgress?: (p: EmbedProgress) => void;
  signal?: { cancelled: boolean };
}): Promise<{ embedderId: string; embedded: number }> {
  if (packEmbedJob) {
    return packEmbedJob;
  }
  packEmbedJob = embedPackChunksInner(opts).finally(() => {
    packEmbedJob = null;
  });
  return packEmbedJob;
}

/** Test helper — reset sticky backend between suite cases. */
export function __resetPackEmbedBackendForTests(): void {
  packEmbedBackend = null;
  packEmbedJob = null;
}

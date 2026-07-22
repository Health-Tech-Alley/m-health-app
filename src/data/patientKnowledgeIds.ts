/**
 * Patient-scoped knowledge chunk identity helpers.
 *
 * Every literature / fixture / live-supplement chunk is stored once per patient:
 *   kc:{patientId}:{source}:{externalId}
 *
 * ADCP plan chunks keep the existing contract:
 *   adcp:{patientId}:…
 *
 * This guarantees profile switches never load another patient's corpus.
 */

const KC_PREFIX = 'kc:';
const ADCP_PREFIX = 'adcp:';

export function sanitizeKnowledgeIdPart(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._:@+-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 180);
}

/**
 * Build a patient-scoped chunk id. `externalId` should be stable within a
 * source (PMID, DailyMed setid, fixture docId, etc.).
 */
export function toPatientKnowledgeChunkId(
  patientId: string,
  source: string,
  externalId: string,
): string {
  const pid = sanitizeKnowledgeIdPart(patientId);
  const src = sanitizeKnowledgeIdPart(source || 'unknown');
  const ext = sanitizeKnowledgeIdPart(externalId || 'doc');
  if (!pid) {
    throw new Error('toPatientKnowledgeChunkId requires patientId');
  }
  // ADCP already uses adcp:{patientId}:… — do not double-prefix.
  if (ext.startsWith(`${ADCP_PREFIX}${pid}:`) || ext.startsWith(ADCP_PREFIX)) {
    return ext.startsWith(ADCP_PREFIX) ? ext : `${ADCP_PREFIX}${pid}:${ext}`;
  }
  if (ext.startsWith(`${KC_PREFIX}${pid}:`)) {
    return ext;
  }
  return `${KC_PREFIX}${pid}:${src}:${ext}`;
}

/** Extract patientId from a prefixed chunk id when present. */
export function patientIdFromKnowledgeChunkId(chunkId: string): string | null {
  if (!chunkId) return null;
  if (chunkId.startsWith(ADCP_PREFIX)) {
    const parts = chunkId.split(':');
    // adcp : patientId : …
    return parts.length >= 2 && parts[1] ? parts[1] : null;
  }
  if (chunkId.startsWith(KC_PREFIX)) {
    const parts = chunkId.split(':');
    // kc : patientId : source : external…
    return parts.length >= 2 && parts[1] ? parts[1] : null;
  }
  return null;
}

/** True when chunk id is already patient-scoped. */
export function isPatientScopedKnowledgeChunkId(chunkId: string): boolean {
  return Boolean(patientIdFromKnowledgeChunkId(chunkId));
}

/**
 * Strip patient prefix to recover the original external/source doc id when
 * possible (best-effort for citations / re-download).
 */
export function externalIdFromKnowledgeChunkId(chunkId: string): string {
  if (chunkId.startsWith(KC_PREFIX)) {
    const parts = chunkId.split(':');
    // kc : pid : source : rest…
    if (parts.length >= 4) return parts.slice(3).join(':');
    if (parts.length === 3) return parts[2];
  }
  if (chunkId.startsWith(ADCP_PREFIX)) {
    return chunkId;
  }
  return chunkId;
}

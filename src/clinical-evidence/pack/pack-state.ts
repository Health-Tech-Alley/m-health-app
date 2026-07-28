/**
 * Pack install state in app_settings (no patient snapshot fields).
 */

import { getDatabase } from '@/data/db';

import { PACK_LAYER_MIN_CHUNKS } from './pack-seeds';
import type { PackState } from './types';

const PACK_STATE_KEY = 'knowledge_pack_state';

const DEFAULT_STATE: PackState = {
  schema: 1,
  layers: {},
  embedderId: null,
  graphRebuiltAt: null,
  ready: false,
  lastError: null,
  updatedAt: new Date(0).toISOString(),
  medicationsFingerprint: null,
};

export function getPackState(): PackState {
  try {
    const db = getDatabase();
    const row = db.getFirstSync<{ value_json: string }>(
      'SELECT value_json FROM app_settings WHERE key = ?;',
      PACK_STATE_KEY,
    );
    if (!row?.value_json) return { ...DEFAULT_STATE, layers: {} };
    const parsed = JSON.parse(row.value_json) as Partial<PackState>;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      schema: 1,
      layers: { ...(parsed.layers ?? {}) },
      medicationsFingerprint: parsed.medicationsFingerprint ?? null,
    };
  } catch {
    return { ...DEFAULT_STATE, layers: {} };
  }
}

export function savePackState(state: PackState): void {
  const db = getDatabase();
  const next: PackState = {
    ...state,
    schema: 1,
    updatedAt: new Date().toISOString(),
  };
  db.runSync(
    `INSERT OR REPLACE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?);`,
    PACK_STATE_KEY,
    JSON.stringify(next),
    next.updatedAt,
  );
}

export function updatePackState(partial: Partial<PackState>): PackState {
  const current = getPackState();
  const next: PackState = {
    ...current,
    ...partial,
    layers: partial.layers ? { ...current.layers, ...partial.layers } : current.layers,
    schema: 1,
    updatedAt: new Date().toISOString(),
  };
  savePackState(next);
  return next;
}

export function clearPackState(): void {
  savePackState({ ...DEFAULT_STATE, layers: {}, updatedAt: new Date().toISOString() });
}

/** True when a prior install left a layer below its minimum chunk floor. */
export function packNeedsRepair(): boolean {
  const state = getPackState();
  for (const [id, min] of Object.entries(PACK_LAYER_MIN_CHUNKS)) {
    if (!min) continue;
    const n = state.layers[id as keyof typeof state.layers]?.chunkCount ?? 0;
    if (n < min) return true;
  }
  return false;
}

export function isPackReady(): boolean {
  return getPackState().ready === true && !packNeedsRepair();
}

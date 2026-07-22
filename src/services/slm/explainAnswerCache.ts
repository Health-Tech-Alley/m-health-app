/**
 * Session + durable cache for one-and-done Concierge explain answers.
 *
 * Keyed by a fingerprint of the prompt (built from current DB/snapshot data).
 * If the caregiver re-opens the same explain without changing underlying data,
 * the prompt fingerprints match and the cached answer is returned without
 * loading the SLM.
 *
 * Stored under a dedicated app_settings key (not patient snapshot / Redux).
 */

import { getDatabase } from '@/data/db';

const CACHE_KEY = 'slm_explain_answer_cache';
const MAX_ENTRIES = 40;

export type ExplainCacheEntry = {
  fingerprint: string;
  title: string;
  answer: string;
  cachedAt: string;
  patientId?: string;
};

type CacheStore = {
  entries: ExplainCacheEntry[];
};

function hashString(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Fingerprint of the explain request — stable iff title+prompt are unchanged. */
export function buildExplainFingerprint(params: {
  title: string;
  prompt: string;
  patientId?: string | null;
}): string {
  const raw = [
    params.patientId?.trim() ?? '',
    params.title.trim(),
    params.prompt.trim(),
  ].join('\u0001');
  return hashString(raw);
}

function readStore(): CacheStore {
  try {
    const db = getDatabase();
    const row = db.getFirstSync<{ value_json: string }>(
      'SELECT value_json FROM app_settings WHERE key = ?;',
      CACHE_KEY,
    );
    if (!row?.value_json) return { entries: [] };
    const parsed = JSON.parse(row.value_json) as CacheStore;
    if (!parsed || !Array.isArray(parsed.entries)) return { entries: [] };
    return { entries: parsed.entries.filter((e) => e?.fingerprint && e?.answer) };
  } catch {
    return { entries: [] };
  }
}

function writeStore(store: CacheStore): void {
  try {
    const db = getDatabase();
    db.runSync(
      `INSERT OR REPLACE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?);`,
      CACHE_KEY,
      JSON.stringify(store),
      new Date().toISOString(),
    );
  } catch {
    // Cache is best-effort — never block explain UX.
  }
}

export function getCachedExplainAnswer(fingerprint: string): ExplainCacheEntry | null {
  if (!fingerprint) return null;
  const store = readStore();
  return store.entries.find((e) => e.fingerprint === fingerprint) ?? null;
}

export function setCachedExplainAnswer(entry: Omit<ExplainCacheEntry, 'cachedAt'>): void {
  if (!entry.fingerprint || !entry.answer.trim()) return;
  const store = readStore();
  const next: ExplainCacheEntry = {
    ...entry,
    answer: entry.answer.trim(),
    cachedAt: new Date().toISOString(),
  };
  const without = store.entries.filter((e) => e.fingerprint !== entry.fingerprint);
  without.unshift(next);
  writeStore({ entries: without.slice(0, MAX_ENTRIES) });
}

export function clearExplainAnswerCache(): void {
  writeStore({ entries: [] });
}

/**
 * Turn long onboarding / care-context narratives into short caregiver bullets.
 *
 * Uses the same lightweight NLU entity linker as Pre-SLM (dictionary match over
 * patient conditions, symptoms, vitals, knowledge keywords) plus deterministic
 * sentence/list splitting — no SLM call, safe for Care tab first paint.
 */

import { linkEntities } from '@/nlu/entity-linker';
import type { PatientNluContext } from '@/nlu/types';

const MAX_BULLET_LEN = 88;
const DEFAULT_MAX_BULLETS = 8;

/** Lead-ins that make onboarding prose wordy without adding care content. */
const LEAD_IN =
  /^(i\s+want\s+to\s+(?:make\s+sure|help|keep)|i\s+help\s+(?:him|her|them|with)|i\s+watch\s+for|i\s+would\s+|we\s+want\s+to\s+|help\s+(?:me|us)\s+)/i;

const LIST_MARKERS =
  /\b(?:especially(?:\s+with)?|including|such as|like|for example|e\.g\.|watch for|watching for|notice|noticing|keep track of|keeping track of)\b/i;

/**
 * Split prose into short scannable bullets.
 * Prefers clinical list fragments and NLU-linked entities over raw paragraphs.
 */
export function narrativeToBullets(
  raw: string,
  patientCtx?: PatientNluContext | null,
  opts?: { maxBullets?: number },
): string[] {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return [];

  const maxBullets = opts?.maxBullets ?? DEFAULT_MAX_BULLETS;
  const bullets: string[] = [];
  const seen = new Set<string>();

  const push = (candidate: string) => {
    const cleaned = cleanBullet(candidate);
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    bullets.push(cleaned);
  };

  // 1) Explicit list after "especially / including / …"
  const listMatch = text.match(
    new RegExp(`${LIST_MARKERS.source}\\s+(.+)$`, 'i'),
  );
  if (listMatch?.[1]) {
    for (const part of splitListFragment(listMatch[1])) {
      push(part);
      if (bullets.length >= maxBullets) return bullets;
    }
  }

  // 2) Sentence-level bullets (minus lead-in filler)
  for (const sentence of splitSentences(text)) {
    let s = sentence.replace(LEAD_IN, '').trim();
    // Drop trailing "with Mike's care team" style clauses that are meta.
    s = s.replace(/\s+with\s+\w+'?s?\s+care\s+team\.?$/i, '').trim();
    if (s.length < 12) continue;
    // If sentence is still a long "and" chain, split lightly.
    if (s.length > 100 && /\band\b/i.test(s)) {
      for (const part of splitListFragment(s)) {
        push(part);
        if (bullets.length >= maxBullets) return bullets;
      }
    } else {
      push(s);
      if (bullets.length >= maxBullets) return bullets;
    }
  }

  // 3) NLU entity highlights (conditions / symptoms / vitals / keywords)
  if (patientCtx && bullets.length < maxBullets) {
    const entities = linkEntities(text, patientCtx)
      .filter((e) => e.score >= 0.5)
      .sort((a, b) => b.score - a.score);
    for (const e of entities) {
      if (e.type === 'tool') continue;
      // Prefer "Watch {label}" for clinical watch items when source is a concern.
      const label = e.label.trim();
      if (!label) continue;
      const alreadyCovered = [...seen].some(
        (b) => b.includes(label.toLowerCase()) || label.toLowerCase().includes(b),
      );
      if (alreadyCovered) continue;
      if (
        e.type === 'symptom' ||
        e.type === 'vital' ||
        e.type === 'condition' ||
        e.type === 'knowledge_keyword'
      ) {
        push(formatEntityBullet(e.type, label));
      } else {
        push(label);
      }
      if (bullets.length >= maxBullets) break;
    }
  }

  // Fallback: single truncated line if nothing split cleanly
  if (bullets.length === 0) {
    push(text);
  }

  return bullets.slice(0, maxBullets);
}

function formatEntityBullet(
  type: string,
  label: string,
): string {
  const pretty = label.charAt(0).toUpperCase() + label.slice(1);
  if (type === 'vital' || type === 'symptom' || type === 'knowledge_keyword') {
    return `Watch for changes in ${pretty.toLowerCase()}`;
  }
  if (type === 'condition') {
    return `Keep ${pretty} in mind day to day`;
  }
  return pretty;
}

function cleanBullet(raw: string): string {
  let t = raw.replace(/\s+/g, ' ').trim();
  t = t.replace(/^[\-–—•*\d.)\s]+/, '');
  t = t.replace(LEAD_IN, '');
  t = t.replace(/^(that\s+i\s+|that\s+|and\s+|or\s+|with\s+his\s+|with\s+her\s+)/i, '');
  t = t.replace(/[.!;,:]+$/g, '').trim();
  if (t.length < 3) return '';
  // Drop pure meta / non-actionable
  if (/^(i|we|me|my|our)\b/i.test(t) && t.length < 20) return '';
  if (t.length > MAX_BULLET_LEN) {
    const cut = t.slice(0, MAX_BULLET_LEN);
    const sp = cut.lastIndexOf(' ');
    t = `${(sp > 40 ? cut.slice(0, sp) : cut).trim()}\u2026`;
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function splitListFragment(fragment: string): string[] {
  let f = fragment.trim();
  // Drop trailing clause after semicolon if long
  if (f.includes(';')) {
    f = f.split(';')[0] ?? f;
  }
  // "a, b, c, or d"
  const parts = f
    .split(/\s*,\s*|\s+or\s+|\s+and\s+/i)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3 && p.length < 120);
  return parts.length >= 2 ? parts : [f];
}

function splitSentences(text: string): string[] {
  const raw = text.split(/(?<=[.!?])\s+/);
  return raw.map((s) => s.trim()).filter(Boolean);
}

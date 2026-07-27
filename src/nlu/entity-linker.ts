/**
 * Entity linker — lightweight dictionary-based entity extraction.
 *
 * No neural NER v1. Matches patient conditions, medications, symptoms,
 * knowledge keywords, vital types, and tool names from a PatientNluContext.
 */

import type { LinkedEntity, PatientNluContext } from './types';
import { APP_SURFACE_LEXICON, findAppSurface } from './app-surfaces';

/**
 * Normalize text for matching: lowercase, strip punctuation, collapse whitespace.
 */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Extract drug name from medication string.
 * e.g. "Prednisone 10mg tablet daily" → "prednisone"
 */
function extractDrugName(med: string): string {
  const parts = med.split(/\s+(?=\d+(?:mg|mcg|g|ml|unit|units|iu))/i);
  return parts[0].trim().toLowerCase();
}

/**
 * Check if a label appears in normalized text with word-boundary awareness.
 */
function mentionsLabel(textNorm: string, label: string): boolean {
  const l = normalize(label);
  if (!l) return false;
  if (textNorm.includes(l)) return true;
  // Multi-token: require ≥2 distinctive tokens
  const tokens = l.split(' ').filter((t) => t.length >= 3);
  if (tokens.length <= 1) return textNorm.includes(l);
  const hits = tokens.filter((t) => textNorm.includes(t));
  return hits.length >= Math.min(2, tokens.length);
}

/**
 * Find character span of a label in the original text (for UI highlighting).
 */
function findSpan(
  original: string,
  label: string,
): { start: number; end: number } | undefined {
  const lowerOriginal = original.toLowerCase();
  const lowerLabel = label.toLowerCase();
  const idx = lowerOriginal.indexOf(lowerLabel);
  if (idx >= 0) return { start: idx, end: idx + lowerLabel.length };
  return undefined;
}

/**
 * Run entity linking on a user prompt given a patient NLU context.
 */
export function linkEntities(
  prompt: string,
  ctx: PatientNluContext,
): LinkedEntity[] {
  const entities: LinkedEntity[] = [];
  const seen = new Set<string>();
  const textNorm = normalize(prompt);

  const addEntity = (
    type: LinkedEntity['type'],
    id: string,
    label: string,
    score: number,
  ) => {
    const key = `${type}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    entities.push({
      type,
      id,
      label,
      score,
      span: findSpan(prompt, label),
    });
  };

  // Conditions
  for (const c of ctx.conditions) {
    if (mentionsLabel(textNorm, c)) {
      addEntity('condition', `cond:${normalize(c)}`, c, 1.0);
    }
  }

  // Comorbidities
  for (const c of ctx.comorbidities) {
    if (mentionsLabel(textNorm, c)) {
      addEntity('condition', `comorb:${normalize(c)}`, c, 0.9);
    }
  }

  // Medications
  for (const m of ctx.medications) {
    const drugName = extractDrugName(m);
    if (mentionsLabel(textNorm, drugName) || mentionsLabel(textNorm, m)) {
      addEntity('medication', `med:${drugName}`, m, 1.0);
    }
  }

  // Symptoms
  for (const s of ctx.symptoms) {
    if (mentionsLabel(textNorm, s)) {
      addEntity('symptom', `sym:${normalize(s)}`, s, 0.9);
    }
  }

  // Knowledge keywords
  for (const kw of ctx.knowledgeKeywords) {
    if (mentionsLabel(textNorm, kw)) {
      addEntity('knowledge_keyword', `kw:${normalize(kw)}`, kw, 0.8);
    }
  }

  // Vital types
  for (const v of ctx.vitalTypes) {
    if (mentionsLabel(textNorm, v)) {
      addEntity('vital', `vital:${normalize(v)}`, v, 1.0);
    }
  }

  // Named app surfaces (priorities list, watch areas, knowledge base, tabs…)
  const surfaceLabels =
    ctx.appSurfaces && ctx.appSurfaces.length > 0
      ? ctx.appSurfaces
      : APP_SURFACE_LEXICON.map((e) => e.label);
  for (const label of surfaceLabels) {
    if (mentionsLabel(textNorm, label)) {
      const entry = findAppSurface(normalize(label)) ?? findAppSurface(textNorm);
      addEntity(
        'app_surface',
        `surface:${entry?.id ?? normalize(label)}`,
        entry?.label ?? label,
        0.95,
      );
    }
  }
  // Alias sweep when labels alone miss multi-word caregiver phrasing
  const hit = findAppSurface(textNorm);
  if (hit) {
    addEntity('app_surface', `surface:${hit.id}`, hit.label, 0.95);
  }

  // Functional scales (GMFCS, MACS, etc.)
  if (ctx.functionalScales) {
    const scales = ctx.functionalScales;
    for (const [key, val] of Object.entries(scales)) {
      if (val && mentionsLabel(textNorm, key)) {
        addEntity('knowledge_keyword', `scale:${key}`, `${key}: ${val}`, 0.7);
      }
    }
  }

  return entities;
}

/**
 * Build a one-line entity hint for the SLM prompt.
 */
export function formatEntityHint(entities: LinkedEntity[]): string {
  if (entities.length === 0) return '';
  const labels = entities.map((e) => e.label);
  return `Linked: ${labels.join(', ')}`;
}

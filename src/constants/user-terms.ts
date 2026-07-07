/**
 * Caregiver-facing terminology map.
 *
 * Per planning/28_personalization-caregiver-ui.md: every user-facing string
 * must use the right-hand column. Technical terms remain in code, dev docs,
 * and the developer menu only.
 *
 * Keep this file as the single source of truth — do not duplicate these
 * mappings inline in components.
 */

import { AppTheme } from '@/constants/theme';

export const USER_TERMS = {
  /** Small Language Model — the on-device assistant. */
  slm: 'Concierge',
  /** Alert ML / autoencoder / anomaly detection. */
  ml: 'Health Monitor',
  /** Human-in-the-loop / caregiver confirmation. */
  hitl: 'Your Review',
  /** RAG / clinical evidence retrieval. */
  rag: 'Clinical Evidence',
  /** FHIR / C-CDA / EHR. */
  fhir: 'Health Record',
  /** ICD-10 → "Diagnosis code" — clinical scale preserved. */
  icd10: 'Diagnosis code',
  /** ED → ER. */
  ed: 'ER',
  /** Inference → "Thinking" / "Processing". */
  inference: 'thinking',
  /** Generic "model" in a user string. */
  model: 'Concierge Brain',
  /** Severity levels. */
  severity3: 'Urgent',
  severity2: 'Needs attention',
  severity1: 'Heads up',
  /** "ML Analysis" / "UC2 Decision" / "Autoencoder". */
  mlAnalysis: 'Health Monitor analysis',
  /** "Orchestrator" — never shown to caregivers. */
  orchestrator: 'Concierge',
  /** "Prompt" → "Question" or "Request". */
  prompt: 'question',
  /** "Token" — internal only. */
  token: '',
  /** "Reasoning" / "Thinking" — internal only. */
  reasoning: 'thinking',
  /** Quantization / model file size — only in model download UI. */
  gguf: 'Concierge Brain file',
} as const;

/**
 * User-facing severity label mapping. Falls back to "Severity N" for unknown
 * values so we never leak the raw integer.
 */
export function severityLabel(severity: number | null | undefined): string {
  if (severity === 3) return USER_TERMS.severity3;
  if (severity === 2) return USER_TERMS.severity2;
  if (severity === 1) return USER_TERMS.severity1;
  if (severity === 0) return 'Info';
  return 'Alert';
}

/**
 * User-facing severity color. Returns the AppTheme color hex so a single
 * source of truth owns both label and color. Falls back to `brand` for
 * unknown values (matches "Alert" in severityLabel()).
 */
export function severityColor(severity: number | null | undefined): string {
  if (severity === 3) return AppTheme.colors.danger;
  if (severity === 2) return AppTheme.colors.warning;
  if (severity === 1) return AppTheme.colors.brand;
  if (severity === 0) return AppTheme.colors.textMuted;
  return AppTheme.colors.brand;
}

/**
 * Caregiver-facing greeting by time of day. Falls back to "Hello" at the
 * boundary hours if the caller wants a neutral tone.
 */
export function timeOfDayGreeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Hi';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Hi';
}

/**
 * Translate a technical source label into a caregiver-friendly one.
 * Used by the citation renderer.
 */
export function sourceLabelForCaregiver(source: string | null | undefined): string {
  if (!source) return '';
  const lower = source.toLowerCase();
  if (lower === 'pubmed') return 'Medical literature';
  if (lower === 'medlineplus') return 'Health topic summary';
  if (lower === 'rxnorm') return 'Drug information';
  if (lower === 'dailymed') return 'Drug label';
  if (lower === 'openfda') return 'Drug safety data';
  if (lower === 'clinicaltrials' || lower === 'clinicaltrialsgov') return 'Clinical trial data';
  if (lower === 'orphanet' || lower === 'orphadata') return 'Rare disease guidance';
  if (lower === 'umls') return 'Medical terminology';
  if (lower === 'cdc-places' || lower === 'cdc_places') return 'Community health data';
  if (lower === 'semmeddb' || lower === 'semmed') return 'Medical relationships';
  if (lower === 'synthetic' || lower === 'local-fixture') return 'Sample guidance';
  if (lower === 'patient-plan' || lower === 'care-plan') return 'Care plan';
  return source;
}

/**
 * Typed classification of Concierge model-load failures.
 *
 * The llama.rn / provider layer surfaces errors as strings; this module maps
 * stable signal substrings to a small set of kinds so UI copy and diagnostics
 * do not re-scan raw error text at every call site (and break across
 * llama.cpp version wording changes).
 */

export type SlmLoadErrorKind =
  | 'memory'
  | 'not_installed'
  | 'context_overflow'
  | 'load_failure'
  | 'other';

const MEMORY_PATTERNS = /(^|\s)ram|memory|mmap|contiguous|2\.9/;
const NOT_INSTALLED_PATTERNS = /not installed|not found|no native slm|model unavailable/;
const CONTEXT_PATTERNS = /context is full|context window|out of context|n_ctx|ctx (?:is )?(?:full|too small|overflow)/;
const LOAD_FAILURE_PATTERNS =
  /unable to load|failed to load|load attempts failed|model not loaded|slm is not ready|not ready/;

export function classifySlmLoadError(error: string | null | undefined): SlmLoadErrorKind {
  if (!error) return 'other';
  const lower = error.toLowerCase();
  if (MEMORY_PATTERNS.test(lower)) return 'memory';
  if (NOT_INSTALLED_PATTERNS.test(lower)) return 'not_installed';
  if (CONTEXT_PATTERNS.test(lower)) return 'context_overflow';
  if (LOAD_FAILURE_PATTERNS.test(lower)) return 'load_failure';
  return 'other';
}

/** True when the error means the Concierge model could not be used. */
export function isSlmLoadError(error: string | null | undefined): boolean {
  return classifySlmLoadError(error) !== 'other';
}

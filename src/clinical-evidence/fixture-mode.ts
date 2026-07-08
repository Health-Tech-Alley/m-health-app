/**
 * Fixture-mode helper.
 *
 * Per planning/26: the new clients (ClinicalTrials.gov, UMLS, Orphanet, CDC
 * PLACES) ship with realistic fixture data on Track A so the integration is
 * exercised in code without live network calls. A single env-style flag
 * flips the live path on for Track B (dev build).
 *
 * The default is `true` (fixtures). Pass `false` explicitly from a dev
 * build or e2e test to opt into live fetch.
 */

let forceLive = false;

export function setLiveClinicalFetch(enabled: boolean): void {
  forceLive = enabled;
}

export function isFixtureMode(): boolean {
  if (forceLive) return false;
  // In Track A (Expo Go) the runtime does not have these APIs' rate
  // budgets anyway — defaulting to fixtures keeps demos safe.
  return true;
}

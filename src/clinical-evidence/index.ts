/**
 * Clinical evidence clients — public API barrel.
 *
 * All outgoing API queries are de-identified via `deidentifyQuery()` before
 * hitting the network. Every call is audited via the patient_enrichment_log.
 */

export { deidentifyQuery, buildPubMedQuery } from './deidentify';
export type { PatientPiiContext } from './deidentify';

export { searchPubMed, fetchAbstracts } from './pubmed-client';
export type { PubMedSearchResult } from './pubmed-client';

export { fetchHealthTopic, fetchDrugInfo } from './medlineplus-client';

export {
  normalizeDrugName,
  getDrugInteractions,
  getTherapeuticCategory,
} from './rxnorm-client';
export type { DrugNormalizationResult, DrugInteraction } from './rxnorm-client';

export { fetchDrugLabel } from './dailymed-client';

export { fetchAdverseEvents, fetchDrugRecalls } from './openfda-client';

export { bundleConditionPack, bundleMedicationPack, liveSupplement } from './condition-bundler';
export { RateLimiter, withRetry, sleep } from './rate-limiter';
export {
  retrieveClinicalChunks,
  formatCitationsForPrompt,
  buildRetrievalQuery,
  messageHasClinicalKeywords,
} from './retrieval-helper';
export type { RetrievedCitation } from './retrieval-helper';

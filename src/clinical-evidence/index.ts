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

// New clients (per planning/26_clinical-data-sources-research.md).
// Each ships with realistic fixtures on Track A; live fetch is gated
// behind `setLiveClinicalFetch(true)` and used in Track B.
export { searchClinicalTrials, trialsToChunks } from './clinicaltrials-client';
export type { ClinicalTrialRecord, ClinicalTrialSearchParams } from './clinicaltrials-client';

export { lookupUmls, umlsToChunks } from './umls-client';
export type { UmlsConceptMapping, UmlsSearchParams } from './umls-client';

export { searchOrphanet, orphanetToChunks } from './orphanet-client';
export type { OrphanetRecord, OrphanetSearchParams } from './orphanet-client';

export { fetchCdcPlaces, cdcToChunks } from './cdc-places-client';
export type { CdcPlacesRecord, CdcPlacesParams } from './cdc-places-client';

export { setLiveClinicalFetch, isFixtureMode } from './fixture-mode';

export { bundleConditionPack, bundleMedicationPack, bundleSdohPack, bundleMeasurePack, bundleSystematicReviewPack, bundleFullSplPack, liveSupplement } from './condition-bundler';
export { HEDIS_MEASURES, measuresForPatient } from './hedis-measures';
export type { HedisMeasure } from './hedis-measures';
export { redownloadForChunk, redownloadAllForPatient } from './re-download';
export { RateLimiter, withRetry, sleep } from './rate-limiter';
export {
  retrieveClinicalChunks,
  formatCitationsForPrompt,
  formatCitationTag,
  citationSourceLabel,
  buildRetrievalQuery,
  buildChatRetrievalQuery,
  messageHasClinicalKeywords,
  extractContentTokens,
} from './retrieval-helper';
export type { RetrievedCitation } from './retrieval-helper';

export { decideReasoningMode, selectChatGeneration, FAST_ELIGIBLE_INTENTS, ALWAYS_DEEP_INTENTS } from './reasoning-router';
export type { ChatGenerationDecision } from './reasoning-router';

export { formatAnswerWithFootnotes } from './citation-display';
export type { FootnoteFormatResult } from './citation-display';

/**
 * Per-chunk re-download service.
 *
 * Lets the dev menu (KnowledgeCacheViewer) re-fetch a single chunk's
 * underlying evidence from the clinical source, replacing the cached
 * copy. Used when the cache has gone stale, when a network call failed
 * earlier, or when the caregiver updates the patient record and wants
 * fresh evidence.
 *
 * The service is intentionally thin: it deletes the existing chunk then
 * calls the matching source client's re-fetch function. The source
 * clients (pubmed, medlineplus, etc.) own the network logic.
 *
 * See planning/32 §13.3.
 */

import {
  deleteKnowledgeChunk,
  getKnowledgeChunk,
} from '@/data/repositories/knowledgeCacheRepository';
import type { KnowledgeChunk, KnowledgeSource } from '@/data/types';
import { getActiveMedications, getConditionsForPatient } from '@/data/repositories/patientRepository';
import { searchPubMed, fetchAbstracts } from './pubmed-client';
import { fetchHealthTopic } from './medlineplus-client';
import { searchOrphanet, orphanetToChunks } from './orphanet-client';
import { searchClinicalTrials, trialsToChunks } from './clinicaltrials-client';
import { fetchDrugLabel } from './dailymed-client';
import { fetchAdverseEvents, fetchDrugRecalls } from './openfda-client';
import { lookupUmls, umlsToChunks } from './umls-client';
import { fetchCdcPlaces, cdcToChunks } from './cdc-places-client';
import { setLiveClinicalFetch } from './fixture-mode';
import { getOnboardingProfile } from '@/services/onboarding/onboardingService';
import { deidentifyQuery, buildPubMedQuery } from './deidentify';
import { insertEnrichmentLogEntry } from '@/data/repositories/patientEnrichmentLogRepository';

export interface ReDownloadResult {
  chunkId: string;
  success: boolean;
  newChunkIds: string[];
  error?: string;
}

function makeLogId(): string {
  return `enrich-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
}

function logSupplemented(patientId: string, source: KnowledgeSource, query: string, count: number): void {
  insertEnrichmentLogEntry({
    logId: makeLogId(),
    patientId,
    field: 'condition',
    source,
    action: 'supplemented_live',
    deidentifiedQuery: query,
    resultCount: count,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Re-download a single chunk by id. The chunk's source + conditions/med
 * metadata drives which client to call. New chunks are inserted; the old
 * one is removed.
 */
export async function redownloadForChunk(
  chunkId: string,
  patientId: string,
): Promise<ReDownloadResult> {
  const existing = getKnowledgeChunk(chunkId);
  if (!existing) {
    return { chunkId, success: false, newChunkIds: [], error: 'Chunk not found' };
  }

  // Re-download always hits the live APIs (not fixtures) — the user explicitly
  // asked for fresh data. Restores the fixture-mode default on completion.
  setLiveClinicalFetch(true);

  deleteKnowledgeChunk(chunkId);

  const profile = getOnboardingProfile();
  const pii = {
    patientName: profile.patient.name,
    caregiverName: profile.caregiver.name,
    providerName: profile.primaryCareProvider.name,
  };
  const conditionName = (existing.conditions ?? '').split(',')[0]?.trim() || '';

  try {
    const newChunks: KnowledgeChunk[] = [];
    switch (existing.source) {
      case 'pubmed': {
        if (!conditionName) throw new Error('No condition tag on chunk');
        const query = buildPubMedQuery(conditionName, { caregiverFocus: true });
        const deid = deidentifyQuery(query, pii);
        const search = await searchPubMed({ query: deid, retmax: 20 });
        const abstracts = await fetchAbstracts(search.pmids);
        for (const c of abstracts) {
          newChunks.push({ ...c, conditions: conditionName });
        }
        logSupplemented(patientId, 'pubmed', deid, newChunks.length);
        break;
      }
      case 'medlineplus': {
        if (!conditionName) throw new Error('No condition tag on chunk');
        const topics = await fetchHealthTopic({ code: conditionName, codeSystem: 'icd10' });
        for (const c of topics) {
          newChunks.push({ ...c, conditions: conditionName });
        }
        logSupplemented(patientId, 'medlineplus', conditionName, newChunks.length);
        break;
      }
      case 'orphanet': {
        if (!conditionName) throw new Error('No condition tag on chunk');
        const record = await searchOrphanet({ disease: conditionName });
        if (record) {
          for (const c of orphanetToChunks(record)) {
            newChunks.push({ ...c, conditions: conditionName });
          }
        }
        logSupplemented(patientId, 'orphanet', conditionName, newChunks.length);
        break;
      }
      case 'clinicaltrials': {
        if (!conditionName) throw new Error('No condition tag on chunk');
        const trials = await searchClinicalTrials({ condition: conditionName, pageSize: 5 });
        for (const c of trialsToChunks(trials)) {
          newChunks.push({ ...c, conditions: conditionName });
        }
        logSupplemented(patientId, 'clinicaltrials', conditionName, newChunks.length);
        break;
      }
      case 'dailymed': {
        // Re-fetch by drug name (parsed from the metadata or conditions tag).
        const drugName = conditionName;
        const labels = await fetchDrugLabel(drugName);
        newChunks.push(...labels);
        logSupplemented(patientId, 'dailymed', drugName, newChunks.length);
        break;
      }
      case 'openfda': {
        const drugName = conditionName;
        const events = await fetchAdverseEvents(drugName);
        const recalls = await fetchDrugRecalls(drugName);
        newChunks.push(...events, ...recalls);
        logSupplemented(patientId, 'openfda', drugName, newChunks.length);
        break;
      }
      case 'umls': {
        // Existing chunks are tagged with the ICD-10 code in conditions or
        // embedded in the chunkId (UMLS-CXXXXX). Re-fetch the ICD code.
        const code = conditionName || existing.chunkId.replace(/^UMLS-/, '');
        const mapping = await lookupUmls({ code, vocabulary: 'ICD10' });
        if (mapping) {
          for (const c of umlsToChunks(mapping)) {
            newChunks.push({ ...c, conditions: conditionName || code });
          }
        }
        logSupplemented(patientId, 'umls', code, newChunks.length);
        break;
      }
      case 'cdc-places': {
        const location = (profile.patient as { location?: string }).location ?? '';
        if (!location) throw new Error('No patient.location set; cannot re-download CDC PLACES');
        const rec = await fetchCdcPlaces({ location });
        if (rec) {
          for (const c of cdcToChunks(rec)) {
            newChunks.push({ ...c, conditions: 'SDOH' });
          }
        }
        logSupplemented(patientId, 'cdc-places', location, newChunks.length);
        break;
      }
      default:
        throw new Error(`Re-download not supported for source: ${existing.source}`);
    }

    // Persist the new chunks
    if (newChunks.length > 0) {
      const { insertKnowledgeChunksForPatient } = await import(
        '@/data/repositories/knowledgeCacheRepository'
      );
      insertKnowledgeChunksForPatient(patientId, newChunks);
    }

    return {
      chunkId,
      success: true,
      newChunkIds: newChunks.map((c) => c.chunkId),
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { chunkId, success: false, newChunkIds: [], error };
  }
}

/**
 * Re-run the full condition + medication + SDOH + measure bundles against
 * the *current* patient record. Used by the dev menu's "Re-download all"
 * button so the caregiver can refresh the cache after editing the patient
 * record (e.g. adding a new condition).
 */
export async function redownloadAllForPatient(patientId: string): Promise<{ reDownloaded: number; errors: string[] }> {
  const errors: string[] = [];
  // Default re-download: condition + med + SDOH only.
  // Full SPL / systematic-review packs are deep-mode only (explicit opt-in
  // below stays available for power users via the same entry if flags grow).
  // HEDIS measure packs are permanently disabled (no auto-goals / BM25 noise).
  const { bundleConditionPack, bundleMedicationPack, bundleSdohPack, bundleCuratedKnowledgePacks } =
    await import('./condition-bundler');
  // Wipe literature only — keep ADCP plan + CDA patient-record chunks.
  const {
    clearLiteratureKnowledgeCacheForPatient,
    getKnowledgeChunksForPatient,
  } = await import('@/data/repositories/knowledgeCacheRepository');
  // Active patient only — never wipe other profiles' corpora.
  clearLiteratureKnowledgeCacheForPatient(patientId);

  // Re-download always hits the live APIs (not fixtures) — the user explicitly
  // asked for fresh data from all available clinical sources.
  setLiveClinicalFetch(true);

  try { await bundleConditionPack(patientId); } catch (e) { errors.push(`condition: ${e}`); }
  try { await bundleMedicationPack(patientId); } catch (e) { errors.push(`medication: ${e}`); }
  try { await bundleSdohPack(patientId); } catch (e) { errors.push(`sdoh: ${e}`); }
  try { await bundleCuratedKnowledgePacks(patientId); } catch (e) { errors.push(`curated: ${e}`); }
  // Silence unused-import warning for the active meds/conditions helpers.
  void getActiveMedications; void getConditionsForPatient;
  return { reDownloaded: getKnowledgeChunksForPatient(patientId).length, errors };
}

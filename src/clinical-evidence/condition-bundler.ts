/**
 * Condition bundler — pre-bundles clinical knowledge at onboarding time.
 *
 * For each patient condition (ICD-10): fetches PubMed abstracts + MedlinePlus
 * health topic summaries, stores them in knowledge_cache, and logs the
 * enrichment. For each active medication: fetches RxNorm normalization,
 * DailyMed labels, and OpenFDA adverse events.
 *
 * Fire-and-forget from seedFromProfile. Sets `bundlePending` flag so the app
 * can retry on next launch if the bundle fails.
 *
 * See planning/22_clinical-data-gathering.md §5g.
 */

import {
  getConditionsForPatient,
  getActiveMedications,
  insertKnowledgeChunks,
  insertEnrichmentLogEntry,
  setBundlePending,
  setBundleStatus,
  type BundleStatus,
} from '@/data';
import type { KnowledgeChunk, PatientEnrichmentLogEntry } from '@/data/types';
import { getOnboardingProfile } from '@/services/onboarding/onboardingService';
import { deidentifyQuery, buildPubMedQuery } from './deidentify';
import { searchPubMed, fetchAbstracts } from './pubmed-client';
import { fetchHealthTopic } from './medlineplus-client';
import { normalizeDrugName } from './rxnorm-client';
import { fetchDrugLabel } from './dailymed-client';
import { fetchAdverseEvents, fetchDrugRecalls } from './openfda-client';
import { RateLimiter } from './rate-limiter';

// 500ms between NLM API calls = 2 req/s (well under the 3 req/s limit
// without an API key, and under 10 req/s with one).
const nlmRateLimiter = new RateLimiter(500);

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
}

function hashQuery(query: string): string {
  // Simple hash for query dedup — not cryptographic
  let hash = 0;
  for (let i = 0; i < query.length; i++) {
    const char = query.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(16);
}

function logEnrichment(
  patientId: string,
  field: 'condition' | 'medication',
  resourceId: string,
  source: 'pubmed' | 'medlineplus' | 'rxnorm' | 'dailymed' | 'openfda',
  action: 'bundled' | 'suggested' | 'supplemented_live',
  deidentifiedQuery: string,
  resultCount: number,
  latencyMs: number,
  chunkIds: string[],
): void {
  const entry: PatientEnrichmentLogEntry = {
    logId: makeId('enrich'),
    patientId,
    field,
    resourceId,
    source,
    action,
    deidentifiedQuery,
    resultCount,
    latencyMs,
    chunkIds: chunkIds.join(','),
    createdAt: new Date().toISOString(),
  };
  insertEnrichmentLogEntry(entry);
}

/**
 * Bundle condition packs for a patient: PubMed abstracts + MedlinePlus topics
 * for each confirmed condition. Fire-and-forget — caller does not await.
 */
export async function bundleConditionPack(patientId: string): Promise<void> {
  // Mark in-flight so the UI can show "Enrichment in progress…".
  setBundlePending(patientId, true);
  setBundleStatus(patientId, { state: 'in_flight', chunksAdded: 0 });

  const conditions = getConditionsForPatient(patientId).filter((c) => !c.needsReview);
  const profile = getOnboardingProfile();

  const pii = {
    patientName: profile.patient.name,
    caregiverName: profile.caregiver.name,
    providerName: profile.primaryCareProvider.name,
    emergencyContact: profile.safety?.emergencyContact,
    backupCaregiver: profile.caregiver.backupCaregiver,
  };

  let totalChunks = 0;
  let lastError: string | undefined;

  try {
    for (const condition of conditions) {
      const conditionName = condition.name;
      const icdCode = condition.icd10;

      // --- PubMed ---
      try {
        const rawQuery = buildPubMedQuery(conditionName, { caregiverFocus: true });
        const deidQuery = deidentifyQuery(rawQuery, pii);
        const t0 = Date.now();
        await nlmRateLimiter.throttle();
        const searchResult = await searchPubMed({ query: deidQuery, retmax: 20 });
        await nlmRateLimiter.throttle();
        const abstracts = await fetchAbstracts(searchResult.pmids);

        // Tag chunks with the condition name
        const taggedChunks: KnowledgeChunk[] = abstracts.map((c) => ({
          ...c,
          conditions: conditionName,
          queryHash: hashQuery(deidQuery),
        }));

        insertKnowledgeChunks(taggedChunks);
        totalChunks += taggedChunks.length;

        logEnrichment(
          patientId, 'condition', condition.conditionId, 'pubmed', 'bundled',
          deidQuery, taggedChunks.length, Date.now() - t0,
          taggedChunks.map((c) => c.chunkId),
        );
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.error(`[condition-bundler] PubMed failed for ${conditionName}:`, err);
      }

      // --- MedlinePlus Connect ---
      if (icdCode) {
        try {
          const t0 = Date.now();
          await nlmRateLimiter.throttle();
          const topics = await fetchHealthTopic({ code: icdCode, codeSystem: 'icd10' });

          const taggedChunks: KnowledgeChunk[] = topics.map((c) => ({
            ...c,
            conditions: conditionName,
          }));

          insertKnowledgeChunks(taggedChunks);
          totalChunks += taggedChunks.length;

          logEnrichment(
            patientId, 'condition', condition.conditionId, 'medlineplus', 'bundled',
            `ICD10:${icdCode}`, taggedChunks.length, Date.now() - t0,
            taggedChunks.map((c) => c.chunkId),
          );
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          console.error(`[condition-bundler] MedlinePlus failed for ${icdCode}:`, err);
        }
      }
    }
  } catch (err) {
    // A top-level failure (e.g. repository read threw) — record and degrade.
    lastError = err instanceof Error ? err.message : String(err);
    console.error('[condition-bundler] Bundle aborted:', err);
  } finally {
    // Always clear the in-flight flag so the UI never gets stuck on
    // "Enrichment in progress…" — even when the network is unavailable.
    const status: BundleStatus =
      totalChunks > 0
        ? { state: 'complete', chunksAdded: totalChunks }
        : lastError
          ? { state: 'failed', chunksAdded: 0, error: lastError }
          : { state: 'complete', chunksAdded: 0 };
    setBundleStatus(patientId, status);
    setBundlePending(patientId, false);
    console.log(`[condition-bundler] Bundle finished for ${patientId}: ${status.state} (${totalChunks} chunks)`);
  }
}

/**
 * Bundle medication packs for a patient: RxNorm normalization, DailyMed labels,
 * OpenFDA adverse events + recalls for each active medication.
 */
export async function bundleMedicationPack(patientId: string): Promise<void> {
  const medications = getActiveMedications(patientId);

  for (const med of medications) {
    // --- RxNorm normalization ---
    try {
      const t0 = Date.now();
      await nlmRateLimiter.throttle();
      const normalized = await normalizeDrugName(med.name);
      if (normalized) {
        logEnrichment(
          patientId, 'medication', med.medicationId, 'rxnorm', 'bundled',
          med.name, 1, Date.now() - t0, [],
        );
      }
    } catch (err) {
      console.error(`[condition-bundler] RxNorm failed for ${med.name}:`, err);
    }

    // --- DailyMed label ---
    try {
      const t0 = Date.now();
      await nlmRateLimiter.throttle();
      const labels = await fetchDrugLabel(med.name);
      const taggedChunks: KnowledgeChunk[] = labels.map((c) => ({
        ...c,
        conditions: med.name,
      }));
      insertKnowledgeChunks(taggedChunks);

      logEnrichment(
        patientId, 'medication', med.medicationId, 'dailymed', 'bundled',
        med.name, taggedChunks.length, Date.now() - t0,
        taggedChunks.map((c) => c.chunkId),
      );
    } catch (err) {
      console.error(`[condition-bundler] DailyMed failed for ${med.name}:`, err);
    }

    // --- OpenFDA adverse events ---
    try {
      const t0 = Date.now();
      await nlmRateLimiter.throttle();
      const events = await fetchAdverseEvents(med.name);
      insertKnowledgeChunks(events);

      logEnrichment(
        patientId, 'medication', med.medicationId, 'openfda', 'bundled',
        med.name, events.length, Date.now() - t0,
        events.map((c) => c.chunkId),
      );
    } catch (err) {
      console.error(`[condition-bundler] OpenFDA events failed for ${med.name}:`, err);
    }

    // --- OpenFDA recalls ---
    try {
      const t0 = Date.now();
      await nlmRateLimiter.throttle();
      const recalls = await fetchDrugRecalls(med.name);
      insertKnowledgeChunks(recalls);

      logEnrichment(
        patientId, 'medication', med.medicationId, 'openfda', 'bundled',
        med.name, recalls.length, Date.now() - t0,
        recalls.map((c) => c.chunkId),
      );
    } catch (err) {
      console.error(`[condition-bundler] OpenFDA recalls failed for ${med.name}:`, err);
    }
  }
}

/**
 * Live supplement: called by the CachedFusedRetriever when BM25 returns < 3
 * results. Runs a PubMed + MedlinePlus query on the spot, caches the results,
 * and returns the new chunks.
 */
export async function liveSupplement(
  intent: string,
  conditions: string[],
  patientId: string,
): Promise<KnowledgeChunk[]> {
  const profile = getOnboardingProfile();
  const pii = {
    patientName: profile.patient.name,
    caregiverName: profile.caregiver.name,
    providerName: profile.primaryCareProvider.name,
  };

  const newChunks: KnowledgeChunk[] = [];

  for (const condition of conditions.slice(0, 2)) {
    try {
      const rawQuery = buildPubMedQuery(condition, { caregiverFocus: true });
      const deidQuery = deidentifyQuery(rawQuery, pii);
      const t0 = Date.now();
      await nlmRateLimiter.throttle();
      const searchResult = await searchPubMed({ query: deidQuery, retmax: 5 });
      await nlmRateLimiter.throttle();
      const abstracts = await fetchAbstracts(searchResult.pmids);

      const taggedChunks: KnowledgeChunk[] = abstracts.map((c) => ({
        ...c,
        conditions: condition,
        queryHash: hashQuery(deidQuery),
      }));

      insertKnowledgeChunks(taggedChunks);
      newChunks.push(...taggedChunks);

      logEnrichment(
        patientId, 'condition', 'live', 'pubmed', 'supplemented_live',
        deidQuery, taggedChunks.length, Date.now() - t0,
        taggedChunks.map((c) => c.chunkId),
      );
    } catch (err) {
      console.error(`[condition-bundler] Live supplement failed for ${condition}:`, err);
    }
  }

  return newChunks;
}

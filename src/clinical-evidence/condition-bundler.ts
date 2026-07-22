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
  getKnowledgeChunk,
  type BundleStatus,
} from '@/data';
import type { KnowledgeChunk, PatientCondition, PatientEnrichmentLogEntry } from '@/data/types';
import { getOnboardingProfile } from '@/services/onboarding/onboardingService';
import { deidentifyQuery, buildPubMedQuery } from './deidentify';
import { searchPubMed, fetchAbstracts } from './pubmed-client';
import { fetchHealthTopic } from './medlineplus-client';
import { normalizeDrugName } from './rxnorm-client';
import { fetchDrugLabel } from './dailymed-client';
import { fetchAdverseEvents, fetchDrugRecalls } from './openfda-client';
import { searchOrphanet, orphanetToChunks } from './orphanet-client';
import { lookupUmls, umlsToChunks } from './umls-client';
import { fetchCdcPlaces, cdcToChunks } from './cdc-places-client';
import { RateLimiter } from './rate-limiter';
import { sectionChunkKnowledgeBatch } from './section-chunk-helper';
import { seedCuratedKnowledgePacks } from './curated-knowledge-packs';
import {
  writeParentOfEdges,
  writeSharesConditionEdges,
  writeSharesMedicationEdges,
} from '@/knowledge/graph/knowledge-chunk-edge-writers';

// 500ms between NLM API calls = 2 req/s (well under the 3 req/s limit
// without an API key, and under 10 req/s with one).
const nlmRateLimiter = new RateLimiter(500);

/**
 * Section-chunk long knowledge rows before insertion (planning/35 §5.4).
 * Short rows pass through unchanged.
 */
function insertWithSectionChunking(
  chunks: KnowledgeChunk[],
  opts?: { medKey?: string; source?: string },
): number {
  const expanded = sectionChunkKnowledgeBatch(chunks);
  insertKnowledgeChunks(expanded);
  const source = opts?.source ?? 'bundler';
  try {
    writeParentOfEdges(expanded, source);
    writeSharesConditionEdges(expanded, { source });
    if (opts?.medKey) {
      writeSharesMedicationEdges(expanded, opts.medKey, { source });
    }
  } catch (err) {
    console.error('[condition-bundler] evidence edges failed:', err);
  }
  return expanded.length;
}

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

/**
 * Filter out chunks whose chunkId already exists in the knowledge_cache.
 * Prevents later packs (systematic review, HEDIS) from overwriting earlier
 * packs (condition) when the same PMID appears in multiple searches.
 */
function filterNewChunks(chunks: KnowledgeChunk[]): KnowledgeChunk[] {
  return chunks.filter((c) => !getKnowledgeChunk(c.chunkId));
}

function logEnrichment(
  patientId: string,
  field: 'condition' | 'medication' | 'goal' | 'threshold',
  resourceId: string,
  source: 'pubmed' | 'medlineplus' | 'rxnorm' | 'dailymed' | 'openfda' | 'orphanet' | 'umls' | 'cdc-places' | 'hedis',
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

function selectConditionsForBundling(patientId: string): PatientCondition[] {
  const conditions = getConditionsForPatient(patientId).filter((condition) => !condition.needsReview);
  const hasCuratedRoles = conditions.some((condition) => Boolean(condition.conditionRole));
  if (!hasCuratedRoles) return conditions;

  const selected = new Map<string, PatientCondition>();
  const primary = conditions.find((condition) => condition.conditionRole === 'primary_diagnosis');
  if (primary) {
    selected.set(primary.conditionId, primary);
  }
  for (const condition of conditions) {
    if (condition.conditionRole === 'active_comorbidity') {
      selected.set(condition.conditionId, condition);
    }
  }
  return [...selected.values()];
}

/**
 * Bundle condition packs for a patient: PubMed abstracts + MedlinePlus topics
 * for each confirmed condition. Fire-and-forget — caller does not await.
 *
 * Per planning/32 §10.2, this also calls UMLS (ICD-10 → MeSH) and the SDOH
 * CDC-Places bundler. UMLS is woven into the per-condition loop so the
 * returned MeSH term can be fed back into the next PubMed search.
 */
export async function bundleConditionPack(patientId: string): Promise<void> {
  // Mark in-flight so the UI can show "Enrichment in progress…".
  setBundlePending(patientId, true);
  setBundleStatus(patientId, { state: 'in_flight', chunksAdded: 0 });

  const conditions = selectConditionsForBundling(patientId);
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

  // Cache UMLS-derived MeSH terms per condition so the PubMed query can be
  // expanded for better recall (planning/32 §10.2).
  const meshTermCache: Record<string, string> = {};

  try {
    for (const condition of conditions) {
      const conditionName = condition.name;
      const icdCode = condition.icd10;

      // --- UMLS (ICD-10 → CUI + MeSH term) ------------------------------
      // D5: improves PubMed recall on the next condition's search and
      // produces a KnowledgeChunk for the graph projector.
      if (icdCode) {
        try {
          const t0 = Date.now();
          const mapping = await lookupUmls({ code: icdCode, vocabulary: 'ICD10' });
          if (mapping) {
            const tagged = umlsToChunks(mapping).map((c) => ({
              ...c,
              conditions: conditionName,
            }));
            totalChunks += insertWithSectionChunking(tagged);
            logEnrichment(
              patientId, 'condition', condition.conditionId, 'umls', 'bundled',
              `ICD10:${icdCode}`, tagged.length, Date.now() - t0,
              tagged.map((c) => c.chunkId),
            );
            // Feed the MeSH term back into the next PubMed query for better recall.
            const mesh = mapping.related.find((r) => r.vocabulary === 'MeSH')?.term;
            if (mesh) meshTermCache[conditionName] = mesh;
          }
        } catch (err) {
          console.error(`[condition-bundler] UMLS failed for ${icdCode}:`, err);
        }
      }

      // --- PubMed ---
      try {
        const meshTerm = meshTermCache[conditionName];
        const baseQuery = buildPubMedQuery(conditionName, { caregiverFocus: true });
        const expandedQuery = meshTerm ? `${baseQuery} (${meshTerm}[MeSH Terms])` : baseQuery;
        const deidQuery = deidentifyQuery(expandedQuery, pii);
        const t0 = Date.now();
        await nlmRateLimiter.throttle();
        const searchResult = await searchPubMed({ query: deidQuery, retmax: 5 });
        await nlmRateLimiter.throttle();
        const abstracts = await fetchAbstracts(searchResult.pmids);

        // Tag chunks with the condition name
        const taggedChunks: KnowledgeChunk[] = abstracts.map((c) => ({
          ...c,
          conditions: conditionName,
          queryHash: hashQuery(deidQuery),
        }));

        totalChunks += insertWithSectionChunking(taggedChunks);

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

          totalChunks += insertWithSectionChunking(taggedChunks);

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

      // --- Orphanet (rare-disease / CP-specific guidance) ---
      try {
        const t0 = Date.now();
        const record = await searchOrphanet({ disease: conditionName });
        if (record) {
          const tagged = orphanetToChunks(record).map((c) => ({
            ...c,
            conditions: conditionName,
          }));
          totalChunks += insertWithSectionChunking(tagged);
          logEnrichment(
            patientId, 'condition', condition.conditionId, 'orphanet', 'bundled',
            conditionName, tagged.length, Date.now() - t0,
            tagged.map((c) => c.chunkId),
          );
        }
      } catch (err) {
        console.error(`[condition-bundler] Orphanet failed for ${conditionName}:`, err);
      }
    }
    // Offline CPG + disability care-gap packs (stable ids, small volume).
    try {
      const curated = seedCuratedKnowledgePacks(conditions.map((c) => c.name));
      totalChunks += curated.cpgCount + curated.gapCount;
      console.log(
        `[condition-bundler] Curated packs: ${curated.cpgCount} CPG, ${curated.gapCount} care-gap`,
      );
    } catch (err) {
      console.error('[condition-bundler] Curated knowledge packs failed:', err);
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
 * Seed CPG + disability care-gap packs only (used after literature wipe on
 * re-download so offline guidance returns without waiting on PubMed).
 */
export async function bundleCuratedKnowledgePacks(patientId: string): Promise<void> {
  const conditions = selectConditionsForBundling(patientId);
  seedCuratedKnowledgePacks(conditions.map((c) => c.name));
}

/**
 * Bundle SDOH context from CDC PLACES for the patient's geography.
 * D5: the geography comes from `patient.location` (free-text county/state
 * set during onboarding). Falls back to a fixture record on failure.
 */
export async function bundleSdohPack(patientId: string, location?: string): Promise<void> {
  const profile = getOnboardingProfile();
  const loc = (location ?? (profile.patient as { location?: string }).location ?? '').trim();
  if (!loc) {
    console.log('[condition-bundler] bundleSdohPack skipped — no patient.location set.');
    return;
  }
  try {
    const t0 = Date.now();
    const rec = await fetchCdcPlaces({ location: loc });
    if (rec) {
      const tagged = cdcToChunks(rec).map((c) => ({
        ...c,
        conditions: 'SDOH',
      }));
      insertWithSectionChunking(tagged);
      logEnrichment(
        patientId, 'condition', 'sdoh', 'cdc-places', 'bundled',
        loc, tagged.length, Date.now() - t0,
        tagged.map((c) => c.chunkId),
      );
    }
  } catch (err) {
    console.error(`[condition-bundler] CDC PLACES failed for ${loc}:`, err);
  }
}

/**
 * HEDIS measure pack — intentionally a no-op.
 *
 * Auto-inserting ambulatory HEDIS goals/evidence polluted Care UI, SLM
 * explain prompts, and BM25. Disability-first care gaps are handled by the
 * `detect-care-gaps` skill. Kept as an exported stub so call sites can be
 * removed gradually without import breaks.
 */
export async function bundleMeasurePack(_patientId: string): Promise<void> {
  // no-op
}

/**
 * Bundle systematic-review + meta-analysis evidence for each condition.
 * P5b / D6: restricts to PubMed's high-quality evidence tier via
 * `systematic[sb] OR meta-analysis[pt]`. Tagged with `documentType:
 * 'systematic_review'` and `lengthTier: 'long'` so the prompt-router
 * surfaces them in deep mode only.
 */
export async function bundleSystematicReviewPack(patientId: string): Promise<void> {
  const conditions = selectConditionsForBundling(patientId);
  const profile = getOnboardingProfile();
  const pii = {
    patientName: profile.patient.name,
    caregiverName: profile.caregiver.name,
    providerName: profile.primaryCareProvider.name,
  };

  for (const condition of conditions) {
    try {
      const rawQuery = buildPubMedQuery(condition.name, { caregiverFocus: true });
      const deidQuery = deidentifyQuery(rawQuery, pii);
      const t0 = Date.now();
      await nlmRateLimiter.throttle();
      const search = await searchPubMed({ query: deidQuery, retmax: 5, filter: 'systematic_review' });
      await nlmRateLimiter.throttle();
      const abstracts = await fetchAbstracts(search.pmids);
      const tagged: KnowledgeChunk[] = filterNewChunks(abstracts.map((c) => ({
        ...c,
        conditions: condition.name,
        queryHash: hashQuery(deidQuery),
        documentType: 'systematic_review',
        lengthTier: 'long',
      })));
      if (tagged.length > 0) {
        insertWithSectionChunking(tagged);
      }
      logEnrichment(
        patientId, 'condition', condition.conditionId, 'pubmed', 'bundled',
        `${deidQuery} (systematic_review filter)`, tagged.length, Date.now() - t0,
        tagged.map((c) => c.chunkId),
      );
    } catch (err) {
      console.error(`[condition-bundler] Systematic-review bundle failed for ${condition.name}:`, err);
    }
  }
}

/**
 * Bundle full Structured Product Label (SPL) sections for each active med.
 * P5b / D6: asks DailyMed for the structured sections (indications,
 * warnings, dosage, contraindications) and emits one chunk per section so
 * the retriever can surface only the relevant one in deep mode.
 */
export async function bundleFullSplPack(patientId: string): Promise<void> {
  const medications = getActiveMedications(patientId);
  for (const med of medications) {
    try {
      const t0 = Date.now();
      await nlmRateLimiter.throttle();
      const labels = await fetchDrugLabel(med.name, true);
      insertWithSectionChunking(labels);
      logEnrichment(
        patientId, 'medication', med.medicationId, 'dailymed', 'bundled',
        `${med.name} (full SPL)`, labels.length, Date.now() - t0,
        labels.map((c) => c.chunkId),
      );
    } catch (err) {
      console.error(`[condition-bundler] Full SPL bundle failed for ${med.name}:`, err);
    }
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
      const medKey = med.name.trim().toLowerCase();
      const taggedChunks: KnowledgeChunk[] = labels.map((c) => ({
        ...c,
        conditions: med.name,
      }));
      insertWithSectionChunking(taggedChunks, { medKey });

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
      insertWithSectionChunking(events, {
        medKey: med.name.trim().toLowerCase(),
      });

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
      insertWithSectionChunking(recalls, {
        medKey: med.name.trim().toLowerCase(),
      });

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

      insertWithSectionChunking(taggedChunks);
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

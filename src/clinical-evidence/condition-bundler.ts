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
  insertKnowledgeChunksForPatient,
  insertEnrichmentLogEntry,
  setBundlePending,
  setBundleStatus,
  getKnowledgeChunkForPatient,
  stampKnowledgeChunkForPatient,
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

// Per-host limiters so PubMed / DailyMed / OpenFDA don't serialize each other.
// NCBI allows ~3 req/s without a key; DailyMed is flakier so stay gentler.
const pubmedLimiter = new RateLimiter(350);
const medlineplusLimiter = new RateLimiter(300);
const rxnormLimiter = new RateLimiter(300);
const dailymedLimiter = new RateLimiter(400);
const openfdaLimiter = new RateLimiter(300);

export type BundleProgressUpdate = {
  phase: string;
  completedSteps: number;
  totalSteps: number;
  chunksAdded: number;
};

export type BundlePackOptions = {
  /** When false, caller owns setBundleStatus lifecycle. Default true. */
  manageLifecycle?: boolean;
  onProgress?: (update: BundleProgressUpdate) => void;
  /** Optional step offset when this pack is one phase of a larger run. */
  stepOffset?: number;
  totalSteps?: number;
};

const MED_CONCURRENCY = 3;

/**
 * Section-chunk long knowledge rows before insertion (planning/35 §5.4).
 * Always stamps patient_id so corpora stay isolated per profile.
 */
function insertWithSectionChunking(
  patientId: string,
  chunks: KnowledgeChunk[],
  opts?: { medKey?: string; source?: string },
): number {
  if (!patientId.trim() || chunks.length === 0) return 0;
  const prepared = chunks.map((c) => ({ ...c, patientId }));
  const expanded = sectionChunkKnowledgeBatch(prepared).map((c) =>
    stampKnowledgeChunkForPatient(patientId, c),
  );
  insertKnowledgeChunksForPatient(patientId, expanded);
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
 * Filter out chunks that already exist for this patient (after stamping).
 * Prevents later packs from no-op replacing within the same patient corpus.
 */
function filterNewChunks(patientId: string, chunks: KnowledgeChunk[]): KnowledgeChunk[] {
  return chunks
    .map((c) => stampKnowledgeChunkForPatient(patientId, { ...c, patientId }))
    .filter((c) => !getKnowledgeChunkForPatient(patientId, c.chunkId));
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
 * Per planning/32 §10.2, this also calls UMLS (ICD-10 → MeSH). UMLS runs first
 * so the returned MeSH term can expand the PubMed query; remaining sources for
 * a condition run in parallel.
 *
 * When `manageLifecycle` is false (unified runner), status is left to the caller
 * so medication packs can keep "in_flight" until everything finishes.
 */
export async function bundleConditionPack(
  patientId: string,
  options: BundlePackOptions = {},
): Promise<number> {
  const manageLifecycle = options.manageLifecycle !== false;
  if (manageLifecycle) {
    setBundlePending(patientId, true);
    setBundleStatus(patientId, {
      state: 'in_flight',
      chunksAdded: 0,
      progress: 0,
      phase: 'Conditions',
      completedSteps: 0,
      totalSteps: 1,
    });
  }

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
  const stepOffset = options.stepOffset ?? 0;
  const totalSteps = options.totalSteps ?? Math.max(conditions.length + 1, 1);
  let completedLocal = 0;

  const report = (phase: string) => {
    options.onProgress?.({
      phase,
      completedSteps: stepOffset + completedLocal,
      totalSteps,
      chunksAdded: totalChunks,
    });
  };

  try {
    for (const condition of conditions) {
      const conditionName = condition.name;
      const icdCode = condition.icd10;
      report(`Conditions · ${conditionName}`);

      // --- UMLS first (feeds MeSH into PubMed) ----------------------------
      let meshTerm: string | undefined;
      if (icdCode) {
        try {
          const t0 = Date.now();
          const mapping = await lookupUmls({ code: icdCode, vocabulary: 'ICD10' });
          if (mapping) {
            const tagged = umlsToChunks(mapping).map((c) => ({
              ...c,
              conditions: conditionName,
            }));
            totalChunks += insertWithSectionChunking(patientId, tagged);
            logEnrichment(
              patientId, 'condition', condition.conditionId, 'umls', 'bundled',
              `ICD10:${icdCode}`, tagged.length, Date.now() - t0,
              tagged.map((c) => c.chunkId),
            );
            meshTerm = mapping.related.find((r) => r.vocabulary === 'MeSH')?.term;
          }
        } catch (err) {
          console.error(`[condition-bundler] UMLS failed for ${icdCode}:`, err);
        }
      }

      // PubMed + MedlinePlus + Orphanet in parallel (separate hosts / fixtures).
      const parallel: Promise<void>[] = [];

      parallel.push((async () => {
        try {
          const baseQuery = buildPubMedQuery(conditionName, { caregiverFocus: true });
          const expandedQuery = meshTerm ? `${baseQuery} (${meshTerm}[MeSH Terms])` : baseQuery;
          const deidQuery = deidentifyQuery(expandedQuery, pii);
          const t0 = Date.now();
          await pubmedLimiter.throttle();
          const searchResult = await searchPubMed({ query: deidQuery, retmax: 5 });
          await pubmedLimiter.throttle();
          const abstracts = await fetchAbstracts(searchResult.pmids);
          const taggedChunks: KnowledgeChunk[] = abstracts.map((c) => ({
            ...c,
            conditions: conditionName,
            queryHash: hashQuery(deidQuery),
          }));
          totalChunks += insertWithSectionChunking(patientId, taggedChunks);
          logEnrichment(
            patientId, 'condition', condition.conditionId, 'pubmed', 'bundled',
            deidQuery, taggedChunks.length, Date.now() - t0,
            taggedChunks.map((c) => c.chunkId),
          );
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          console.error(`[condition-bundler] PubMed failed for ${conditionName}:`, err);
        }
      })());

      if (icdCode) {
        parallel.push((async () => {
          try {
            const t0 = Date.now();
            await medlineplusLimiter.throttle();
            const topics = await fetchHealthTopic({ code: icdCode, codeSystem: 'icd10' });
            const taggedChunks: KnowledgeChunk[] = topics.map((c) => ({
              ...c,
              conditions: conditionName,
            }));
            totalChunks += insertWithSectionChunking(patientId, taggedChunks);
            logEnrichment(
              patientId, 'condition', condition.conditionId, 'medlineplus', 'bundled',
              `ICD10:${icdCode}`, taggedChunks.length, Date.now() - t0,
              taggedChunks.map((c) => c.chunkId),
            );
          } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
            console.error(`[condition-bundler] MedlinePlus failed for ${icdCode}:`, err);
          }
        })());
      }

      parallel.push((async () => {
        try {
          const t0 = Date.now();
          const record = await searchOrphanet({ disease: conditionName });
          if (record) {
            const tagged = orphanetToChunks(record).map((c) => ({
              ...c,
              conditions: conditionName,
            }));
            totalChunks += insertWithSectionChunking(patientId, tagged);
            logEnrichment(
              patientId, 'condition', condition.conditionId, 'orphanet', 'bundled',
              conditionName, tagged.length, Date.now() - t0,
              tagged.map((c) => c.chunkId),
            );
          }
        } catch (err) {
          console.error(`[condition-bundler] Orphanet failed for ${conditionName}:`, err);
        }
      })());

      await Promise.all(parallel);
      completedLocal += 1;
      report(`Conditions · ${conditionName}`);
    }

    try {
      const curated = seedCuratedKnowledgePacks(patientId, conditions.map((c) => c.name));
      totalChunks += curated.cpgCount + curated.gapCount;
      console.log(
        `[condition-bundler] Curated packs: ${curated.cpgCount} CPG, ${curated.gapCount} care-gap`,
      );
    } catch (err) {
      console.error('[condition-bundler] Curated knowledge packs failed:', err);
    }
    completedLocal += 1;
    report('Conditions · offline packs');
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    console.error('[condition-bundler] Bundle aborted:', err);
  } finally {
    if (manageLifecycle) {
      const status: BundleStatus =
        totalChunks > 0
          ? { state: 'complete', chunksAdded: totalChunks, progress: 1 }
          : lastError
            ? { state: 'failed', chunksAdded: 0, error: lastError, progress: 1 }
            : { state: 'complete', chunksAdded: 0, progress: 1 };
      setBundleStatus(patientId, status);
      setBundlePending(patientId, false);
      console.log(`[condition-bundler] Bundle finished for ${patientId}: ${status.state} (${totalChunks} chunks)`);
    } else {
      console.log(`[condition-bundler] Condition pack done for ${patientId}: ${totalChunks} chunks`);
    }
  }
  return totalChunks;
}

/**
 * Seed CPG + disability care-gap packs only (used after literature wipe on
 * re-download so offline guidance returns without waiting on PubMed).
 */
export async function bundleCuratedKnowledgePacks(patientId: string): Promise<void> {
  const conditions = selectConditionsForBundling(patientId);
  seedCuratedKnowledgePacks(patientId, conditions.map((c) => c.name));
}

/**
 * Bundle SDOH context from CDC PLACES for the patient's geography.
 * D5: the geography comes from `patient.location` (free-text county/state
 * set during onboarding). Falls back to a fixture record on failure.
 */
export async function bundleSdohPack(
  patientId: string,
  location?: string,
  options: BundlePackOptions = {},
): Promise<number> {
  const profile = getOnboardingProfile();
  const loc = (location ?? (profile.patient as { location?: string }).location ?? '').trim();
  if (!loc) {
    console.log('[condition-bundler] bundleSdohPack skipped — no patient.location set.');
    options.onProgress?.({
      phase: 'Community context · skipped',
      completedSteps: (options.stepOffset ?? 0) + 1,
      totalSteps: options.totalSteps ?? 1,
      chunksAdded: 0,
    });
    return 0;
  }
  let chunks = 0;
  try {
    const t0 = Date.now();
    options.onProgress?.({
      phase: `Community context · ${loc}`,
      completedSteps: options.stepOffset ?? 0,
      totalSteps: options.totalSteps ?? 1,
      chunksAdded: 0,
    });
    const rec = await fetchCdcPlaces({ location: loc });
    if (rec) {
      const tagged = cdcToChunks(rec).map((c) => ({
        ...c,
        conditions: 'SDOH',
      }));
      chunks = insertWithSectionChunking(patientId, tagged);
      logEnrichment(
        patientId, 'condition', 'sdoh', 'cdc-places', 'bundled',
        loc, tagged.length, Date.now() - t0,
        tagged.map((c) => c.chunkId),
      );
    }
  } catch (err) {
    console.error(`[condition-bundler] CDC PLACES failed for ${loc}:`, err);
  }
  options.onProgress?.({
    phase: 'Community context · done',
    completedSteps: (options.stepOffset ?? 0) + 1,
    totalSteps: options.totalSteps ?? 1,
    chunksAdded: chunks,
  });
  return chunks;
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
      await pubmedLimiter.throttle();
      const search = await searchPubMed({ query: deidQuery, retmax: 5, filter: 'systematic_review' });
      await pubmedLimiter.throttle();
      const abstracts = await fetchAbstracts(search.pmids);
      const tagged: KnowledgeChunk[] = filterNewChunks(patientId, abstracts.map((c) => ({
        ...c,
        conditions: condition.name,
        queryHash: hashQuery(deidQuery),
        documentType: 'systematic_review',
        lengthTier: 'long',
      })));
      if (tagged.length > 0) {
        insertWithSectionChunking(patientId, tagged);
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
      await dailymedLimiter.throttle();
      const labels = await fetchDrugLabel(med.name, true);
      if (labels.length === 0) {
        console.warn(
          `[condition-bundler] Full SPL empty for ${med.name} (skipped)`,
        );
        continue;
      }
      insertWithSectionChunking(patientId, labels);
      logEnrichment(
        patientId, 'medication', med.medicationId, 'dailymed', 'bundled',
        `${med.name} (full SPL)`, labels.length, Date.now() - t0,
        labels.map((c) => c.chunkId),
      );
    } catch (err) {
      console.warn(
        `[condition-bundler] Full SPL skipped for ${med.name}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/**
 * Bundle medication packs for a patient: RxNorm normalization, DailyMed labels,
 * OpenFDA adverse events + recalls for each active medication.
 *
 * Meds run with limited concurrency; per-med sources hit different hosts in
 * parallel so DailyMed slowness no longer blocks OpenFDA/RxNorm.
 */
export async function bundleMedicationPack(
  patientId: string,
  options: BundlePackOptions = {},
): Promise<number> {
  const medications = getActiveMedications(patientId);
  let totalChunks = 0;
  const stepOffset = options.stepOffset ?? 0;
  const totalSteps = options.totalSteps ?? Math.max(medications.length, 1);
  let completedLocal = 0;

  const report = (phase: string) => {
    options.onProgress?.({
      phase,
      completedSteps: stepOffset + completedLocal,
      totalSteps,
      chunksAdded: totalChunks,
    });
  };

  const runOne = async (med: (typeof medications)[number]): Promise<void> => {
    report(`Medications · ${med.name}`);
    const medKey = med.name.trim().toLowerCase();
    let medChunks = 0;

    await Promise.all([
      (async () => {
        try {
          const t0 = Date.now();
          await rxnormLimiter.throttle();
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
      })(),
      (async () => {
        try {
          const t0 = Date.now();
          await dailymedLimiter.throttle();
          const labels = await fetchDrugLabel(med.name);
          if (labels.length === 0) {
            console.warn(
              `[condition-bundler] DailyMed returned no label for ${med.name} (skipped)`,
            );
            return;
          }
          const taggedChunks: KnowledgeChunk[] = labels.map((c) => ({
            ...c,
            conditions: med.name,
          }));
          medChunks += insertWithSectionChunking(patientId, taggedChunks, { medKey });
          logEnrichment(
            patientId, 'medication', med.medicationId, 'dailymed', 'bundled',
            med.name, taggedChunks.length, Date.now() - t0,
            taggedChunks.map((c) => c.chunkId),
          );
        } catch (err) {
          console.warn(
            `[condition-bundler] DailyMed skipped for ${med.name}:`,
            err instanceof Error ? err.message : err,
          );
        }
      })(),
      (async () => {
        try {
          const t0 = Date.now();
          await openfdaLimiter.throttle();
          const events = await fetchAdverseEvents(med.name);
          medChunks += insertWithSectionChunking(patientId, events, { medKey });
          logEnrichment(
            patientId, 'medication', med.medicationId, 'openfda', 'bundled',
            med.name, events.length, Date.now() - t0,
            events.map((c) => c.chunkId),
          );
        } catch (err) {
          console.error(`[condition-bundler] OpenFDA events failed for ${med.name}:`, err);
        }
      })(),
      (async () => {
        try {
          const t0 = Date.now();
          await openfdaLimiter.throttle();
          const recalls = await fetchDrugRecalls(med.name);
          medChunks += insertWithSectionChunking(patientId, recalls, { medKey });
          logEnrichment(
            patientId, 'medication', med.medicationId, 'openfda', 'bundled',
            med.name, recalls.length, Date.now() - t0,
            recalls.map((c) => c.chunkId),
          );
        } catch (err) {
          console.error(`[condition-bundler] OpenFDA recalls failed for ${med.name}:`, err);
        }
      })(),
    ]);

    totalChunks += medChunks;
    completedLocal += 1;
    report(`Medications · ${med.name}`);
  };

  // Limited-concurrency pool so we don't stampede DailyMed.
  let next = 0;
  const workers = Array.from(
    { length: Math.min(MED_CONCURRENCY, Math.max(medications.length, 1)) },
    async () => {
      while (next < medications.length) {
        const idx = next;
        next += 1;
        await runOne(medications[idx]);
      }
    },
  );
  if (medications.length > 0) {
    await Promise.all(workers);
  } else {
    report('Medications · none');
  }

  console.log(`[condition-bundler] Medication pack done for ${patientId}: ${totalChunks} chunks`);
  return totalChunks;
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
      await pubmedLimiter.throttle();
      const searchResult = await searchPubMed({ query: deidQuery, retmax: 5 });
      await pubmedLimiter.throttle();
      const abstracts = await fetchAbstracts(searchResult.pmids);

      const taggedChunks: KnowledgeChunk[] = abstracts.map((c) => ({
        ...c,
        conditions: condition,
        queryHash: hashQuery(deidQuery),
      }));

      insertWithSectionChunking(patientId, taggedChunks);
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

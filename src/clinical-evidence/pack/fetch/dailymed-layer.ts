/**
 * meds_base — DailyMed labels for active patient medications only.
 *
 * Density strategy:
 * - Disability-priority chart meds → multi-section full SPL
 * - Other chart meds → single combined label (fast)
 * - Hard wall-clock budget; remaining names get offline digests
 * - No global formulary — on-demand overlay covers ad-hoc drugs
 */

import { fetchDrugLabel } from '@/clinical-evidence/dailymed-client';
import { isFixtureMode } from '@/clinical-evidence/fixture-mode';
import type { KnowledgeChunk } from '@/data/types';

import {
  MEDS_BASE_MAX_DRUGS,
  MEDS_LAYER_BUDGET_MS,
  MEDS_MAX_SETIDS_PRIORITY,
  MEDS_MAX_SETIDS_STANDARD,
  MEDS_PRIORITY_FULL_SPL,
} from '../catalog';
import { knowledgeChunksToPackRows } from '../normalize/chunk-builder';
import { mergeMedicationSeeds } from '../pack-seeds';
import type { PackChunkRow } from '../types';

const VERSION = '3.0.0';

/** Disability / complex-care meds get denser SPL first. */
const PRIORITY_MEDS = [
  'baclofen',
  'tizanidine',
  'diazepam',
  'clonazepam',
  'levetiracetam',
  'lamotrigine',
  'valproic acid',
  'clobazam',
  'midazolam',
  'lorazepam',
  'albuterol',
  'ipratropium',
  'tiotropium',
  'budesonide',
  'fluticasone',
  'prednisone',
  'glycopyrrolate',
  'oxybutynin',
  'polyethylene glycol',
  'omeprazole',
  'gabapentin',
  'morphine',
  'oxycodone',
  'sertraline',
  'melatonin',
  'azithromycin',
  'amoxicillin',
  'ondansetron',
  'scopolamine',
  'atropine',
  'phenytoin',
  'carbamazepine',
  'topiramate',
  'lacosamide',
  'dantrolene',
  'pregabalin',
];

function fallbackLabel(drug: string): KnowledgeChunk {
  const id = `DM-FALLBACK-${drug.replace(/\s+/g, '-').toLowerCase()}`;
  return {
    chunkId: id,
    externalId: id,
    source: 'dailymed',
    text: `${drug} (label digest). Follow the prescribed dose and schedule from the clinician. Do not change dose without clinical guidance. Watch for unusual sleepiness, breathing changes, rash, or vomiting and contact the care team. Store as labeled. This offline digest is reference-only, not a full prescribing label. Source: pack meds_base fallback.`,
    conditions: drug.toLowerCase(),
    retrievedAt: new Date().toISOString(),
    useCount: 0,
    documentType: 'synthetic',
    lengthTier: 'short',
    metadataJson: JSON.stringify({ medKey: drug.toLowerCase(), fallback: true }),
  };
}

function orderedMedNames(patientMeds: string[]): string[] {
  const chart = mergeMedicationSeeds(patientMeds);
  const prioritySet = new Set(PRIORITY_MEDS);
  const priority = chart.filter((m) => prioritySet.has(m));
  const rest = chart.filter((m) => !prioritySet.has(m));
  return [...priority, ...rest].slice(0, MEDS_BASE_MAX_DRUGS);
}

export type MedsLayerProgress = {
  done: number;
  total: number;
  drug?: string;
};

/**
 * Per-drug hard timeout so one stuck DailyMed call cannot freeze the pack forever.
 */
async function fetchOneDrug(
  name: string,
  fullSpl: boolean,
  maxSetids: number,
  timeoutMs: number,
): Promise<KnowledgeChunk[]> {
  const work = fetchDrugLabel(name, {
    fullSpl,
    maxSetids,
    pageSize: Math.max(3, maxSetids + 1),
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      work,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    if (result === null) {
      console.warn(`[pack/meds_base] Timeout ${timeoutMs}ms for ${name}`);
      return [];
    }
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchMedsBaseLayer(
  medications: string[],
  opts?: {
    onProgress?: (p: MedsLayerProgress) => void;
    signal?: { cancelled: boolean };
  },
): Promise<{
  version: string;
  rows: Omit<PackChunkRow, 'packLayer' | 'packVersion' | 'contentHash' | 'retrievedAt'>[];
}> {
  const names = orderedMedNames(medications);
  const chunks: KnowledgeChunk[] = [];
  const live = !isFixtureMode();
  let liveOk = 0;
  let liveFail = 0;
  let sectionCount = 0;
  const t0 = Date.now();
  let stoppedEarly = false;

  if (!live) {
    for (const name of names) chunks.push(fallbackLabel(name));
  } else {
    for (let i = 0; i < names.length; i++) {
      if (opts?.signal?.cancelled) {
        stoppedEarly = true;
        break;
      }
      const elapsed = Date.now() - t0;
      if (elapsed > MEDS_LAYER_BUDGET_MS) {
        console.warn(
          `[pack/meds_base] Budget ${MEDS_LAYER_BUDGET_MS}ms hit after ${i}/${names.length} drugs; finishing with partial set`,
        );
        // Fill remaining chart names with offline digests.
        for (let j = i; j < names.length; j++) {
          chunks.push(fallbackLabel(names[j]));
        }
        stoppedEarly = true;
        break;
      }

      const name = names[i];
      // Small patient lists: full SPL for priority meds and first N chart drugs.
      const isPriority =
        PRIORITY_MEDS.includes(name) || i < Math.min(MEDS_PRIORITY_FULL_SPL, names.length);
      const fullSpl = isPriority;
      const maxSetids = isPriority ? MEDS_MAX_SETIDS_PRIORITY : MEDS_MAX_SETIDS_STANDARD;
      const perDrugMs = isPriority ? 25_000 : 12_000;

      opts?.onProgress?.({
        done: i,
        total: names.length,
        drug: name,
      });

      try {
        const got = await fetchOneDrug(name, fullSpl, maxSetids, perDrugMs);
        if (got.length === 0) {
          liveFail += 1;
          chunks.push(fallbackLabel(name));
        } else {
          liveOk += 1;
          sectionCount += got.length;
          for (const c of got) {
            chunks.push({
              ...c,
              conditions: name.toLowerCase(),
              externalId: c.chunkId,
              documentType: c.documentType ?? 'spl_full',
              lengthTier: c.lengthTier ?? (fullSpl ? 'long' : 'medium'),
              metadataJson: JSON.stringify({
                ...(c.metadataJson ? JSON.parse(c.metadataJson) : {}),
                medKey: name.toLowerCase(),
                fullSpl,
              }),
            });
          }
        }
      } catch (err) {
        liveFail += 1;
        console.warn(
          `[pack/meds_base] Live fail ${name}:`,
          err instanceof Error ? err.message : err,
        );
        chunks.push(fallbackLabel(name));
      }

      // Yield so UI can paint progress (and keep-awake path stays responsive).
      if ((i + 1) % 2 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }

  opts?.onProgress?.({ done: names.length, total: names.length });

  const chars = chunks.reduce((n, c) => n + c.text.length, 0);
  console.log(
    `[pack/meds_base] names=${names.length} rawSections=${sectionCount} ` +
      `rawChunks=${chunks.length} chars≈${chars} liveOk=${liveOk} liveFail=${liveFail} ` +
      `ms=${Date.now() - t0} stoppedEarly=${stoppedEarly} fixtureMode=${!live}`,
  );

  return {
    version: VERSION,
    rows: knowledgeChunksToPackRows(chunks, 'meds_base', VERSION),
  };
}

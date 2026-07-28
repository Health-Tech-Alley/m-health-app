/**
 * MedlinePlus condition topics + patient-med drug pages.
 * ICD topics stay device-wide; drug consumer pages follow the active chart only.
 */

import { fetchDrugInfo, fetchHealthTopic } from '@/clinical-evidence/medlineplus-client';
import { isFixtureMode } from '@/clinical-evidence/fixture-mode';
import type { KnowledgeChunk } from '@/data/types';

import { knowledgeChunksToPackRows } from '../normalize/chunk-builder';
import { mergeMedicationSeeds, resolvePackIcdSeeds } from '../pack-seeds';
import type { PackChunkRow } from '../types';

const VERSION = '3.0.0';
/** MedlinePlus drug pages capped to active chart size. */
const MLP_DRUG_PAGE_LIMIT = 60;

const FALLBACK_BY_CODE: Record<string, string> = {
  'G80.0':
    'Cerebral palsy. Cerebral palsy (CP) is a group of disorders that affect movement and muscle tone. Care at home focuses on comfort, positioning, therapy plans from the clinical team, seizure safety when epilepsy is present, and watching breathing and feeding. Contact the care team for fever with breathing trouble, new seizure patterns, or skin breakdown under equipment.',
  'J44.9':
    'COPD. Chronic obstructive pulmonary disease makes breathing harder. Home care often includes prescribed inhalers, activity pacing, and monitoring oxygen if the clinician set a target. Seek urgent care for severe shortness of breath, confusion, or chest pain.',
  'Q05.9':
    'Spina bifida. Spina bifida can affect mobility, bladder and bowel control, and skin. Follow the urology and neurosurgery plans from the care team. Learn shunt warning signs when hydrocephalus is present and autonomic dysreflexia signs for higher lesions.',
  'S06.9':
    'Traumatic brain injury. After TBI, track headaches, sleep, mood, balance, and new weakness. Red flags include repeated vomiting, worsening confusion, or seizure. Coordinate rehab goals with the clinical team.',
  'I63.9':
    'Stroke. After stroke, watch for new one-sided weakness, speech changes, severe headache, or sudden confusion — call emergency services. Home rehab and fall prevention matter for recovery.',
  'G40.909':
    'Epilepsy. Follow the prescribed seizure action plan. Know rescue medication use and when to call 911 for prolonged or clustered seizures. Log frequency and triggers for the care team.',
  'R13.10':
    'Dysphagia. Follow texture and positioning plans from the swallow team. Watch coughing, wet voice, or fever after feeds and escalate new swallowing trouble promptly.',
};

function fallbackChunk(code: string, label: string): KnowledgeChunk {
  const body =
    FALLBACK_BY_CODE[code] ??
    `${label}. Caregiver-facing summary for home monitoring. Follow the care plan from the clinical team and seek urgent care for severe breathing trouble, prolonged seizure, blue lips, or unresponsiveness.`;
  const id = `MLP-FALLBACK-${code}`;
  return {
    chunkId: id,
    externalId: id,
    source: 'medlineplus',
    text: `${body} Source: MedlinePlus-style caregiver digest (offline pack).`,
    conditions: label,
    retrievedAt: new Date().toISOString(),
    useCount: 0,
    documentType: 'synthetic',
    lengthTier: 'medium',
  };
}

export async function fetchMedlinePlusLayer(
  conditions: string[],
  medications: string[] = [],
): Promise<{
  version: string;
  rows: Omit<PackChunkRow, 'packLayer' | 'packVersion' | 'contentHash' | 'retrievedAt'>[];
}> {
  const seeds = resolvePackIcdSeeds(conditions);
  const chunks: KnowledgeChunk[] = [];
  const live = !isFixtureMode();
  let liveOk = 0;
  let liveFail = 0;
  const t0 = Date.now();

  for (let i = 0; i < seeds.length; i++) {
    if (Date.now() - t0 > 90_000) {
      console.warn(`[pack/medlineplus] Budget hit at ${i}/${seeds.length} seeds`);
      break;
    }
    const seed = seeds[i];
    if (live) {
      try {
        const got = await Promise.race([
          fetchHealthTopic({ code: seed.code, codeSystem: 'icd10' }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000)),
        ]);
        if (got.length === 0) {
          liveFail += 1;
          console.warn(`[pack/medlineplus] Empty live topic for ${seed.code} (${seed.label})`);
        } else {
          liveOk += 1;
          for (const c of got) {
            chunks.push({
              ...c,
              conditions: seed.label,
              externalId: c.chunkId,
              documentType: c.documentType ?? 'synthetic',
              lengthTier: c.lengthTier ?? 'medium',
            });
          }
        }
      } catch (err) {
        liveFail += 1;
        console.warn(
          `[pack/medlineplus] Live fail ${seed.code}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  // Consumer drug pages for active chart meds only (complements DailyMed labels).
  if (live) {
    const drugs = mergeMedicationSeeds(medications).slice(0, MLP_DRUG_PAGE_LIMIT);
    for (const drug of drugs) {
      if (Date.now() - t0 > 120_000) {
        console.warn(`[pack/medlineplus] Drug-page budget hit after chart topics`);
        break;
      }
      try {
        const got = await fetchDrugInfo(drug);
        if (got.length === 0) continue;
        liveOk += 1;
        for (const c of got) {
          chunks.push({
            ...c,
            conditions: drug.toLowerCase(),
            externalId: c.chunkId,
            documentType: c.documentType ?? 'synthetic',
            lengthTier: c.lengthTier ?? 'medium',
          });
        }
      } catch (err) {
        liveFail += 1;
        console.warn(
          `[pack/medlineplus] drug page fail ${drug}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  // Fill ICD gaps with offline digests so pack stays useful offline.
  const have = new Set(
    chunks.map((c) => (c.conditions ?? '').toLowerCase()).filter(Boolean),
  );
  for (const seed of seeds) {
    if (!have.has(seed.label.toLowerCase())) {
      chunks.push(fallbackChunk(seed.code, seed.label));
      have.add(seed.label.toLowerCase());
    }
  }

  const chars = chunks.reduce((n, c) => n + c.text.length, 0);
  console.log(
    `[pack/medlineplus] seeds=${seeds.length} liveOk=${liveOk} liveFail=${liveFail} ` +
      `chunks=${chunks.length} chars≈${chars} fixtureMode=${!live}`,
  );

  return {
    version: VERSION,
    rows: knowledgeChunksToPackRows(chunks, 'medlineplus', VERSION),
  };
}

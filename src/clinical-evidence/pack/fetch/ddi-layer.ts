/**
 * ddi layer — practical interaction table from RxNorm / public pairs.
 */

import { getDrugInteractions, normalizeDrugName } from '@/clinical-evidence/rxnorm-client';
import { isFixtureMode } from '@/clinical-evidence/fixture-mode';
import type { KnowledgeChunk } from '@/data/types';

import { DDI_MAX_LIVE } from '../catalog';
import { sleep } from '@/clinical-evidence/rate-limiter';
import { knowledgeChunksToPackRows } from '../normalize/chunk-builder';
import { mergeMedicationSeeds } from '../pack-seeds';
import type { PackChunkRow } from '../types';

const VERSION = '2.0.0';

const PRACTICAL_PAIRS: { a: string; b: string; note: string }[] = [
  {
    a: 'baclofen',
    b: 'diazepam',
    note: 'Combined CNS depression risk — excess sleepiness or breathing slowing. Clinician-directed only; do not stack extra doses.',
  },
  {
    a: 'baclofen',
    b: 'tizanidine',
    note: 'Additive hypotonia / sedation. Report new weakness or falls to the care team.',
  },
  {
    a: 'baclofen',
    b: 'gabapentin',
    note: 'Additive sedation or dizziness possible. Report new falls or confusion.',
  },
  {
    a: 'levetiracetam',
    b: 'diazepam',
    note: 'Sedation stacking possible. Use rescue benzos only as prescribed for seizures.',
  },
  {
    a: 'levetiracetam',
    b: 'clonazepam',
    note: 'Sedation and coordination effects may add. Follow seizure plan only.',
  },
  {
    a: 'clobazam',
    b: 'valproic acid',
    note: 'Levels and sedation can change when combined — clinician monitors labs/dosing.',
  },
  {
    a: 'albuterol',
    b: 'propranolol',
    note: 'Non-selective beta blockers may blunt albuterol effect. Confirm full med list with clinician.',
  },
  {
    a: 'albuterol',
    b: 'metoprolol',
    note: 'Beta blockers may reduce bronchodilator response in some patients.',
  },
  {
    a: 'omeprazole',
    b: 'clopidogrel',
    note: 'Potential reduced antiplatelet effect with some PPIs. Clinician decides alternatives.',
  },
  {
    a: 'warfarin',
    b: 'amoxicillin',
    note: 'Antibiotics can alter INR — arrange monitoring when prescribed together.',
  },
  {
    a: 'warfarin',
    b: 'azithromycin',
    note: 'INR shifts possible with macrolides — clinician-directed monitoring.',
  },
  {
    a: 'sertraline',
    b: 'tramadol',
    note: 'Serotonin syndrome risk with some combinations — report agitation, fever, tremor.',
  },
  {
    a: 'morphine',
    b: 'diazepam',
    note: 'Opioid + benzo CNS/respiratory depression risk — only as explicitly prescribed.',
  },
  {
    a: 'glycopyrrolate',
    b: 'oxybutynin',
    note: 'Additive anticholinergic effects (dry mouth, constipation, confusion).',
  },
  {
    a: 'prednisone',
    b: 'ibuprofen',
    note: 'GI bleed risk rises with steroid + NSAID — ask about stomach protection.',
  },
];

function pairChunks(now: string): KnowledgeChunk[] {
  return PRACTICAL_PAIRS.map((p) => {
    const id = `DDI-PACK-${p.a}-${p.b}`;
    return {
      chunkId: id,
      externalId: id,
      source: 'rxnorm' as const,
      text: `Interaction note: ${p.a} and ${p.b}. ${p.note} Always confirm with the prescribing clinician. Source: pack ddi practical table.`,
      conditions: `${p.a},${p.b}`,
      retrievedAt: now,
      useCount: 0,
      documentType: 'synthetic' as const,
      lengthTier: 'short' as const,
      metadataJson: JSON.stringify({ medKey: p.a, pair: p.b }),
    };
  });
}

export async function fetchDdiLayer(medications: string[]): Promise<{
  version: string;
  rows: Omit<PackChunkRow, 'packLayer' | 'packVersion' | 'contentHash' | 'retrievedAt'>[];
}> {
  const chunks: KnowledgeChunk[] = [];
  const now = new Date().toISOString();
  // Always include curated pairs for disability-common combos.
  chunks.push(...pairChunks(now));

  // Live RxNorm pairs only among active chart meds (curated pairs always kept).
  const meds = mergeMedicationSeeds(medications).slice(0, 40);
  const live = !isFixtureMode();

  if (live && meds.length >= 2) {
    try {
      const cuis: string[] = [];
      const cuiToName = new Map<string, string>();
      const t0 = Date.now();
      // Normalize names with timeout protection — one stuck DNS lookup cannot hang the layer.
      for (let i = 0; i < meds.length; i++) {
        const med = meds[i];
        try {
          const norm = await Promise.race([
            normalizeDrugName(med),
            sleep(8_000).then(() => null),
          ]);
          if (norm?.rxCui) {
            cuis.push(norm.rxCui);
            cuiToName.set(norm.rxCui, med);
          }
        } catch {
          // Skip this med
        }
        if ((i + 1) % 10 === 0) {
          console.log(`[pack/ddi] normalized ${i + 1}/${meds.length} meds (${cuis.length} CUIs)…`);
          await sleep(200);
        }
        // Budget: don't normalize forever
        if (Date.now() - t0 > 60_000 && cuis.length >= 10) {
          console.warn(`[pack/ddi] Normalization budget hit at ${i + 1}/${meds.length} meds`);
          break;
        }
      }
      console.log(`[pack/ddi] normalized ${cuis.length}/${meds.length} meds in ${Date.now() - t0}ms`);

      if (cuis.length >= 2) {
        const interactions = await getDrugInteractions(cuis);
        console.log(`[pack/ddi] ${interactions.length} live interactions from ${cuis.length} CUIs`);
        for (const ix of interactions.slice(0, DDI_MAX_LIVE)) {
          const name1 = cuiToName.get(ix.rxCui1) ?? ix.rxCui1;
          const name2 = cuiToName.get(ix.rxCui2) ?? ix.rxCui2;
          const id = `DDI-${ix.rxCui1}-${ix.rxCui2}`;
          chunks.push({
            chunkId: id,
            externalId: id,
            source: 'rxnorm',
            text: `Interaction: ${name1} + ${name2}. ${ix.description}${ix.severity ? ` Severity: ${ix.severity}.` : ''} Reference only — not automatic dose advice.`,
            conditions: `${name1},${name2}`.toLowerCase(),
            retrievedAt: now,
            useCount: 0,
            documentType: 'synthetic',
            lengthTier: 'short',
            metadataJson: JSON.stringify({
              medKey: name1.toLowerCase(),
              severity: ix.severity,
            }),
          });
        }
      }
    } catch (err) {
      console.warn(
        '[pack/ddi] Live RxNorm interactions failed:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(`[pack/ddi] chunks=${chunks.length} live=${live} medSeeds=${meds.length}`);

  return {
    version: VERSION,
    rows: knowledgeChunksToPackRows(chunks, 'ddi', VERSION),
  };
}

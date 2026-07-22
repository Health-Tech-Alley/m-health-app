/**
 * Seed curated offline packs into knowledge_cache (CPGs + disability care gaps).
 *
 * Called after condition selection at onboarding / re-download. Small fixed
 * sets only — not a literature firehose.
 */

import { insertKnowledgeChunks } from '@/data';
import type { KnowledgeChunk } from '@/data/types';
import { selectCpgFixturesForConditions } from '@/knowledge/corpora/cpg-fixtures';
import type { RetrievedChunk } from '@/knowledge/types';
import {
  disabilityCareGapsToChunks,
  selectDisabilityCareGapsForConditions,
} from '@/knowledge/corpora/disability-care-gap-fixtures';

function cpgToKnowledgeChunk(cpg: RetrievedChunk, conditionCsv: string): KnowledgeChunk {
  return {
    chunkId: cpg.docId,
    source: 'synthetic',
    text: cpg.text,
    conditions: conditionCsv || undefined,
    retrievedAt: new Date().toISOString(),
    useCount: 0,
    documentType: cpg.documentType ?? 'guideline',
    lengthTier: cpg.lengthTier ?? 'medium',
    sectionHeading: cpg.sectionHeading,
    metadataJson: JSON.stringify({
      kind: 'cpg_fixture',
      docId: cpg.docId,
    }),
  };
}

/**
 * Insert matching CPG + disability care-gap chunks for the given conditions.
 * Idempotent via INSERT OR REPLACE on stable chunk ids.
 */
export function seedCuratedKnowledgePacks(conditionNames: string[]): {
  cpgCount: number;
  gapCount: number;
} {
  const names = conditionNames.map((n) => n.trim()).filter(Boolean);
  const conditionCsv = names.join(',');

  const cpgs = selectCpgFixturesForConditions(names);
  const cpgChunks = cpgs.map((c) => cpgToKnowledgeChunk(c, conditionCsv));

  const gaps = selectDisabilityCareGapsForConditions(names);
  const gapChunks = disabilityCareGapsToChunks(gaps, conditionCsv || 'care-gaps');

  const all = [...cpgChunks, ...gapChunks];
  if (all.length > 0) {
    insertKnowledgeChunks(all);
  }

  return { cpgCount: cpgChunks.length, gapCount: gapChunks.length };
}

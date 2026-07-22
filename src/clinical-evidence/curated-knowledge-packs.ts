/**
 * Seed curated offline packs into knowledge_cache (CPGs + disability care gaps).
 *
 * Called after condition selection at onboarding / re-download. Small fixed
 * sets only — not a literature firehose. Always patient-scoped (duplicated
 * into each patient's corpus for isolation).
 */

import { insertKnowledgeChunksForPatient } from '@/data';
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
    externalId: cpg.docId,
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
 * Insert matching CPG + disability care-gap chunks for the given patient.
 * Idempotent via INSERT OR REPLACE on patient-scoped chunk ids.
 */
export function seedCuratedKnowledgePacks(
  patientId: string,
  conditionNames: string[],
): {
  cpgCount: number;
  gapCount: number;
} {
  if (!patientId.trim()) {
    return { cpgCount: 0, gapCount: 0 };
  }
  const names = conditionNames.map((n) => n.trim()).filter(Boolean);
  const conditionCsv = names.join(',');

  const cpgs = selectCpgFixturesForConditions(names);
  const cpgChunks = cpgs.map((c) => cpgToKnowledgeChunk(c, conditionCsv));

  const gaps = selectDisabilityCareGapsForConditions(names);
  const gapChunks = disabilityCareGapsToChunks(gaps, conditionCsv || 'care-gaps');

  const all = [...cpgChunks, ...gapChunks];
  if (all.length > 0) {
    insertKnowledgeChunksForPatient(patientId, all);
  }

  return { cpgCount: cpgChunks.length, gapCount: gapChunks.length };
}

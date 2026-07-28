/**
 * Single-drug on-demand fetch → patient overlay (not pack wipe).
 */

import { fetchDrugLabel } from '@/clinical-evidence/dailymed-client';
import { insertKnowledgeChunksForPatient } from '@/data/repositories/knowledgeCacheRepository';
import type { KnowledgeChunk } from '@/data/types';
import {
  writeParentOfEdges,
  writeSharesMedicationEdges,
} from '@/knowledge/graph/knowledge-chunk-edge-writers';
import { sectionChunkKnowledgeBatch } from '@/clinical-evidence/section-chunk-helper';

/**
 * Pin a single medication label into the patient overlay knowledge_cache.
 * Does not modify the global pack DB.
 */
export async function fetchOnDemandMedToOverlay(
  patientId: string,
  drugName: string,
): Promise<KnowledgeChunk[]> {
  if (!patientId.trim() || !drugName.trim()) return [];
  const raw = await fetchDrugLabel(drugName, false);
  if (raw.length === 0) return [];

  const stamped = raw.map((c) => ({
    ...c,
    conditions: drugName.toLowerCase(),
    metadataJson: JSON.stringify({
      ...(c.metadataJson ? JSON.parse(c.metadataJson) : {}),
      medKey: drugName.toLowerCase(),
      onDemand: true,
      overlay: true,
    }),
  }));
  const sectioned = sectionChunkKnowledgeBatch(stamped);
  insertKnowledgeChunksForPatient(patientId, sectioned);
  try {
    writeParentOfEdges(sectioned, 'on_demand_med');
    writeSharesMedicationEdges(sectioned, drugName.toLowerCase(), {
      source: 'on_demand_med',
    });
  } catch {
    /* non-fatal */
  }
  return sectioned;
}

/**
 * RxNorm client.
 *
 * Drug name normalization (RxCUI), drug-drug interactions, and therapeutic
 * categories. Used by the medication management pillar and the SLM context.
 *
 * See planning/22_clinical-data-gathering.md §5c.
 */

import { withRetry } from './rate-limiter';

const RXNORM_BASE = 'https://rxnav.nlm.nih.gov/REST';
const TIMEOUT_MS = 8_000;

export interface DrugNormalizationResult {
  rxCui: string;
  displayName: string;
}

export interface DrugInteraction {
  rxCui1: string;
  rxCui2: string;
  description: string;
  severity?: string;
}

export async function normalizeDrugName(name: string): Promise<DrugNormalizationResult | null> {
  const url = new URL(`${RXNORM_BASE}/rxcui.json`);
  url.searchParams.set('name', name);

  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) return null;

  const json = await response.json();
  const idGroup = json?.idGroup;
  if (!idGroup?.rxnormId?.length) return null;

  return {
    rxCui: String(idGroup.rxnormId[0]),
    displayName: name,
  };
}

export async function getDrugInteractions(rxCuis: string[]): Promise<DrugInteraction[]> {
  if (rxCuis.length < 2) return [];

  const url = new URL(`${RXNORM_BASE}/interaction/list.json`);
  url.searchParams.set('rxcuis', rxCuis.join('+'));

  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) return [];

  const json = await response.json();
  const interactions: DrugInteraction[] = [];

  const interactionGroups = json?.fullInteractionTypeGroup ?? [];
  for (const group of interactionGroups) {
    const interactionTypes = group?.interactionType ?? [];
    for (const interaction of interactionTypes) {
      const desc = interaction?.interactionPair?.[0]?.description ?? '';
      const severity = interaction?.interactionPair?.[0]?.severity;
      const rxCui1 = interaction?.minConceptItem?.rxcui ?? '';
      const rxCui2 = interaction?.interactionPair?.[0]?.interactionConcept?.[1]?.minConceptItem?.rxcui ?? '';

      if (desc) {
        interactions.push({ rxCui1, rxCui2, description: desc, severity });
      }
    }
  }

  return interactions;
}

export async function getTherapeuticCategory(rxCui: string): Promise<string[]> {
  const url = new URL(`${RXNORM_BASE}/rxclass/classByRxcui.json`);
  url.searchParams.set('rxcui', rxCui);

  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) return [];

  const json = await response.json();
  const concepts = json?.rxclassDrugInfoList?.rxclassDrugInfo ?? [];
  const categories = new Set<string>();

  for (const concept of concepts) {
    const name = concept?.rxclassMinConceptItem?.className;
    if (name) categories.add(name);
  }

  return Array.from(categories);
}

async function fetchWithTimeout(url: string): Promise<Response> {
  return withRetry(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      // "A server with the specified hostname could not be found"
      // (NSURLErrorCannotFindHost, -1003) is common in the iOS simulator
      // when the host's DNS cache is stale. withRetry re-runs with
      // exponential backoff — the simulator's resolver usually recovers
      // within a few seconds, so the second or third attempt succeeds.
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }, { maxRetries: 3, baseDelayMs: 1500, maxDelayMs: 8000 });
}

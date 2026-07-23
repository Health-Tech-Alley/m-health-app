/**
 * On-demand medication safety context for Concierge chat and Meds UI.
 *
 * Runs RxNorm DDI only when the turn is med-related — never bulk-writes all
 * pairwise interactions into knowledge_cache at onboarding.
 */

import type { RetrievedChunk } from '@/knowledge/types';
import {
  getDrugInteractions,
  normalizeDrugName,
  type DrugInteraction,
} from './rxnorm-client';

export type MedSafetyContextArgs = {
  /** Active patient meds and/or meds mentioned this turn. */
  medicationNames: string[];
  /** NLU primary intent when available. */
  intent?: string | null;
  /** True when entity linker found medication entities. */
  hasMedicationEntities?: boolean;
  /** Free-text user message for keyword gate. */
  message?: string;
};

export type MedSafetyContextResult = {
  ran: boolean;
  reason: string;
  interactions: DrugInteraction[];
  /** Ephemeral chunks for prompt injection (not persisted). */
  chunks: RetrievedChunk[];
};

const MED_INTENT_RE =
  /med_check|medication|medicine|drug|dose|dosing|pill|refill|interaction|side\s*effect|baclofen|keppra|albuterol/i;

/**
 * Whether this turn should spend network on RxNorm DDI.
 */
export function shouldRunMedSafetyContext(args: MedSafetyContextArgs): boolean {
  if (args.intent === 'med_check') return true;
  if (args.hasMedicationEntities) return true;
  if (args.message && MED_INTENT_RE.test(args.message)) return true;
  return false;
}

/**
 * Normalize med names → RxCUIs → interaction list → ephemeral citation chunks.
 * Caps work for polypharmacy (max 8 meds normalized).
 */
export async function buildMedSafetyContext(
  args: MedSafetyContextArgs,
): Promise<MedSafetyContextResult> {
  const names = [...new Set(args.medicationNames.map((n) => n.trim()).filter(Boolean))];
  if (!shouldRunMedSafetyContext(args)) {
    return { ran: false, reason: 'not_med_turn', interactions: [], chunks: [] };
  }
  if (names.length < 2) {
    return {
      ran: false,
      reason: names.length === 0 ? 'no_meds' : 'need_two_meds_for_ddi',
      interactions: [],
      chunks: [],
    };
  }

  const limited = names.slice(0, 8);
  const rxCuis: string[] = [];
  const labelByCui = new Map<string, string>();

  for (const name of limited) {
    try {
      const norm = await normalizeDrugName(name);
      if (norm?.rxCui) {
        rxCuis.push(norm.rxCui);
        labelByCui.set(norm.rxCui, norm.displayName || name);
      }
    } catch {
      // best-effort per med
    }
  }

  const uniqueCuis = [...new Set(rxCuis)];
  if (uniqueCuis.length < 2) {
    return {
      ran: true,
      reason: 'insufficient_rxcui',
      interactions: [],
      chunks: [],
    };
  }

  let interactions: DrugInteraction[] = [];
  try {
    interactions = await getDrugInteractions(uniqueCuis);
  } catch {
    return { ran: true, reason: 'ddi_fetch_failed', interactions: [], chunks: [] };
  }

  const top = interactions.slice(0, 6);
  const chunks: RetrievedChunk[] = top.map((ix, i) => {
    const a = labelByCui.get(ix.rxCui1) ?? ix.rxCui1;
    const b = labelByCui.get(ix.rxCui2) ?? ix.rxCui2;
    const sev = ix.severity ? ` Severity: ${ix.severity}.` : '';
    return {
      docId: `RXNORM-DDI-${ix.rxCui1}-${ix.rxCui2}-${i}`,
      source: 'rxnorm',
      score: 1,
      documentType: 'abstract',
      lengthTier: 'short',
      text: `Drug interaction (${a} + ${b}): ${ix.description}.${sev} Confirm with the care team or pharmacist before changing any dose.`,
    };
  });

  return {
    ran: true,
    reason: top.length > 0 ? 'ddi_ok' : 'no_interactions_reported',
    interactions: top,
    chunks,
  };
}

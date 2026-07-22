/**
 * Disability-first home-care gap pack (replaces ambulatory HEDIS framing).
 *
 * Small, stable chunks seeded into knowledge_cache at onboarding so Concierge
 * and detect-care-gaps ground in ACCESS-DP population risks — not adult
 * preventive panels.
 */

import type { KnowledgeChunk } from '@/data/types';

export type DisabilityCareGapFixture = {
  id: string;
  /** Free-text match against patient condition names (optional = always seed). */
  match?: RegExp;
  title: string;
  text: string;
};

export const DISABILITY_CARE_GAP_FIXTURES: DisabilityCareGapFixture[] = [
  {
    id: 'GAP-aspiration-feeding',
    match: /cerebral\s*palsy|\bcp\b|gmfcs|stroke|tbi|brain\s*injur|dysphagia|copd/i,
    title: 'Aspiration and feeding safety',
    text:
      'Care gap — aspiration / feeding: confirm a current swallow plan (textures, pacing, upright position, G-tube if used). Watch coughing/choking during feeds, wet voice, or fever with respiratory change. Escalate new swallowing difficulty promptly. Document what changed around meals.',
  },
  {
    id: 'GAP-airway-suction',
    match: /cerebral\s*palsy|\bcp\b|gmfcs|copd|respiratory|tbi|brain\s*injur/i,
    title: 'Airway and suction readiness',
    text:
      'Care gap — airway: keep suction (if prescribed), positioning for secretion clearance, and SpO2 cutoff awareness ready at home. Know rescue inhaler / BiPAP plan when respiratory conditions are present. Red flags: SpO2 below the care-plan cutoff, accessory muscle use, blue/gray lips, inability to clear secretions.',
  },
  {
    id: 'GAP-skin-pressure',
    match: /cerebral\s*palsy|\bcp\b|gmfcs|spina\s*bifida|stroke|immob|wheelchair/i,
    title: 'Skin and pressure prevention',
    text:
      'Care gap — skin/pressure: scheduled repositioning, cushion/brace interface checks, and daily skin survey over bony prominences. Flag new redness that does not blanch, open areas, or moisture-related breakdown. Photograph only with consent policy; notify the care team early.',
  },
  {
    id: 'GAP-seizure-rescue',
    match: /cerebral\s*palsy|\bcp\b|epilep|seizure|tbi|brain\s*injur/i,
    title: 'Seizure rescue readiness',
    text:
      'Care gap — seizure: ensure rescue medication (if prescribed) is available, not expired, and that backup caregivers know first aid and when to call 911 (prolonged seizure, clustering, injury, breathing trouble after). Log frequency, duration, and triggers in the care log.',
  },
  {
    id: 'GAP-autonomic-dysreflexia',
    match: /spina\s*bifida|spinal\s*cord|myelomeningocele|parapleg|tetrapleg/i,
    title: 'Autonomic dysreflexia awareness',
    text:
      'Care gap — autonomic dysreflexia (lesions ~T6 and above): teach sudden hypertension, pounding headache, flushing/sweating above the lesion. First steps: sit upright, loosen clothing, check bladder catheter/bowel/skin. Call 911 if not resolving. Keep a written AD action card at home.',
  },
  {
    id: 'GAP-transfer-safety',
    match: /cerebral\s*palsy|\bcp\b|gmfcs|stroke|tbi|spina\s*bifida|mobility|transfer/i,
    title: 'Transfer and fall-risk supports',
    text:
      'Care gap — transfers: confirm equipment (lift/sling/board) is safe and caregivers trained. Two-person vs one-person plan should match current tone and comfort. Watch pain or skin shear during transfers; report new falls or near-falls. Do not rush transfers when tone is high.',
  },
  {
    id: 'GAP-bowel-bladder',
    match: /cerebral\s*palsy|\bcp\b|spina\s*bifida|neurogenic|incontinen|constipat|stroke/i,
    title: 'Bowel and bladder program',
    text:
      'Care gap — bowel/bladder: stick to the prescribed program (timing, CIC, meds, diet/fluids). Flag constipation with overflow, reduced urine output, cloudy foul urine with fever, or AD triggers from full bladder/bowel. Hydration targets should match the care plan.',
  },
  {
    id: 'GAP-therapy-followup',
    title: 'Therapy and specialist follow-through',
    text:
      'Care gap — therapy/specialty: track missed PT/OT/speech or specialty visits and why (transport, illness, staffing). Home exercise or stretch plans should match current goals. Bring a short list of changes (tone, skin, seizures, breathing, meds) to the next visit.',
  },
  {
    id: 'GAP-med-timing-polypharmacy',
    title: 'Medication timing and polypharmacy watch',
    text:
      'Care gap — medications: confirm active list matches bottles; note timing relative to feeds, tone, sleepiness, and constipation. Watch for missed/delayed doses and interactions when new meds start. Use the Concierge med check for specific drug questions; never stop a medicine without the prescriber.',
  },
  {
    id: 'GAP-breathing-red-flags',
    match: /copd|respiratory|cerebral\s*palsy|\bcp\b|tbi|stroke/i,
    title: 'Breathing red flags at home',
    text:
      'Care gap — breathing escalation: know the patient-specific SpO2 cutoff and when to call 911 vs contact the clinic. Watch increased work of breathing, color change, confusion, or inability to clear secretions. Keep rescue plan (inhaler, oxygen, BiPAP) current and accessible.',
  },
  {
    id: 'GAP-ed-utilization-context',
    title: 'Avoidable ED context for complex care',
    text:
      'Care gap — ED risk context: many ED visits in complex disability care follow infection, aspiration, uncontrolled seizures, device issues, or caregiver uncertainty. Early recognition of baseline change, same-day clinic access when available, and a written emergency information form can reduce avoidable visits — without delaying true emergencies.',
  },
];

export function selectDisabilityCareGapsForConditions(
  conditionNames: string[],
): DisabilityCareGapFixture[] {
  const haystack = conditionNames.join(' | ');
  return DISABILITY_CARE_GAP_FIXTURES.filter((gap) => {
    // Always-on gaps (no match) seed for every patient.
    if (!gap.match) return true;
    // Condition-specific gaps only when we have something to match.
    if (conditionNames.length === 0) return false;
    return gap.match.test(haystack);
  }).slice(0, 15);
}

export function disabilityCareGapsToChunks(
  gaps: DisabilityCareGapFixture[],
  conditionCsv: string,
): KnowledgeChunk[] {
  const now = new Date().toISOString();
  return gaps.map((gap) => ({
    chunkId: gap.id,
    source: 'synthetic' as const,
    text: `${gap.title}. ${gap.text}`,
    conditions: conditionCsv || 'care-gaps',
    retrievedAt: now,
    useCount: 0,
    documentType: 'guideline' as const,
    lengthTier: 'medium' as const,
    sectionHeading: gap.title,
    metadataJson: JSON.stringify({ kind: 'disability_care_gap', gapId: gap.id }),
  }));
}

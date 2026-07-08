/**
 * Clinical Practice Guideline (CPG) fixture corpus.
 *
 * Curated, citation-rich summaries of authoritative CPGs for the four
 * conditions in the demo population. These seed the "deep" chunk tier
 * (planning/32 §12) immediately without depending on a live CPG API
 * (NGC/ECRI requires scraping or licensing; the public APIs are
 * sparse).
 *
 * Tagging: each chunk carries `documentType: 'guideline'` and a
 * `lengthTier` so the prompt-router can budget correctly.
 */

import type { RetrievedChunk } from '../types';

export const CPG_FIXTURES: RetrievedChunk[] = [
  // -- Cerebral Palsy (AAN 2017) -------------------------------------------
  {
    docId: 'CPG-AAN-CP-2017',
    source: 'synthetic',
    score: 0,
    documentType: 'guideline',
    lengthTier: 'medium',
    sectionHeading: 'Spasticity management',
    text: 'AAN 2017 Cerebral Palsy Quality Measurement Set — key recommendations: (1) Spasticity assessment every 6 months using a validated scale (MAS or Tardieu). (2) First-line treatment: positioning, stretching, and orthotics. (3) Consider botulinum toxin or intrathecal baclofen for GMFCS IV-V when spasticity limits function or causes pain. (4) Coordinate with PT/OT for goal-directed therapy. Citation: AAN QMS 2017.',
  },
  {
    docId: 'CPG-AAN-CP-dysphagia',
    source: 'synthetic',
    score: 0,
    documentType: 'guideline',
    lengthTier: 'medium',
    sectionHeading: 'Dysphagia & nutrition',
    text: 'AAN 2017 CP care pathway — Dysphagia & nutrition: aspiration risk is elevated in GMFCS IV-V. Recommend formal swallow evaluation (VFSS or FEES) at diagnosis and after any acute change. Texture-modified diet and supervised feeds reduce pneumonia risk. Monitor weight and growth quarterly.',
  },
  {
    docId: 'CPG-AAN-CP-seizure',
    source: 'synthetic',
    score: 0,
    documentType: 'guideline',
    lengthTier: 'medium',
    sectionHeading: 'Comorbidities — seizure',
    text: 'AAN 2017 CP — Comorbidities: roughly 35% of individuals with CP have epilepsy. Caregiver education on seizure first aid, rescue medication use, and when to call 911 is recommended. Track seizure frequency and triggers in the daily care log.',
  },

  // -- COPD (GOLD 2024) ---------------------------------------------------
  {
    docId: 'CPG-GOLD-2024-stepwise',
    source: 'synthetic',
    score: 0,
    documentType: 'guideline',
    lengthTier: 'medium',
    sectionHeading: 'Pharmacologic stepwise therapy',
    text: 'GOLD 2024 — Pharmacologic management: Group A (low symptoms, low risk): a bronchodilator. Group B (high symptoms, low risk): a long-acting bronchodilator (LABA or LAMA). Group E (exacerbations ≥1/yr requiring hospitalization or ≥2 moderate): LABA + LAMA, consider adding inhaled corticosteroid if eosinophils ≥300. Citation: GOLD 2024 Report.',
  },
  {
    docId: 'CPG-GOLD-2024-exacerbation',
    source: 'synthetic',
    score: 0,
    documentType: 'guideline',
    lengthTier: 'medium',
    sectionHeading: 'Exacerbation management',
    text: 'GOLD 2024 — Exacerbation: short-acting bronchodilators, systemic corticosteroids (prednisone 40mg × 5 days), and antibiotics only if signs of bacterial infection (increased sputum purulence + dyspnea or volume). Home management when SpO2 ≥88% and no altered mental status. Hospitalize when severe (use of accessory muscles, paradoxical chest wall motion, altered mental status, or SpO2 <88%).',
  },
  {
    docId: 'CPG-GOLD-2024-oxygen',
    source: 'synthetic',
    score: 0,
    documentType: 'guideline',
    lengthTier: 'medium',
    sectionHeading: 'Long-term oxygen',
    text: 'GOLD 2024 — Long-term oxygen therapy: indicated when SpO2 ≤88% (or PaO2 ≤55 mmHg) at rest in stable disease, or ≤88% with exercise or sleep. Target SpO2 88–92% for most COPD patients. Above-target oxygen can worsen hypercapnia.',
  },

  // -- Post-stroke (AHA/ASA 2021) ----------------------------------------
  {
    docId: 'CPG-AHA-ASA-stroke-2021',
    source: 'synthetic',
    score: 0,
    documentType: 'guideline',
    lengthTier: 'medium',
    sectionHeading: 'Caregiver-facing summary',
    text: 'AHA/ASA 2021 — Caregiver-facing summary for stroke survivors: (1) Secondary prevention — antiplatelet, statin, BP control per ACC/AHA. (2) Rehabilitation — early mobilization within 24–48h when stable; 3h/day of task-specific therapy in the first 4–8 weeks. (3) Monitor for post-stroke depression, spasticity, shoulder pain, and dysphagia. (4) Fall prevention — home safety assessment before discharge.',
  },
  {
    docId: 'CPG-AHA-ASA-stroke-recovery',
    source: 'synthetic',
    score: 0,
    documentType: 'guideline',
    lengthTier: 'long',
    sectionHeading: 'Recovery trajectory',
    text: 'AHA/ASA 2021 — Recovery trajectory: most rapid gains in the first 3 months; continued improvement through 6–12 months with therapy; chronic-phase gains possible with consistent home exercise. Predictors of better recovery: younger age, smaller infarct, no prior stroke, early therapy initiation, and motivated patient + caregiver. Cite when counseling on expectations.',
  },

  // -- Spina Bifida (SBAA) -----------------------------------------------
  {
    docId: 'CPG-SBAA-autonomic-dysreflexia',
    source: 'synthetic',
    score: 0,
    documentType: 'guideline',
    lengthTier: 'medium',
    sectionHeading: 'Autonomic dysreflexia',
    text: 'Spina Bifida Association — Autonomic dysreflexia (AD): medical emergency in lesions at T6 and above. Triggers: full bladder, bowel impaction, skin breakdown, tight clothing. Symptoms: sudden hypertension, pounding headache, sweating/flushing above the lesion, bradycardia. First-line: sit upright, loosen clothing, check catheter, drain bladder; call 911 if not resolved in 5 minutes.',
  },
  {
    docId: 'CPG-SBAA-urological',
    source: 'synthetic',
    score: 0,
    documentType: 'guideline',
    lengthTier: 'medium',
    sectionHeading: 'Urological surveillance',
    text: 'SBAA — Urological surveillance: regular bladder monitoring (urodynamics, renal ultrasound) is essential to prevent kidney damage. Clean intermittent catheterization (CIC) is standard. Urinary tract infections require prompt treatment; asymptomatic bacteriuria is generally not treated.',
  },
];

export function getAllCpgFixtures(): RetrievedChunk[] {
  return CPG_FIXTURES;
}

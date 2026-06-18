/**
 * Synthetic clinical corpus fixtures for Track A (Expo Go) RAG testing.
 *
 * These are NOT real clinical advice. They are representative chunks for the
 * three use cases: Spina Bifida (autonomic dysreflexia), post-stroke
 * rehabilitation (ROM milestones), and COPD + TBI (respiratory distress).
 */

import type { RetrievedChunk } from '../types';

export type FixtureCorpus = {
  chunks: RetrievedChunk[];
};

export const OPENEVIDENCE_FIXTURES: RetrievedChunk[] = [
  // Spina Bifida — autonomic dysreflexia
  {
    docId: 'OE-spina-autonomic-dysreflexia',
    source: 'openevidence',
    text: 'Autonomic dysreflexia is a potentially life-threatening emergency in patients with spinal cord injury at T6 and above. It is triggered by a noxious stimulus below the level of injury, most commonly a full bladder or bowel. Signs include severe hypertension, pounding headache, bradycardia, flushing, and diaphoresis above the lesion.',
    score: 0,
  },
  {
    docId: 'OE-spina-bladder-distension',
    source: 'openevidence',
    text: 'Bladder distension is the most common cause of autonomic dysreflexia. Immediate steps include sitting the patient upright, loosening tight clothing, checking the urinary catheter for kinks or blockage, and seeking emergency care if symptoms do not resolve within minutes.',
    score: 0,
  },
  {
    docId: 'OE-spina-bradycardia-hypertension',
    source: 'openevidence',
    text: 'In autonomic dysreflexia, blood pressure can rise abruptly while heart rate falls due to unopposed vagal tone. A systolic blood pressure 20–40 mmHg above baseline in a person with spinal cord injury should be treated as autonomic dysreflexia until proven otherwise.',
    score: 0,
  },

  // Post-stroke — recovery milestones
  {
    docId: 'OE-stroke-rom-milestones',
    source: 'openevidence',
    text: 'Post-stroke rehabilitation focuses on restoring range of motion, strength, and functional mobility. Early mobilization within 24–48 hours is safe for stable patients. Passive and active ROM exercises should be performed several times daily to prevent contractures.',
    score: 0,
  },
  {
    docId: 'OE-stroke-spasticity',
    source: 'openevidence',
    text: 'Spasticity after stroke can limit ROM and cause pain. Positioning, stretching, splinting, and occupational therapy are first-line. Escalation to botulinum toxin or oral agents is considered when spasticity interferes with function or hygiene.',
    score: 0,
  },
  {
    docId: 'OE-stroke-falls-risk',
    source: 'openevidence',
    text: 'Falls are common after stroke due to hemiparesis, balance deficits, and orthostatic hypotension. Home safety modifications, gait training, and caregiver assistance during transfers reduce fall risk. Any fall with head impact or new weakness requires urgent evaluation.',
    score: 0,
  },

  // COPD + TBI — respiratory distress
  {
    docId: 'OE-copd-exacerbation',
    source: 'openevidence',
    text: 'A COPD exacerbation is characterized by increased dyspnea, cough, and sputum production. Common triggers are respiratory infections and air pollution. Caregivers should monitor for decreased activity tolerance, increased accessory muscle use, and changes in sputum color.',
    score: 0,
  },
  {
    docId: 'OE-copd-spo2-cutoff',
    source: 'openevidence',
    text: 'In patients with severe COPD, oxygen saturation targets are individualized. Many clinicians use 88–92% as a safe target range. SpO2 persistently below 88% with increased work of breathing or altered mental status is a red flag requiring urgent medical evaluation.',
    score: 0,
  },
  {
    docId: 'OE-copd-tbi-respiratory-depression',
    source: 'openevidence',
    text: 'Patients with COPD and traumatic brain injury are at risk for both hypoxic respiratory failure and CO2 retention. Sedating medications, including opioids and benzodiazepines, can worsen respiratory drive and should only be used under direct clinician guidance.',
    score: 0,
  },
  {
    docId: 'OE-copd-albuterol-prn',
    source: 'openevidence',
    text: 'Short-acting beta agonists such as albuterol are used as rescue therapy for acute bronchospasm in COPD. Increased frequency of use is a warning sign of worsening control. Persistent need beyond the prescribed regimen warrants contacting the care team.',
    score: 0,
  },

  // Cross-cutting emergency guidance
  {
    docId: 'OE-emergency-chest-pain',
    source: 'openevidence',
    text: 'Chest pain, severe shortness of breath, altered mental status, cyanosis, or unilateral weakness are emergency warning signs. Caregivers should call emergency services immediately and not wait for an algorithm or AI explanation.',
    score: 0,
  },
];

export const RXNORM_FIXTURES: RetrievedChunk[] = [
  {
    docId: 'RX-albuterol',
    source: 'rxnorm',
    text: 'Albuterol: short-acting beta-2 agonist used for acute bronchospasm. Brand names include ProAir, Ventolin. Common side effects include tremor, tachycardia, and nervousness.',
    score: 0,
  },
  {
    docId: 'RX-tiotropium',
    source: 'rxnorm',
    text: 'Tiotropium: long-acting muscarinic antagonist (LAMA) for maintenance treatment of COPD. Administered once daily via inhaler.',
    score: 0,
  },
  {
    docId: 'RX-prednisone',
    source: 'rxnorm',
    text: 'Prednisone: systemic corticosteroid used for COPD exacerbations. Can raise blood glucose, affect mood, and increase infection risk. Tapering is often required.',
    score: 0,
  },
];

export const DAILYMED_FIXTURES: RetrievedChunk[] = [
  {
    docId: 'DM-albuterol-inhaler',
    source: 'dailymed',
    text: 'Albuterol sulfate inhalation aerosol: for treatment or prevention of bronchospasm in patients with reversible obstructive airway disease. Prime before first use. Shake well before each spray.',
    score: 0,
  },
];

export const OPENFDA_FIXTURES: RetrievedChunk[] = [
  {
    docId: 'FDA-albuterol-adverse',
    source: 'openfda',
    text: 'FDA adverse event reporting for albuterol includes palpitations, chest pain, and paradoxical bronchospasm. Report new or worsening symptoms to a clinician or pharmacist.',
    score: 0,
  },
];

export function getAllClinicalFixtures(): RetrievedChunk[] {
  return [
    ...OPENEVIDENCE_FIXTURES,
    ...RXNORM_FIXTURES,
    ...DAILYMED_FIXTURES,
    ...OPENFDA_FIXTURES,
  ];
}

export function getPatientPlanFixtures(
  patientName: string,
  conditions: string[],
  medications: string[],
  spo2Cutoff?: string,
): RetrievedChunk[] {
  return [
    {
      docId: 'plan.patient.demographics',
      source: 'patient-plan',
      text: `Patient: ${patientName}. Conditions: ${conditions.join(', ')}.`,
      score: 0,
    },
    {
      docId: 'plan.patient.medications',
      source: 'patient-plan',
      text: `Current medications: ${medications.join(', ')}.`,
      score: 0,
    },
    ...(spo2Cutoff
      ? [
          {
            docId: 'plan.patient.spo2-cutoff',
            source: 'patient-plan' as const,
            text: `Patient-specific oxygen saturation cutoff: ${spo2Cutoff}. Readings below this level are considered a red flag.`,
            score: 0,
          },
        ]
      : []),
  ];
}

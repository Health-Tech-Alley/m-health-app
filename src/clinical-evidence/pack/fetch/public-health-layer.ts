/**
 * Public health layer — allowlisted CDC/NINDS/NHLBI caregiver digests (owned text).
 */

import { rawDocsToSectionedPackRows } from '../normalize/chunk-builder';
import type { PackChunkRow } from '../types';

const VERSION = '1.0.0';

const DIGESTS: {
  id: string;
  title: string;
  conditions: string;
  text: string;
}[] = [
  {
    id: 'cdc-caregiver-stress',
    title: 'Caregiver health',
    conditions: 'general,caregiver',
    text: `CDC caregiver guidance (digest): Family caregivers of people with complex disability face higher rates of stress, sleep disruption, and delayed self-care. Practical steps: schedule short daily recovery blocks; ask one trusted backup for respite; track mood and sleep for two weeks; contact the care team if exhaustion affects medication safety or emergency response. This is educational guidance, not a diagnosis. Source: CDC caregiver resources (allowlisted digest).`,
  },
  {
    id: 'ninds-cp-overview',
    title: 'Cerebral palsy overview',
    conditions: 'cerebral palsy,cp',
    text: `NINDS cerebral palsy overview (digest): CP is a group of permanent movement disorders from early brain injury. Severity ranges widely; GMFCS helps describe mobility. Home priorities often include positioning, spasticity comfort, seizure safety when epilepsy coexists, skin checks under equipment, and aspiration precautions with feeding plans. Call the care team for new fever with breathing trouble, seizure pattern change, or unexplained pain. Source: NINDS CP information (allowlisted digest).`,
  },
  {
    id: 'nhlbi-copd-home',
    title: 'COPD home monitoring',
    conditions: 'copd,chronic obstructive',
    text: `NHLBI COPD home care digest: Watch for increased shortness of breath, change in sputum, fever, or lower oxygen than the person's usual baseline. Keep rescue inhalers accessible, review action plan with the clinician, and seek urgent care for severe distress or confusion. SpO2 targets are individualized — use clinician-set cutoffs, not generic numbers. Source: NHLBI COPD materials (allowlisted digest).`,
  },
  {
    id: 'cdc-tbi-recovery',
    title: 'TBI recovery signals',
    conditions: 'tbi,traumatic brain injury,stroke',
    text: `CDC TBI recovery digest: After brain injury or stroke, track headaches, sleep, mood, balance, and new weakness. Gradual return to activity under clinical guidance reduces setbacks. Red flags needing urgent evaluation include repeated vomiting, worsening confusion, seizure, or one-sided weakness. Coordinate rehab goals with PT/OT/speech when prescribed. Source: CDC Heads Up / TBI materials (allowlisted digest).`,
  },
  {
    id: 'cdc-spina-bifida-home',
    title: 'Spina bifida home care',
    conditions: 'spina bifida,myelomeningocele',
    text: `CDC spina bifida home care digest: Lifelong plans often include bladder/bowel programs, skin surveillance, shunt warning signs when hydrocephalus is present, and autonomic dysreflexia education for higher lesions (sudden headache, hypertension — sit up, loosen clothing, check bladder/bowel, seek emergency care if unresolved). Latex precautions may apply. Source: CDC spina bifida resources (allowlisted digest).`,
  },
];

export async function fetchPublicHealthLayer(conditions: string[]): Promise<{
  version: string;
  rows: Omit<PackChunkRow, 'packLayer' | 'packVersion' | 'contentHash' | 'retrievedAt'>[];
}> {
  // Global pack: ship full allowlisted digest set.
  void conditions;
  const docs = DIGESTS.map((d) => ({
    chunkId: d.id,
    source: 'synthetic',
    text: `${d.title}. ${d.text}`,
    conditions: d.conditions,
    documentType: 'synthetic',
    lengthTier: 'medium',
    externalId: d.id,
    metadata: { allowlist: true, kind: 'public_health_digest' },
  }));
  return {
    version: VERSION,
    rows: rawDocsToSectionedPackRows(docs, 'public_health', VERSION),
  };
}

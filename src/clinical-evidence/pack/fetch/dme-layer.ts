/**
 * DME / home complex-care text pack (owned digests).
 */

import { rawDocsToSectionedPackRows } from '../normalize/chunk-builder';
import type { PackChunkRow } from '../types';

const VERSION = '1.0.0';

const DME_DOCS = [
  {
    id: 'dme-wheelchair-pressure',
    conditions: 'cerebral palsy,spina bifida,gmfcs',
    text: `Manual and power wheelchair home care. Check skin over ischial tuberosities and sacrum at least daily when the person cannot shift weight independently. Keep cushions inflated/intact per manufacturer guidance. Redness that does not blanch after 20–30 minutes off the surface needs clinical review the same day. Source: owned DME digest citing NIH/CDC pressure-injury prevention themes.`,
  },
  {
    id: 'dme-gtube-basics',
    conditions: 'cerebral palsy,dysphagia,feeding',
    text: `Gastrostomy tube home basics. Follow the clinic flush and feeding schedule. Stop feeds and call the care team for dislodgement, severe leakage, fever with abdominal pain, or vomiting with feeding intolerance. Keep emergency contact and spare supplies labeled. Source: owned DME digest.`,
  },
  {
    id: 'dme-suction-airway',
    conditions: 'cerebral palsy,copd,tbi',
    text: `Home suction readiness. Keep the machine charged, tubing clean and dry, and catheters sized per the care plan. Suction only as trained. Seek emergency care for severe distress, blue lips, or inability to clear secretions. Source: owned DME digest.`,
  },
  {
    id: 'dme-bipap-oxygen',
    conditions: 'copd,tbi,sleep',
    text: `Home respiratory support. Use oxygen or non-invasive ventilation only at clinician-set settings. Do not increase flow to chase numbers without guidance. Report mask sores, morning headaches, or rising CO2 symptoms to the team. Source: owned DME digest.`,
  },
  {
    id: 'dme-lift-transfer',
    conditions: 'cerebral palsy,stroke,gmfcs',
    text: `Patient lift and transfer safety. Inspect slings for fray before each use. Two-caregiver assists when the care plan requires it. Stop and reposition if the person shows pain or respiratory distress mid-transfer. Source: owned DME digest.`,
  },
];

export async function fetchDmeLayer(conditions: string[]): Promise<{
  version: string;
  rows: Omit<PackChunkRow, 'packLayer' | 'packVersion' | 'contentHash' | 'retrievedAt'>[];
}> {
  // Global pack: include all DME digests (filter was dropping most rows).
  void conditions;
  const docs = DME_DOCS.map((d) => ({
    chunkId: d.id,
    source: 'synthetic',
    text: d.text,
    conditions: d.conditions,
    documentType: 'synthetic',
    lengthTier: 'medium',
    externalId: d.id,
    metadata: { kind: 'dme_digest' },
  }));
  return {
    version: VERSION,
    rows: rawDocsToSectionedPackRows(docs, 'dme', VERSION),
  };
}

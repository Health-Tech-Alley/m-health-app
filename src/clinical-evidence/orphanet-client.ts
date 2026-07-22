/**
 * Orphanet (Orphadata) client — fixtures-first.
 *
 * Expert-authored rare/complex disease care guidance for CP, Spina Bifida,
 * and TBI. Live Orphadata parse is not implemented; we always use curated
 * fixtures so Track A and production demos stay honest and offline-safe.
 *
 * See planning/26_clinical-data-sources-research.md §4.
 */

import type { KnowledgeChunk } from '@/data/types';

export interface OrphanetRecord {
  /** Orphanet ORPHAcode (numeric). */
  orphaCode: string;
  /** Disease name. */
  name: string;
  /** Disease summary / definition. */
  summary: string;
  /** Care and management recommendations. */
  careGuidelines: string;
  /** Cross-walk to ICD-10 / SNOMED / MeSH where available. */
  crosswalks: { vocabulary: string; code: string; term: string }[];
}

export interface OrphanetSearchParams {
  /** Free-text disease name (e.g. "Cerebral Palsy"). */
  disease: string;
}

/**
 * Search Orphanet fixtures for a disease record. Live network fetch is not
 * used — fixtures are the product source until a real Orphadata parser lands.
 */
export async function searchOrphanet(params: OrphanetSearchParams): Promise<OrphanetRecord | null> {
  return fixtureSearch(params);
}

export function orphanetToChunks(record: OrphanetRecord | null): KnowledgeChunk[] {
  if (!record) return [];
  const now = new Date().toISOString();
  const crosswalkText = record.crosswalks.length > 0
    ? `\nCoding: ${record.crosswalks.map((c) => `${c.vocabulary}:${c.code}`).join(', ')}`
    : '';
  return [
    {
      chunkId: `ORPHANET-${record.orphaCode}`,
      source: 'orphanet',
      text: `${record.name}\n\n${record.summary}\n\nCare: ${record.careGuidelines}${crosswalkText}`,
      retrievedAt: now,
      useCount: 0,
      metadataJson: JSON.stringify({ orphaCode: record.orphaCode, fixture: true }),
    },
  ];
}

// ---------- Fixtures (authoritative offline pack) ----------

const FIXTURES: OrphanetRecord[] = [
  {
    orphaCode: 'ORPHA:210',
    name: 'Spastic cerebral palsy',
    summary:
      'Cerebral palsy (CP) is a group of permanent disorders of the development of movement and posture, causing activity limitation, attributed to non-progressive disturbances in the developing fetal or infant brain. The spastic form features increased muscle tone and exaggerated reflexes. GMFCS Level V indicates the most severe mobility limitation: transported in a manual wheelchair, limited antigravity head and trunk control, and total dependence for transfers and most ADLs.',
    careGuidelines:
      'Multidisciplinary home care for GMFCS IV–V: physiotherapy and positioning; spasticity management (oral meds, botulinum toxin, intrathecal baclofen as prescribed); hip and scoliosis surveillance; skin and pressure checks under braces/splints; dysphagia and aspiration precautions with supervised or texture-modified feeds / G-tube plans; seizure first aid and rescue med access when epilepsy is present; airway/suction readiness when secretions or low SpO2 are issues; caregiver education on red flags (fever with respiratory distress, new seizure pattern, skin breakdown). Coordinate PT/OT/speech and specialty clinics; document changes in tone, comfort, breathing, and energy in the care log.',
    crosswalks: [
      { vocabulary: 'ICD10', code: 'G80.0', term: 'Spastic quadriplegic CP' },
      { vocabulary: 'ICD10', code: 'G80.1', term: 'Spastic diplegic CP' },
      { vocabulary: 'SNOMED', code: '128188000', term: 'Spastic quadriplegic cerebral palsy' },
      { vocabulary: 'MeSH', code: 'D002547', term: 'Cerebral Palsy' },
    ],
  },
  {
    orphaCode: 'ORPHA:823',
    name: 'Spina bifida',
    summary:
      'Spina bifida is a neural tube defect with failed fusion of vertebral arches and varying protrusion of neural tissue. Open forms (myelomeningocele) carry risks of hydrocephalus, Chiari II malformation, and neurogenic bladder/bowel. Lesion level drives motor level, sensation, and autonomic risk.',
    careGuidelines:
      'Lifelong multidisciplinary care: neurosurgery surveillance (shunt, tethered cord); urology for CIC, renal protection, and UTI recognition; bowel program; orthopedics and mobility equipment; skin surveillance over pressure points and bracing. For lesions at T6 and above, teach autonomic dysreflexia (AD): sudden hypertension, pounding headache, flushing/sweating above the lesion — sit upright, loosen clothing, check bladder/bowel/skin, call 911 if unresolved. Latex precautions when relevant. Caregiver education is essential for home emergency recognition.',
    crosswalks: [
      { vocabulary: 'ICD10', code: 'Q05.9', term: 'Spina bifida, unspecified' },
      { vocabulary: 'SNOMED', code: '67531005', term: 'Spina bifida' },
      { vocabulary: 'MeSH', code: 'D013131', term: 'Spinal Dysraphism' },
    ],
  },
  {
    orphaCode: 'ORPHA:90056',
    name: 'Traumatic brain injury',
    summary:
      'Traumatic brain injury (TBI) is brain injury from external mechanical force. Severity ranges from mild concussion to severe diffuse axonal injury. Long-term sequelae include cognitive, behavioral, motor, seizure, and fatigue impairments that affect home caregiving load.',
    careGuidelines:
      'After acute neurotrauma care: structured rehab (PT/OT/speech, cognitive therapy), gradual activity pacing, and home safety for falls and agitation. Long-term surveillance for post-traumatic seizures (rescue plan if prescribed), mood/behavior changes, sleep disruption, headaches, and swallowing risk. Caregivers should track new weakness, confusion, severe headache, or seizure and know when to escalate. Coordinate with rehab and neurology; keep medication timing consistent and document functional changes against baseline.',
    crosswalks: [
      { vocabulary: 'ICD10', code: 'S06.9', term: 'Unspecified intracranial injury' },
      { vocabulary: 'MeSH', code: 'D020197', term: 'Brain Injuries' },
    ],
  },
];

const ALIASES: { match: RegExp; orphaCode: string }[] = [
  { match: /cerebral\s*palsy|\bcp\b|gmfcs|spastic\s+quad/i, orphaCode: 'ORPHA:210' },
  { match: /spina\s*bifida|myelomeningocele|neural\s*tube/i, orphaCode: 'ORPHA:823' },
  { match: /traumatic\s*brain|\btbi\b|head\s*injur/i, orphaCode: 'ORPHA:90056' },
];

function fixtureSearch(params: OrphanetSearchParams): OrphanetRecord | null {
  const lc = params.disease.toLowerCase();
  const byName = FIXTURES.find(
    (f) => f.name.toLowerCase().includes(lc) || lc.includes(f.name.toLowerCase()),
  );
  if (byName) return byName;
  for (const alias of ALIASES) {
    if (alias.match.test(params.disease)) {
      return FIXTURES.find((f) => f.orphaCode === alias.orphaCode) ?? null;
    }
  }
  return null;
}

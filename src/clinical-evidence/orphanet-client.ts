/**
 * Orphanet (Orphadata) client.
 *
 * Pulls expert-authored rare-disease clinical descriptions, care guidelines,
 * and management recommendations. Per planning/26, this enriches the
 * knowledge cache for CP-specific guidance (CP is included in Orphanet's
 * rare disease list) and supports the SLM's ability to give condition-
 * specific answers for rare/complex conditions.
 *
 * Track A: ships with realistic fixtures for CP and Spina Bifida. Live
 * fetch from orphadata.org requires no API key but ships a large XML
 * payload per disease.
 *
 * See planning/26_clinical-data-sources-research.md §4.
 */

import type { KnowledgeChunk } from '@/data/types';
import { withRetry } from './rate-limiter';
import { isFixtureMode } from './fixture-mode';

const ORPHANET_BASE = 'https://www.orphadata.com/data';
const TIMEOUT_MS = 15_000;

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
 * Search Orphanet for a rare-disease record. Returns the first match.
 */
export async function searchOrphanet(params: OrphanetSearchParams): Promise<OrphanetRecord | null> {
  if (isFixtureMode()) {
    return fixtureSearch(params);
  }
  const { disease } = params;
  const url = new URL(`${ORPHANET_BASE}/en/products.json`);
  url.searchParams.set('disease', disease);
  try {
    await fetchWithTimeout(url.toString());
  } catch {
    // 404 is expected for non-rare conditions (COPD, TBI, etc.) — Orphanet
    // only covers rare diseases. Not an error; just no data.
    return null;
  }
  // Live response parsing would depend on the actual Orphadata JSON
  // schema. Returning null until the dev build wires it up.
  return null;
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
      metadataJson: JSON.stringify({ orphaCode: record.orphaCode }),
    },
  ];
}

async function fetchWithTimeout(url: string): Promise<Response> {
  return withRetry(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Orphanet request failed: ${response.status}`);
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }, { maxRetries: 2, baseDelayMs: 1500, maxDelayMs: 8000 });
}

// ---------- Fixtures (Track A) ----------

const FIXTURES: OrphanetRecord[] = [
  {
    orphaCode: 'ORPHA:210',
    name: 'Spastic cerebral palsy',
    summary:
      'Cerebral palsy (CP) is a group of permanent disorders of the development of movement and posture, causing activity limitation, that are attributed to non-progressive disturbances that occurred in the developing fetal or infant brain. The spastic form is characterized by increased muscle tone and exaggerated reflexes.',
    careGuidelines:
      'Multidisciplinary care including physiotherapy, occupational therapy, and orthopedic management. Spasticity management (oral medications, botulinum toxin, intrathecal baclofen, selective dorsal rhizotomy) as indicated. Surveillance for hip displacement, scoliosis, and feeding difficulties. Respiratory care for those with severe motor impairment.',
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
      'Spina bifida is a group of neural tube defects characterized by failure of fusion of the vertebral arches with varying degrees of protrusion of neural tissue. Open forms (myelomeningocele) carry risks of hydrocephalus, Chiari II malformation, and neurogenic bladder/bowel.',
    careGuidelines:
      'Lifelong multidisciplinary care: neurosurgery for tethered cord / hydrocephalus surveillance; urology for bladder management and renal protection; orthopedics for mobility; dermatology for skin surveillance; bowel program. Caregiver education on autonomic dysreflexia warning signs is essential for lesions at T6 and above.',
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
      'Traumatic brain injury (TBI) is an injury to the brain caused by an external mechanical force. Severity ranges from mild concussion to severe diffuse axonal injury. Long-term sequelae include cognitive, behavioral, and physical impairments.',
    careGuidelines:
      'Acute care in neurotrauma ICU; rehabilitation (inpatient and outpatient) emphasizing early mobilization, cognitive therapy, and psychosocial support. Long-term surveillance for post-traumatic seizures, mood disorders, and post-concussion symptoms.',
    crosswalks: [
      { vocabulary: 'ICD10', code: 'S06.9', term: 'Unspecified intracranial injury' },
      { vocabulary: 'MeSH', code: 'D020197', term: 'Brain Injuries' },
    ],
  },
];

function fixtureSearch(params: OrphanetSearchParams): OrphanetRecord | null {
  const lc = params.disease.toLowerCase();
  return (
    FIXTURES.find((f) => f.name.toLowerCase().includes(lc) || lc.includes(f.name.toLowerCase())) ??
    null
  );
}

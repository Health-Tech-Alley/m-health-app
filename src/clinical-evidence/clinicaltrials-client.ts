/**
 * ClinicalTrials.gov API v2 client.
 *
 * Calls clinicaltrials.gov/api/v2/studies (REST, no auth) to retrieve study
 * protocols — full summaries, outcome measures, eligibility criteria,
 * locations, status, and phase. Per planning/26, this is one of the four
 * new clients added to deepen the knowledge cache for caregivers of
 * severely disabled loved ones (CP, TBI, COPD, etc.).
 *
 * Track A: ships with realistic fixture data so the cache is exercised in
 * code without live network. The fixture shape mirrors the live response
 * 1:1 so the live fetch path is a one-flag flip in Track B.
 *
 * See planning/26_clinical-data-sources-research.md §1.
 */

import type { KnowledgeChunk } from '@/data/types';
import { withRetry } from './rate-limiter';
import { isFixtureMode } from './fixture-mode';

const CTGOV_BASE = 'https://clinicaltrials.gov/api/v2/studies';
const TIMEOUT_MS = 15_000;

export interface ClinicalTrialRecord {
  nctId: string;
  title: string;
  condition: string;
  phase?: string;
  status?: string;
  eligibility?: string;
  /** Full narrative summary from the study record. */
  summary?: string;
  /** Outcome measures — list of {title, description}. */
  outcomes?: { title: string; description?: string }[];
  /** Geographic locations, as a flat list. */
  locations?: string[];
}

export interface ClinicalTrialSearchParams {
  condition: string;
  /** Phase filter, e.g. 'PHASE2', 'PHASE3'. Optional. */
  phase?: string;
  /** Overall status, e.g. 'RECRUITING'. Optional. */
  status?: string;
  pageSize?: number;
}

/**
 * Search ClinicalTrials.gov for studies matching a condition. De-identifies
 * the query via the standard rate-limited fetch path; returns structured
 * study records (or fixtures under Track A).
 */
export async function searchClinicalTrials(
  params: ClinicalTrialSearchParams,
): Promise<ClinicalTrialRecord[]> {
  if (isFixtureMode()) {
    return fixtureSearch(params);
  }
  const { condition, phase, status, pageSize = 10 } = params;
  const url = new URL(CTGOV_BASE);
  url.searchParams.set('query.cond', condition);
  if (phase) url.searchParams.set('query.phase', phase);
  if (status) url.searchParams.set('filter.overallStatus', status);
  url.searchParams.set('pageSize', String(pageSize));
  url.searchParams.set('format', 'json');

  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) {
    throw new Error(`ClinicalTrials.gov search failed: ${response.status}`);
  }
  const json = await response.json();
  const studies: any[] = json?.studies ?? [];
  return studies.map(parseStudy).filter((s): s is ClinicalTrialRecord => Boolean(s));
}

/**
 * Convert a list of clinical trial records into knowledge cache chunks.
 */
export function trialsToChunks(trials: ClinicalTrialRecord[]): KnowledgeChunk[] {
  const now = new Date().toISOString();
  return trials.map((t) => {
    const text = formatTrialText(t);
    return {
      chunkId: `CTGOV-${t.nctId}`,
      source: 'clinicaltrials',
      text,
      retrievedAt: now,
      useCount: 0,
      metadataJson: JSON.stringify({
        nctId: t.nctId,
        phase: t.phase,
        status: t.status,
      }),
    };
  });
}

function parseStudy(study: any): ClinicalTrialRecord | null {
  const protocol = study?.protocolSection;
  if (!protocol) return null;
  const id = protocol.identificationModule?.nctId;
  const title = protocol.identificationModule?.briefTitle;
  if (!id || !title) return null;

  const conditions = protocol.conditionsModule?.conditions ?? [];
  const phases = protocol.designModule?.phases ?? [];
  const status = protocol.statusModule?.overallStatus;
  const summary = protocol.descriptionModule?.detailedDescription;

  const eligibility = protocol.eligibilityModule?.eligibilityCriteria;
  const outcomes = (protocol.outcomesModule?.primaryOutcomes ?? []).map((o: any) => ({
    title: o?.measure ?? '',
    description: o?.description,
  }));
  const locations = (protocol.contactsLocationsModule?.locations ?? []).map(
    (l: any) => [l?.facility, l?.city, l?.state, l?.country].filter(Boolean).join(', '),
  );

  return {
    nctId: id,
    title,
    condition: conditions[0] ?? '',
    phase: phases[0],
    status,
    eligibility,
    summary,
    outcomes,
    locations,
  };
}

function formatTrialText(t: ClinicalTrialRecord): string {
  const lines: string[] = [];
  lines.push(`${t.title}`);
  if (t.condition) lines.push(`Condition: ${t.condition}`);
  if (t.phase) lines.push(`Phase: ${t.phase}`);
  if (t.status) lines.push(`Status: ${t.status}`);
  if (t.summary) lines.push(`\n${t.summary}`);
  if (t.eligibility) lines.push(`\nEligibility: ${t.eligibility}`);
  if (t.outcomes && t.outcomes.length > 0) {
    lines.push(`\nPrimary outcomes: ${t.outcomes.map((o) => o.title).filter(Boolean).join('; ')}`);
  }
  if (t.locations && t.locations.length > 0) {
    lines.push(`\nLocations: ${t.locations.slice(0, 5).join('; ')}${t.locations.length > 5 ? ` (and ${t.locations.length - 5} more)` : ''}`);
  }
  return lines.join('\n');
}

async function fetchWithTimeout(url: string): Promise<Response> {
  return withRetry(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`ClinicalTrials.gov request failed: ${response.status}`);
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }, { maxRetries: 2, baseDelayMs: 1500, maxDelayMs: 8000 });
}

// ---------- Fixtures (Track A) ----------

const FIXTURES: ClinicalTrialRecord[] = [
  {
    nctId: 'NCT05000001',
    title: 'Effects of Intensive Respiratory Therapy on COPD Exacerbation Rates',
    condition: 'COPD',
    phase: 'PHASE3',
    status: 'RECRUITING',
    summary:
      'A randomized, controlled study comparing intensive respiratory therapy (twice daily) plus standard care versus standard care alone in adults with severe COPD (GOLD stage III–IV). Primary outcome is 12-month exacerbation rate.',
    eligibility:
      'Adults 40–80 with confirmed COPD and ≥2 exacerbations in the prior year. Excludes active smokers, recent pneumonia, or home oxygen >15h/day.',
    outcomes: [
      { title: '12-month exacerbation rate' },
      { title: 'Hospitalization days' },
      { title: 'St. George Respiratory Questionnaire change' },
    ],
    locations: ['Johns Hopkins, Baltimore, MD', 'Mayo Clinic, Rochester, MN', 'UCSF, San Francisco, CA'],
  },
  {
    nctId: 'NCT05000002',
    title: 'Cerebral Palsy Caregiver Tele-Coaching Trial (CP-CARE)',
    condition: 'Cerebral Palsy',
    phase: 'PHASE2',
    status: 'ACTIVE_NOT_RECRUITING',
    summary:
      'Caregiver-led tele-coaching intervention for families of children with severe CP (GMFCS IV–V). The intervention trains caregivers in safe positioning, feeding, and respiratory care over 12 weeks.',
    eligibility:
      'Caregivers of children 2–17 with CP GMFCS IV–V, English or Spanish speaking, access to a smartphone.',
    outcomes: [
      { title: 'Caregiver confidence (LACI)' },
      { title: 'Respiratory illness days' },
    ],
    locations: ['Children\u2019s Hospital of Philadelphia', 'Boston Children\u2019s Hospital'],
  },
  {
    nctId: 'NCT05000003',
    title: 'TBI Recovery: Constraint-Induced Movement Therapy After Discharge',
    condition: 'Traumatic Brain Injury',
    phase: 'PHASE2',
    status: 'RECRUITING',
    summary:
      'Home-based CIMT (3 weeks) for adults with upper-limb weakness 3–12 months post-TBI. Compares home-CIMT to standard outpatient therapy.',
    eligibility:
      'Adults 18–75, first-ever TBI, ≥3 months post-injury, able to follow 2-step commands.',
    outcomes: [
      { title: 'Wolf Motor Function Test change' },
      { title: 'MAL (Motor Activity Log) change' },
    ],
    locations: ['Spaulding Rehabilitation, Boston, MA', 'Rehab Institute of Chicago, IL'],
  },
  {
    nctId: 'NCT05000004',
    title: 'Spina Bifida Autonomic Dysreflexia Early-Detection Wearable Study',
    condition: 'Spina Bifida',
    phase: 'PHASE1',
    status: 'RECRUITING',
    summary:
      'Pilot study of a wearable blood-pressure monitor worn at the level of the injury to detect autonomic dysreflexia events earlier than symptom-based recognition.',
    eligibility:
      'Adolescents and adults 14+ with Spina Bifida at T6 or above and prior autonomic dysreflexia episodes.',
    outcomes: [
      { title: 'Time-to-detection vs. symptom onset' },
    ],
    locations: ['Children\u2019s Hospital of Pittsburgh', 'UCLA'],
  },
];

function fixtureSearch(params: ClinicalTrialSearchParams): ClinicalTrialRecord[] {
  const lower = params.condition.toLowerCase();
  const matches = FIXTURES.filter((t) => t.condition.toLowerCase().includes(lower) || lower.includes(t.condition.toLowerCase()));
  return matches;
}

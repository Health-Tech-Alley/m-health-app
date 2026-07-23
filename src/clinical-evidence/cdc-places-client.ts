/**
 * CDC PLACES / BRFSS client.
 *
 * Population-level health indicators by geography (census tract / county /
 * state) used to add SDOH context to the care plan. Per planning/26, this
 * lets the app adjust care-plan recommendations based on whether the
 * caregiver lives in a rural vs. urban area (RMPIF priority).
 *
 * Track A: ships with realistic fixtures for three representative
 * geographies. Live data lives on chronicdata.cdc.gov (Socrata SODA API);
 * no API key required.
 *
 * See planning/26_clinical-data-sources-research.md §5.
 */

import type { KnowledgeChunk } from '@/data/types';
import { withRetry } from './rate-limiter';
import { isFixtureMode } from './fixture-mode';

const CDC_BASE = 'https://data.cdc.gov/resource';
const TIMEOUT_MS = 15_000;

export interface CdcPlacesRecord {
  /** Display name of the geography. */
  locationName: string;
  /** Geography level. */
  level: 'state' | 'county' | 'tract';
  /** Crude prevalence of the named condition (percentage). */
  prevalencePercent: number;
  /** Total population in the geography. */
  population: number;
  /** Health-care-access indicator (percentage uninsured). */
  uninsuredPercent: number;
  /** Free-text summary of the SDOH context. */
  context: string;
}

export interface CdcPlacesParams {
  /** State / county / census-tract name. */
  location: string;
  /** Optional condition filter (e.g. "COPD", "Cerebral Palsy"). */
  condition?: string;
}

export async function fetchCdcPlaces(params: CdcPlacesParams): Promise<CdcPlacesRecord | null> {
  if (isFixtureMode()) {
    return fixtureFetch(params);
  }
  const { location, condition } = params;
  const url = new URL(`${CDC_BASE}/cwsq-ngmh.json`);
  url.searchParams.set('$where', `locationname like '%25${encodeURIComponent(location)}%25'`);
  if (condition) {
    url.searchParams.set('measure', condition);
  }
  url.searchParams.set('$limit', '10');
  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) {
    throw new Error(`CDC PLACES request failed: ${response.status}`);
  }
  const rows: any[] = await response.json();
  if (rows.length === 0) return null;
  const first = rows[0];
  return {
    locationName: first.locationname ?? location,
    level: (first.measureid?.startsWith('TRACT') ? 'tract' : first.measureid?.startsWith('COUNTY') ? 'county' : 'state'),
    prevalencePercent: Number(first.data_value ?? 0),
    population: Number(first.totalpopulation ?? 0),
    uninsuredPercent: Number(first.uninsured ?? 0),
    context: `${first.locationname ?? location} (${first.measure ?? condition ?? 'general'})`,
  };
}

export function cdcToChunks(record: CdcPlacesRecord | null): KnowledgeChunk[] {
  if (!record) return [];
  const now = new Date().toISOString();
  return [
    {
      chunkId: `CDCPLACES-${record.locationName.replace(/\s+/g, '-')}`,
      source: 'cdc-places',
      text: `Community health context for ${record.locationName} (${record.level}): population ~${record.population.toLocaleString()}; condition prevalence ${record.prevalencePercent.toFixed(1)}%; uninsured ${record.uninsuredPercent.toFixed(1)}%. ${record.context}`,
      retrievedAt: now,
      useCount: 0,
      metadataJson: JSON.stringify({ location: record.locationName, level: record.level }),
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
        throw new Error(`CDC PLACES request failed: ${response.status}`);
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }, { maxRetries: 2, baseDelayMs: 1500, maxDelayMs: 8000 });
}

// ---------- Fixtures (Track A) ----------

const FIXTURES: CdcPlacesRecord[] = [
  {
    locationName: 'Garrett County, Maryland',
    level: 'county',
    prevalencePercent: 8.4,
    population: 28806,
    uninsuredPercent: 9.1,
    context: 'Rural Appalachian county with limited specialist access. Telemedicine coordination is often the primary care path for complex conditions.',
  },
  {
    locationName: 'Baltimore City, Maryland',
    level: 'county',
    prevalencePercent: 7.1,
    population: 569931,
    uninsuredPercent: 11.2,
    context: 'Urban center with multiple academic medical centers and Medicaid-supported caregiver programs. Walk-in urgent care widely available.',
  },
  {
    locationName: 'Massachusetts (state)',
    level: 'state',
    prevalencePercent: 5.8,
    population: 7029917,
    uninsuredPercent: 3.5,
    context: 'Low uninsured rate, broad insurance coverage, and dense pediatric specialty care. Caregiver respite programs are well-funded.',
  },
];

function fixtureFetch(params: CdcPlacesParams): CdcPlacesRecord | null {
  const lc = params.location.toLowerCase();
  return (
    FIXTURES.find((f) => f.locationName.toLowerCase().includes(lc) || lc.includes(f.locationName.toLowerCase())) ??
    null
  );
}

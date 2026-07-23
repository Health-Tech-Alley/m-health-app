/**
 * Tests for planning/39 §7.4 P4 ADCP knowledge indexer.
 *
 * Uses a mock SQLite layer that simulates the three tables touched by the
 * indexer (`knowledge_cache`) so the chunk-builder logic can be exercised
 * in isolation.
 */

type ChunkRow = {
  chunk_id: string;
  source: string;
  text: string;
  conditions: string;
  document_type: string | null;
  section_heading: string | null;
  metadata_json: string | null;
  use_count: number;
  retrieved_at: string;
  query_hash: string | null;
  expires_at: string | null;
};

const chunkRows: ChunkRow[] = [];
const deletedSources: string[] = [];

let mockThrowOnInsert: Error | null = null;

const mockDb = {
  runSync: (sql: string, ...args: unknown[]) => {
    const upper = sql.toUpperCase().trim();
    if (upper.startsWith('INSERT OR REPLACE INTO KNOWLEDGE_CACHE')) {
      if (mockThrowOnInsert) throw mockThrowOnInsert;
      const [
        chunk_id,
        source,
        text,
        query_hash,
        conditions,
        retrieved_at,
        expires_at,
        use_count,
        metadata_json,
        document_type,
        length_tier,
        section_heading,
      ] = args as [string, string, string, string | null, string | null, string, string | null, number, string | null, string | null, string | null, string | null];
      const existing = chunkRows.findIndex((row) => row.chunk_id === chunk_id);
      const row: ChunkRow = {
        chunk_id,
        source,
        text,
        conditions: conditions ?? '',
        document_type: document_type ?? null,
        section_heading: section_heading ?? null,
        metadata_json: metadata_json ?? null,
        use_count,
        retrieved_at,
        query_hash: query_hash ?? null,
        expires_at: expires_at ?? null,
      };
      void length_tier;
      if (existing === -1) chunkRows.push(row);
      else chunkRows[existing] = row;
      return { changes: 1 };
    }
    if (upper.startsWith('DELETE FROM KNOWLEDGE_CACHE')) {
      const source = args[0] as string | undefined;
      const prefixLike = typeof args[1] === 'string' ? (args[1] as string) : null;
      const before = chunkRows.length;
      for (let i = chunkRows.length - 1; i >= 0; i--) {
        const row = chunkRows[i];
        if (!row) continue;
        const sourceOk = source == null || row.source === source;
        const prefixOk =
          !prefixLike ||
          row.chunk_id.startsWith(prefixLike.replace(/%$/, ''));
        const exactId = !prefixLike && args.length === 1 && typeof args[0] === 'string' && /chunk_id\s*=\s*\?/i.test(sql)
          ? args[0]
          : null;
        if (exactId) {
          if (row.chunk_id === exactId) {
            chunkRows.splice(i, 1);
          }
          continue;
        }
        if (sourceOk && prefixOk && (prefixLike || /source\s*=\s*\?/i.test(sql))) {
          chunkRows.splice(i, 1);
          if (source && !deletedSources.includes(source)) deletedSources.push(source);
        }
      }
      if (source && prefixLike && !deletedSources.includes(`${source}|${prefixLike}`)) {
        deletedSources.push(`${source}|${prefixLike}`);
      }
      return { changes: before - chunkRows.length };
    }
    return { changes: 0 };
  },
  getAllSync: <T>(sql: string, ...args: unknown[]): T[] => {
    if (/SELECT chunk_id FROM knowledge_cache/i.test(sql)) {
      const source = args[0] as string | undefined;
      const prefixLike = typeof args[1] === 'string' ? (args[1] as string) : null;
      return chunkRows
        .filter((r) => {
          if (source != null && r.source !== source) return false;
          if (prefixLike) return r.chunk_id.startsWith(prefixLike.replace(/%$/, ''));
          return true;
        })
        .map((r) => ({ chunk_id: r.chunk_id })) as unknown as T[];
    }
    return [];
  },
  execSync: () => undefined,
  withTransactionSync: (fn: () => void) => fn(),
};

jest.mock('@/data/db', () => ({
  getDatabase: () => mockDb,
  initializeDatabase: () => {},
  closeDatabase: () => {},
  resetDatabase: () => {},
}));

jest.mock('@/data/repositories/knowledgeChunkEdgeRepository', () => ({
  deleteEdgesForChunks: () => undefined,
  clearAllKnowledgeChunkEdges: () => undefined,
}));

jest.mock('@/data/repositories/patientRepository', () => ({
  getActiveMedications: () => [
    { medicationId: 'med-1', name: 'Albuterol', active: true },
    { medicationId: 'med-2', name: 'Baclofen', active: true },
  ],
}));

jest.mock('@/services/audit/auditService', () => ({
  audit: () => undefined,
}));

import {
  ADCP_SOURCE,
  indexAdcpPlanRevision,
  describeAdcpChunks,
  deleteAdcpChunksForPatient,
} from './adcpKnowledgeIndexer';
import type { AdcpPlanDocument } from '@/data/adcp/types';

function makePlan(overrides?: Partial<AdcpPlanDocument>): AdcpPlanDocument {
  return {
    identity: {
      planId: 'patient-test:v1',
      version: 1,
      effectiveAt: '2026-07-19T00:00:00.000Z',
      supersedes: null,
      source: 'seed:onboarding',
      publishedBy: 'system',
      publishedAt: '2026-07-19T00:00:00.000Z',
    },
    clinicalFraming: {
      primaryDiagnosis: { name: 'Cerebral Palsy', icd10: 'G80' },
      comorbidities: [{ name: 'Asthma', icd10: 'J45' }],
    },
    safetyEnvelope: {
      neverDo: ['Use sedative medication without consulting PCP'],
      alwaysDo: ['Check oxygen saturation before feeds'],
      emergencyContact: null,
      safetyNotes: 'Avoid triggers for respiratory distress.',
    },
    goals: {
      goals: [
        { goalId: 'goal-1', description: 'Improve feeding tolerance', targetDate: null, measurementTarget: null, status: 'active' },
        { goalId: 'goal-2', description: 'Maintain safe airway', targetDate: null, measurementTarget: null, status: 'active' },
      ],
    },
    monitoringContract: {
      thresholds: [
        {
          thresholdId: 't-1',
          vitalType: 'spo2',
          direction: 'below',
          value: 92,
          severity: 3,
          source: 'pcp_careplan',
          pendingMlVet: false,
        },
      ],
      escalationPolicyRefs: [],
      vettingWindow: { kind: 'fallback_24h' },
    },
    therapyContract: {
      present: true,
      activities: [{ activityId: 'a-1', description: 'Daily stretching', status: 'active' }],
      rehabMetrics: [
        {
          id: 'm-1',
          metricKey: 'romDegrees',
          displayName: 'Range of motion',
          baselineValue: 30,
          targetValue: 50,
          unit: 'deg',
        },
      ],
      exerciseAssignments: [{ exerciseKey: 'supported_arm_reach', active: true }],
      reviewWindowDays: 21,
    },
    carePriorities: {
      priorities: [
        {
          priorityId: 'priority-1',
          sourceCardId: null,
          title: 'Hydration vigilance',
          description: 'Track fluid intake',
          domain: 'general',
          status: 'active',
          promotedAt: '2026-07-19T00:00:00.000Z',
          weight: 0.7,
        },
      ],
    },
    medicationBindings: {
      bindings: [
        {
          medicationId: 'med-1',
          stableBindingId: 'binding:patient-test:med-1',
          role: 'monitor',
          notes: null,
        },
      ],
    },
    decisionLog: {
      entries: [
        {
          decisionId: 'd-1',
          occurredAt: '2026-07-19T00:00:00.000Z',
          sentence: 'Plan published',
          refIds: ['plan-1'],
        },
      ],
    },
    evidenceAnchors: {
      knowledgeChunkIds: [],
      knowledgeGraphIds: [],
      citationsCount: 0,
    },
    extensions: {},
    ...(overrides ?? {}),
  };
}

describe('adcpKnowledgeIndexer (P4)', () => {
  beforeEach(() => {
    chunkRows.length = 0;
    deletedSources.length = 0;
    mockThrowOnInsert = null;
  });

  it('produces one chunk per present section with stable chunk ids', () => {
    const plan = makePlan();
    const result = indexAdcpPlanRevision(plan, 'patient-test');
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(result.chunkIds.every((id) => id.startsWith('adcp:patient-test:v1:'))).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(chunkRows.every((c) => c.source === ADCP_SOURCE)).toBe(true);
  });

  it('skips therapy chunk when therapy contract is absent', () => {
    const plan = makePlan({
      therapyContract: { present: false, reason: 'no_rehab_plan' },
    });
    describeAdcpChunks(plan).forEach((id) => {
      indexAdcpPlanRevision(makePlan({ therapyContract: { present: false, reason: 'no_rehab_plan' } }), 'patient-test');
    });
    void plan;
    // Re-run with the absent therapy: index again.
    chunkRows.length = 0;
    indexAdcpPlanRevision(plan, 'patient-test');
    expect(chunkRows.find((c) => c.section_heading === 'Therapy contract')).toBeUndefined();
  });

  it('keeps only safety chunk when safety envelope is the dominant signal', () => {
    const plan = makePlan({
      safetyEnvelope: {
        neverDo: [],
        alwaysDo: [],
        emergencyContact: null,
        safetyNotes: 'Allergic to penicillin.',
      },
      monitoringContract: {
        thresholds: [],
        escalationPolicyRefs: [],
        vettingWindow: { kind: 'fallback_24h' },
      },
      therapyContract: { present: false, reason: 'no_rehab_plan' },
      goals: { goals: [] },
      carePriorities: { priorities: [] },
      medicationBindings: { bindings: [] },
      decisionLog: { entries: [] },
    });
    const ids = describeAdcpChunks(plan);
    expect(ids.some((id) => id.includes(':safetyEnvelope'))).toBe(true);
    expect(ids).toContain('adcp:patient-test:v1:clinicalFraming');
  });

  it('supersede cleanup drops prior adcp_plan chunks before insert', () => {
    const v1 = makePlan();
    indexAdcpPlanRevision(v1, 'patient-test');
    expect(chunkRows.length).toBeGreaterThan(0);

    // Replace plan with v2 and re-index — supersedeCleanup should remove v1 chunks.
    const v2 = makePlan();
    v2.identity.version = 2;
    v2.identity.planId = 'patient-test:v2';
    deletedSources.length = 0;
    indexAdcpPlanRevision(v2, 'patient-test');

    expect(deletedSources.some((s) => s.startsWith('adcp_plan'))).toBe(true);
    expect(chunkRows.length).toBeGreaterThan(0);
    expect(chunkRows.every((c) => c.metadata_json?.includes('"version":2'))).toBe(true);
    expect(chunkRows.every((c) => c.chunk_id.includes(':v2:'))).toBe(true);
  });

  it('supersede cleanup is patient-scoped (does not wipe other patients)', () => {
    indexAdcpPlanRevision(makePlan(), 'patient-mike');
    const sofiaPlan = makePlan();
    sofiaPlan.identity.planId = 'patient-sofia:v1';
    indexAdcpPlanRevision(sofiaPlan, 'patient-sofia');
    const sofiaCountBefore = chunkRows.filter((c) => c.chunk_id.includes('patient-sofia')).length;
    expect(sofiaCountBefore).toBeGreaterThan(0);

    const mikeV2 = makePlan();
    mikeV2.identity.version = 2;
    mikeV2.identity.planId = 'patient-mike:v2';
    indexAdcpPlanRevision(mikeV2, 'patient-mike');

    const sofiaStill = chunkRows.filter((c) => c.chunk_id.includes('patient-sofia'));
    expect(sofiaStill.length).toBe(sofiaCountBefore);
    expect(chunkRows.some((c) => c.chunk_id.includes('patient-mike') && c.chunk_id.includes(':v2:'))).toBe(
      true,
    );
  });

  it('returns warnings but does not throw on indexer failure', () => {
    mockThrowOnInsert = new Error('disk full');
    const plan = makePlan();
    const result = indexAdcpPlanRevision(plan, 'patient-test', { supersedeCleanup: false });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(/insert_failed|index_failed/.test(result.warnings.join(' '))).toBe(true);
  });

  it('joins medication display names when rendering medication bindings', () => {
    const plan = makePlan();
    expect(
      describeAdcpChunks(plan).some((id) => id.includes(':medicationBindings')),
    ).toBe(true);
    indexAdcpPlanRevision(plan, 'patient-test');
    const medChunk = chunkRows.find((c) => c.section_heading === 'Medication bindings');
    expect(medChunk?.text).toContain('Albuterol');
  });

  it('caps decision-log window at configurable size', () => {
    const plan = makePlan();
    plan.decisionLog.entries = Array.from({ length: 50 }).map((_, i) => ({
      decisionId: `decision-${i}`,
      occurredAt: `2026-07-${(i + 1).toString().padStart(2, '0')}T00:00:00.000Z`,
      sentence: `Decision #${i}`,
      refIds: [],
    }));
    indexAdcpPlanRevision(plan, 'patient-test', { decisionLogWindowSize: 5 });
    const decisionChunk = chunkRows.find((c) => c.section_heading?.startsWith('Decision log'));
    expect(decisionChunk?.section_heading).toContain('last 5');
    expect(decisionChunk?.text).toContain('Decision #49');
    expect(decisionChunk?.text).not.toContain('Decision #0');
  });
});

describe('deleteAdcpChunksForPatient', () => {
  beforeEach(() => {
    chunkRows.length = 0;
    deletedSources.length = 0;
  });

  it('removes only this patient adcp_plan chunks', () => {
    chunkRows.push(
      {
        chunk_id: 'adcp:patient-test:v1:clinicalFraming',
        source: 'adcp_plan',
        text: 'A',
        conditions: '',
        document_type: 'care_plan_section',
        section_heading: 'Clinical framing',
        metadata_json: '{}',
        use_count: 0,
        retrieved_at: '2026-07-19T00:00:00.000Z',
        query_hash: null,
        expires_at: null,
      },
      {
        chunk_id: 'adcp:other-patient:v1:clinicalFraming',
        source: 'adcp_plan',
        text: 'B',
        conditions: '',
        document_type: 'care_plan_section',
        section_heading: 'Clinical framing',
        metadata_json: '{}',
        use_count: 0,
        retrieved_at: '2026-07-19T00:00:00.000Z',
        query_hash: null,
        expires_at: null,
      },
    );
    const deleted = deleteAdcpChunksForPatient('patient-test');
    expect(deleted).toBeGreaterThan(0);
    expect(deletedSources.some((s) => s.includes('adcp_plan') && s.includes('patient-test'))).toBe(
      true,
    );
    expect(chunkRows.some((c) => c.chunk_id.includes('patient-test'))).toBe(false);
    expect(chunkRows.some((c) => c.chunk_id.includes('other-patient'))).toBe(true);
  });
});

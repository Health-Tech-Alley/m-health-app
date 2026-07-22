/**
 * Per-patient knowledge isolation tests (in-memory fake DB).
 */

const mockKnowledgeRows: Record<string, unknown>[] = [];
const mockFeedbackRows: Record<string, unknown>[] = [];

jest.mock('../db', () => ({
  getDatabase: () => {
    const mapChunk = (r: Record<string, unknown>) => ({
      chunkId: r.chunk_id,
      source: r.source,
      text: r.text,
      queryHash: r.query_hash,
      conditions: r.conditions,
      retrievedAt: r.retrieved_at,
      expiresAt: r.expires_at,
      useCount: r.use_count,
      metadataJson: r.metadata_json,
      documentType: r.document_type,
      lengthTier: r.length_tier,
      sectionHeading: r.section_heading,
      patientId: r.patient_id,
      externalId: r.external_id,
      feedbackScore: r.feedback_score ?? 0,
    });
    return {
    runSync(sql: string, ...params: unknown[]) {
      if (sql.startsWith('INSERT OR REPLACE INTO knowledge_cache')) {
        const row = {
          chunk_id: params[0],
          source: params[1],
          text: params[2],
          query_hash: params[3],
          conditions: params[4],
          retrieved_at: params[5],
          expires_at: params[6],
          use_count: params[7],
          metadata_json: params[8],
          document_type: params[9],
          length_tier: params[10],
          section_heading: params[11],
          patient_id: params[12],
          external_id: params[13],
          feedback_score: params[14] ?? 0,
        };
        const idx = mockKnowledgeRows.findIndex((r) => r.chunk_id === row.chunk_id);
        if (idx >= 0) mockKnowledgeRows.splice(idx, 1);
        mockKnowledgeRows.push(row);
        return { changes: 1 };
      }
      if (sql.includes('DELETE FROM knowledge_cache') && sql.includes('source NOT IN')) {
        const before = mockKnowledgeRows.length;
        for (let i = mockKnowledgeRows.length - 1; i >= 0; i -= 1) {
          const r = mockKnowledgeRows[i];
          if (
            r.patient_id === params[0] &&
            r.source !== 'adcp_plan' &&
            r.source !== 'patient-record'
          ) {
            mockKnowledgeRows.splice(i, 1);
          }
        }
        return { changes: before - mockKnowledgeRows.length };
      }
      if (
        sql.includes('DELETE FROM knowledge_cache') &&
        sql.includes('patient_id = ?') &&
        !sql.includes('source')
      ) {
        const before = mockKnowledgeRows.length;
        for (let i = mockKnowledgeRows.length - 1; i >= 0; i -= 1) {
          if (mockKnowledgeRows[i].patient_id === params[0]) mockKnowledgeRows.splice(i, 1);
        }
        return { changes: before - mockKnowledgeRows.length };
      }
      if (sql.includes('DELETE FROM knowledge_cache')) {
        const before = mockKnowledgeRows.length;
        mockKnowledgeRows.length = 0;
        return { changes: before };
      }
      if (sql.includes('DELETE FROM knowledge_chunk_feedback')) {
        mockFeedbackRows.length = 0;
        return { changes: 0 };
      }
      if (sql.includes('UPDATE knowledge_cache') && sql.includes('feedback_score')) {
        for (const r of mockKnowledgeRows) {
          if (r.chunk_id === params[1] && r.patient_id === params[2]) {
            r.feedback_score = params[0];
          }
        }
        return { changes: 1 };
      }
      if (sql.includes('INSERT INTO knowledge_chunk_feedback')) {
        mockFeedbackRows.push({
          feedback_id: params[0],
          patient_id: params[1],
          chunk_id: params[2],
          signal: params[3],
          note: params[4],
          created_at: params[5],
        });
        return { changes: 1 };
      }
      return { changes: 0 };
    },
    getFirstSync(sql: string, ...params: unknown[]) {
      const rows = mockKnowledgeRows.filter((r) => {
        if (sql.includes('chunk_id = ?') && sql.includes('patient_id = ?')) {
          return r.chunk_id === params[0] && r.patient_id === params[1];
        }
        if (sql.includes('WHERE chunk_id = ?')) return r.chunk_id === params[0];
        return true;
      });
      return rows[0] ? mapChunk(rows[0]) : null;
    },
    getAllSync(sql: string, ...params: unknown[]) {
      if (sql.includes('chunk_id FROM knowledge_cache')) {
        return mockKnowledgeRows
          .filter((r) => {
            if (sql.includes('source NOT IN')) {
              return (
                r.patient_id === params[0] &&
                r.source !== 'adcp_plan' &&
                r.source !== 'patient-record'
              );
            }
            if (sql.includes('patient_id = ?')) return r.patient_id === params[0];
            return true;
          })
          .map((r) => ({ chunk_id: r.chunk_id }));
      }
      return mockKnowledgeRows
        .filter((r) => {
          if (sql.includes('text LIKE')) {
            const like = String(params[1] ?? '').replace(/%/g, '');
            return (
              r.patient_id === params[0] &&
              (String(r.text).includes(like) || String(r.conditions ?? '').includes(like))
            );
          }
          if (sql.includes('patient_id = ?')) return r.patient_id === params[0];
          return true;
        })
        .map((r) => mapChunk(r));
    },
    withTransactionSync(fn: () => void) {
      fn();
    },
  };
  },
}));

jest.mock('./knowledgeChunkEdgeRepository', () => ({
  deleteEdgesForChunks: jest.fn(),
  clearAllKnowledgeChunkEdges: jest.fn(),
}));

import {
  clearKnowledgeCacheForPatient,
  clearLiteratureKnowledgeCacheForPatient,
  getKnowledgeChunksForPatient,
  insertKnowledgeChunksForPatient,
  recordKnowledgeChunkFeedback,
  searchKnowledgeCache,
} from './knowledgeCacheRepository';
import { toPatientKnowledgeChunkId } from '../patientKnowledgeIds';

describe('per-patient knowledge isolation', () => {
  beforeEach(() => {
    mockKnowledgeRows.length = 0;
    mockFeedbackRows.length = 0;
  });

  it('stores separate rows for the same external document per patient', () => {
    insertKnowledgeChunksForPatient('elena', [
      {
        chunkId: 'PMID-111',
        source: 'pubmed',
        text: 'COPD abstract for Elena',
        retrievedAt: '2026-01-01T00:00:00.000Z',
        useCount: 0,
      },
    ]);
    insertKnowledgeChunksForPatient('james', [
      {
        chunkId: 'PMID-111',
        source: 'pubmed',
        text: 'COPD abstract for James',
        retrievedAt: '2026-01-01T00:00:00.000Z',
        useCount: 0,
      },
    ]);

    const elena = getKnowledgeChunksForPatient('elena');
    const james = getKnowledgeChunksForPatient('james');
    expect(elena).toHaveLength(1);
    expect(james).toHaveLength(1);
    expect(elena[0].chunkId).toBe(toPatientKnowledgeChunkId('elena', 'pubmed', 'PMID-111'));
    expect(james[0].chunkId).toBe(toPatientKnowledgeChunkId('james', 'pubmed', 'PMID-111'));
    expect(elena[0].text).toContain('Elena');
    expect(james[0].text).toContain('James');
  });

  it('searchKnowledgeCache never returns another patients chunks', () => {
    insertKnowledgeChunksForPatient('elena', [
      {
        chunkId: 'PMID-1',
        source: 'pubmed',
        text: 'albuterol inhaler COPD',
        conditions: 'COPD',
        retrievedAt: '2026-01-01T00:00:00.000Z',
        useCount: 0,
      },
    ]);
    insertKnowledgeChunksForPatient('mike', [
      {
        chunkId: 'PMID-2',
        source: 'pubmed',
        text: 'baclofen spasticity cerebral palsy',
        conditions: 'CP',
        retrievedAt: '2026-01-01T00:00:00.000Z',
        useCount: 0,
      },
    ]);

    expect(searchKnowledgeCache('baclofen', 10, 'mike')).toHaveLength(1);
    expect(searchKnowledgeCache('baclofen', 10, 'elena')).toHaveLength(0);
    expect(searchKnowledgeCache('baclofen', 10)).toHaveLength(0);
  });

  it('clearing one patient leaves the other intact', () => {
    insertKnowledgeChunksForPatient('sofia', [
      {
        chunkId: 'PMID-s',
        source: 'pubmed',
        text: 'spina bifida',
        retrievedAt: '2026-01-01T00:00:00.000Z',
        useCount: 0,
      },
    ]);
    insertKnowledgeChunksForPatient('mike', [
      {
        chunkId: 'PMID-m',
        source: 'pubmed',
        text: 'cerebral palsy',
        retrievedAt: '2026-01-01T00:00:00.000Z',
        useCount: 0,
      },
      {
        chunkId: 'adcp:mike:v1:goals',
        source: 'adcp_plan',
        text: 'plan goals',
        retrievedAt: '2026-01-01T00:00:00.000Z',
        useCount: 0,
      },
    ]);

    clearLiteratureKnowledgeCacheForPatient('mike');
    const mikeAfter = getKnowledgeChunksForPatient('mike');
    expect(mikeAfter.every((c) => c.source === 'adcp_plan')).toBe(true);
    expect(mikeAfter.some((c) => c.source === 'pubmed')).toBe(false);
    expect(getKnowledgeChunksForPatient('sofia')).toHaveLength(1);

    clearKnowledgeCacheForPatient('sofia');
    expect(getKnowledgeChunksForPatient('sofia')).toHaveLength(0);
    expect(getKnowledgeChunksForPatient('mike').length).toBeGreaterThan(0);
  });

  it('records per-patient feedback on the owning chunk only', () => {
    insertKnowledgeChunksForPatient('james', [
      {
        chunkId: 'PMID-j',
        source: 'pubmed',
        text: 'stroke rehab',
        retrievedAt: '2026-01-01T00:00:00.000Z',
        useCount: 0,
      },
    ]);
    const chunkId = toPatientKnowledgeChunkId('james', 'pubmed', 'PMID-j');
    recordKnowledgeChunkFeedback({
      patientId: 'james',
      chunkId,
      signal: 'useful',
    });
    const row = mockKnowledgeRows.find((r) => r.chunk_id === chunkId);
    expect(row?.feedback_score).toBe(1);
    expect(getKnowledgeChunksForPatient('james')[0].feedbackScore).toBe(1);
  });
});

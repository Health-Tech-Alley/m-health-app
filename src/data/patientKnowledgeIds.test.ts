import {
  externalIdFromKnowledgeChunkId,
  patientIdFromKnowledgeChunkId,
  toPatientKnowledgeChunkId,
} from './patientKnowledgeIds';

describe('patientKnowledgeIds', () => {
  it('builds stable patient-scoped ids', () => {
    expect(toPatientKnowledgeChunkId('68250', 'pubmed', 'PMID-123')).toBe(
      'kc:68250:pubmed:PMID-123',
    );
  });

  it('does not double-prefix adcp ids', () => {
    expect(toPatientKnowledgeChunkId('mike', 'adcp_plan', 'adcp:mike:v1:goals')).toBe(
      'adcp:mike:v1:goals',
    );
  });

  it('parses patient id from prefixes', () => {
    expect(patientIdFromKnowledgeChunkId('kc:elena:dailymed:set-1')).toBe('elena');
    expect(patientIdFromKnowledgeChunkId('adcp:james:v1:goals')).toBe('james');
    expect(patientIdFromKnowledgeChunkId('PMID-raw')).toBeNull();
  });

  it('recovers external id', () => {
    expect(externalIdFromKnowledgeChunkId('kc:mike:pubmed:PMID-9')).toBe('PMID-9');
  });
});

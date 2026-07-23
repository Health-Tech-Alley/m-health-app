import { narrativeToBullets } from './considerationBullets';
import type { PatientNluContext } from '@/nlu/types';

const mikeCtx: PatientNluContext = {
  patientId: 'mike',
  patientName: 'Mike',
  conditions: ['cerebral palsy', 'epilepsy'],
  comorbidities: ['scoliosis', 'dysphagia'],
  medications: ['baclofen'],
  symptoms: ['seizure', 'coughing'],
  knowledgeKeywords: ['breathing', 'swallowing', 'positioning', 'skin'],
  vitalTypes: ['SpO2', 'heart rate'],
};

describe('narrativeToBullets', () => {
  it('splits Mike main-concern prose into short watch bullets', () => {
    const text =
      'I want to make sure Mike stays comfortable and that I notice changes early, especially with his breathing, swallowing, seizures, positioning, or recovery after procedures.';
    const bullets = narrativeToBullets(text, mikeCtx);
    expect(bullets.length).toBeGreaterThanOrEqual(3);
    expect(bullets.some((b) => /breathing/i.test(b))).toBe(true);
    expect(bullets.some((b) => /swallow/i.test(b))).toBe(true);
    expect(bullets.join(' ')).not.toMatch(/I want to make sure/i);
    for (const b of bullets) {
      expect(b.length).toBeLessThanOrEqual(90);
    }
  });

  it('handles support-needs narrative without dumping full paragraph as one line', () => {
    const text =
      "I want help keeping information organized, recognizing meaningful changes, and knowing when something should be discussed with Mike's care team.";
    const bullets = narrativeToBullets(text, mikeCtx);
    expect(bullets.length).toBeGreaterThanOrEqual(2);
    expect(bullets[0]).not.toEqual(text);
  });

  it('returns empty for blank input', () => {
    expect(narrativeToBullets('   ')).toEqual([]);
  });
});

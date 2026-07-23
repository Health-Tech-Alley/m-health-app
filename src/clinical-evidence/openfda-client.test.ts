/**
 * OpenFDA client shape tests — no network (mock fetch).
 */

jest.mock('@/services/openfda-token-store', () => ({
  getOpenFdaApiKey: jest.fn(async () => null),
}));

import { fetchAdverseEvents } from './openfda-client';

describe('fetchAdverseEvents summary shape', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns a single summary chunk per drug', async () => {
    global.fetch = jest.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              patient: {
                reaction: [
                  { reactionmeddrapt: 'Nausea' },
                  { reactionmeddrapt: 'Death' },
                ],
                drug: [{ medicinalproduct: 'BACLOFEN' }],
              },
              receivedate: '20260101',
            },
            {
              patient: {
                reaction: [{ reactionmeddrapt: 'Somnolence' }],
                drug: [{ medicinalproduct: 'BACLOFEN' }],
              },
              receivedate: '20260102',
            },
          ],
        }),
      }) as unknown as Response,
    );

    const chunks = await fetchAdverseEvents('Baclofen');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkId).toBe('OPENFDA-AE-baclofen-summary');
    expect(chunks[0].text).toMatch(/summary/i);
    expect(chunks[0].text).toMatch(/Nausea|Somnolence/);
    expect(chunks[0].text).toMatch(/Serious outcomes/);
    expect(chunks[0].conditions).toBe('Baclofen');
  });
});

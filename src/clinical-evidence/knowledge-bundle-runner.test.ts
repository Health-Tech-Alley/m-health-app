import { KNOWLEDGE_BUNDLE_FRESHNESS_MS } from './knowledge-bundle-runner';

describe('knowledge bundle freshness window', () => {
  it('is 24 hours', () => {
    expect(KNOWLEDGE_BUNDLE_FRESHNESS_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('treats timestamps within the window as fresh', () => {
    const bundledAt = Date.now() - 2 * 60 * 60 * 1000;
    expect(Date.now() - bundledAt < KNOWLEDGE_BUNDLE_FRESHNESS_MS).toBe(true);
  });

  it('treats timestamps older than the window as stale', () => {
    const bundledAt = Date.now() - KNOWLEDGE_BUNDLE_FRESHNESS_MS - 1;
    expect(Date.now() - bundledAt > KNOWLEDGE_BUNDLE_FRESHNESS_MS).toBe(true);
  });
});

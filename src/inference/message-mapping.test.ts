import type { ChatMessage } from './inference-provider';
import { getModelEntry } from './model-catalog';
import { mapMessagesForModel } from './message-mapping';

const system: ChatMessage = { role: 'system', content: 'You are the Concierge.' };
const user: ChatMessage = { role: 'user', content: 'Hello' };
const messages: ChatMessage[] = [system, user];

describe('mapMessagesForModel', () => {
  it('prefixes <|think|> for Gemma with thinking on', () => {
    const mapped = mapMessagesForModel(messages, getModelEntry('gemma-4-e2b'), true);
    expect(mapped[0].content).toBe('<|think|>\nYou are the Concierge.');
    expect(mapped[1]).toEqual(user);
  });

  it('leaves Gemma untouched with thinking off', () => {
    const mapped = mapMessagesForModel(messages, getModelEntry('gemma-4-e2b'), false);
    expect(mapped[0].content).toBe('You are the Concierge.');
  });

  it('does not prefix <|think|> for Bonsai with thinking on (template-native)', () => {
    const mapped = mapMessagesForModel(messages, getModelEntry('bonsai-8b-1bit'), true);
    expect(mapped[0].content).toBe('You are the Concierge.');
  });

  it('appends a direct-answer nudge for Bonsai with thinking off', () => {
    const mapped = mapMessagesForModel(messages, getModelEntry('bonsai-8b-1bit'), false);
    expect(mapped[0].content).toContain('Answer directly and briefly');
    expect(mapped[0].content).toContain('Do not include a thinking block');
    expect(mapped[1]).toEqual(user);
  });

  it('does not double-apply the Gemma prefix when already present', () => {
    const prefixed: ChatMessage[] = [
      { role: 'system', content: '<|think|>\nYou are the Concierge.' },
      user,
    ];
    const mapped = mapMessagesForModel(prefixed, getModelEntry('gemma-4-e2b'), true);
    expect(mapped[0].content).toBe('<|think|>\nYou are the Concierge.');
  });

  it('does not nudge repeated calls (idempotent for Bonsai)', () => {
    const first = mapMessagesForModel(messages, getModelEntry('bonsai-8b-1bit'), false);
    const second = mapMessagesForModel(first, getModelEntry('bonsai-8b-1bit'), false);
    expect(second[0].content).toBe(first[0].content);
  });

  it('does not prefix <|think|> for LFM2.5 with thinking on (template-native)', () => {
    const mapped = mapMessagesForModel(messages, getModelEntry('lfm2-5-2-6b'), true);
    expect(mapped[0].content).toBe('You are the Concierge.');
  });

  it('appends a direct-answer nudge for LFM2.5 with thinking off (bounded shallow)', () => {
    const mapped = mapMessagesForModel(messages, getModelEntry('lfm2-5-2-6b'), false);
    expect(mapped[0].content).toContain('Answer directly and briefly');
    expect(mapped[0].content).toContain('Do not include a thinking block');
    expect(mapped[1]).toEqual(user);
  });
});

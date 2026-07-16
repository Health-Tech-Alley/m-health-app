import {
  CONCIERGE_GENERATION_DEEP,
  CONCIERGE_GENERATION_FAST,
} from '@/constants/concierge';
import type { NluIntent } from '@/nlu/types';

import {
  selectChatGeneration,
  FAST_ELIGIBLE_INTENTS,
  ALWAYS_DEEP_INTENTS,
} from './reasoning-router';

function makeIntent(
  primary: string,
  confidence: number,
): NluIntent {
  return {
    primary: primary as NluIntent['primary'],
    confidence,
    alternatives: [],
  };
}

describe('selectChatGeneration', () => {
  it('returns DEEP when forceDeep is true', () => {
    const d = selectChatGeneration({ forceDeep: true });
    expect(d.profile).toBe(CONCIERGE_GENERATION_DEEP);
    expect(d.mode).toBe('auto');
    expect(d.reason).toBe('forceDeep');
  });

  it('returns DEEP when no NLU packet', () => {
    const d = selectChatGeneration({ intent: null });
    expect(d.profile).toBe(CONCIERGE_GENERATION_DEEP);
    expect(d.reason).toBe('no_nlu_packet');
  });

  it('returns DEEP on low confidence', () => {
    const d = selectChatGeneration({
      intent: makeIntent('caregiver_chat_general', 0.4),
    });
    expect(d.profile).toBe(CONCIERGE_GENERATION_DEEP);
    expect(d.reason).toContain('low_confidence');
  });

  it('returns DEEP for knowledge_qa even at high confidence', () => {
    const d = selectChatGeneration({
      intent: makeIntent('knowledge_qa', 0.99),
    });
    expect(d.profile).toBe(CONCIERGE_GENERATION_DEEP);
    expect(d.reason).toBe('always_deep_intent:knowledge_qa');
  });

  it('returns DEEP for med_check', () => {
    const d = selectChatGeneration({
      intent: makeIntent('med_check', 0.8),
    });
    expect(d.profile).toBe(CONCIERGE_GENERATION_DEEP);
    expect(d.reason).toBe('always_deep_intent:med_check');
  });

  it('returns FAST for caregiver_chat_general with high confidence', () => {
    const d = selectChatGeneration({
      intent: makeIntent('caregiver_chat_general', 0.9),
    });
    expect(d.profile).toBe(CONCIERGE_GENERATION_FAST);
    expect(d.mode).toBe('none');
    expect(d.reason).toBe('fast_intent:caregiver_chat_general');
  });

  it('returns FAST for schedule_care with high confidence', () => {
    const d = selectChatGeneration({
      intent: makeIntent('schedule_care', 0.8),
    });
    expect(d.profile).toBe(CONCIERGE_GENERATION_FAST);
    expect(d.reason).toBe('fast_intent:schedule_care');
  });

  it('returns FAST for other with high confidence', () => {
    const d = selectChatGeneration({
      intent: makeIntent('other', 0.7),
    });
    expect(d.profile).toBe(CONCIERGE_GENERATION_FAST);
    expect(d.reason).toBe('fast_intent:other');
  });

  it('overrides FAST to DEEP when 2+ clinical chunks present', () => {
    const d = selectChatGeneration({
      intent: makeIntent('caregiver_chat_general', 0.9),
      message: 'What are the symptoms of autonomic dysreflexia?',
      conditions: ['Spina bifida'],
      meds: [],
      citedChunkCount: 3,
    });
    expect(d.profile).toBe(CONCIERGE_GENERATION_DEEP);
    expect(d.reason).toBe('fast_intent_overridden_by_clinical_chunks');
  });

  it('does NOT override when chunks < 2', () => {
    const d = selectChatGeneration({
      intent: makeIntent('caregiver_chat_general', 0.9),
      message: 'What are the symptoms?',
      conditions: ['Spina bifida'],
      citedChunkCount: 1,
    });
    expect(d.profile).toBe(CONCIERGE_GENERATION_FAST);
  });

  it('all DEEP intents are in the set', () => {
    for (const label of ALWAYS_DEEP_INTENTS) {
      const d = selectChatGeneration({
        intent: makeIntent(label, 0.8),
      });
      expect(d.profile).toBe(CONCIERGE_GENERATION_DEEP);
    }
  });

  it('all FAST intents are in the set', () => {
    for (const label of FAST_ELIGIBLE_INTENTS) {
      const d = selectChatGeneration({
        intent: makeIntent(label, 0.8),
      });
      expect(d.profile).toBe(CONCIERGE_GENERATION_FAST);
    }
  });

  it('unknown future intent labels default to DEEP', () => {
    const d = selectChatGeneration({
      intent: { primary: 'unknown_future_label' as NluIntent['primary'], confidence: 0.9, alternatives: [] },
    });
    expect(d.profile).toBe(CONCIERGE_GENERATION_DEEP);
    expect(d.reason).toContain('default_deep');
  });
});

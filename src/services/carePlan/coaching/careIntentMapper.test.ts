import type { PatientNluContext } from '@/nlu/types';
import { APP_SURFACE_LABELS } from '@/nlu/app-surfaces';
import { linkEntities } from '@/nlu/entity-linker';
import { mapChatLabelToCareIntent } from './careIntentMapper';

const EMPTY_CTX: PatientNluContext = {
  patientId: '',
  patientName: '',
  conditions: [],
  comorbidities: [],
  medications: [],
  symptoms: [],
  knowledgeKeywords: [],
  vitalTypes: [],
  appSurfaces: APP_SURFACE_LABELS,
};

function map(text: string, confidence = 0.6) {
  return mapChatLabelToCareIntent({
    chatLabel: 'caregiver_chat_general',
    confidence,
    entities: linkEntities(text, EMPTY_CTX),
    snapshot: null,
    text,
  });
}

describe('mapChatLabelToCareIntent', () => {
  it('maps "add to plan" promote phrasing via chat_map', () => {
    const r = map('add this to my plan');
    expect(r?.intent).toBe('promote_uc4_to_plan_task');
    expect(r?.source).toBe('chat_map');
  });

  it('maps logging phrases via the app-surface lexicon', () => {
    const r = map('what should i log today');
    expect(r?.intent).toBe('suggest_todays_logging');
    expect(r?.source).toBe('surface');
  });

  it('maps handoff phrasing via the app-surface lexicon', () => {
    for (const text of [
      'handoff note for the next shift',
      'weekend note for the relief caregiver',
      'write a backup summary',
    ]) {
      expect(map(text)?.intent).toBe('handoff_summary');
    }
  });

  it('maps therapy-topic + progress conjunctions', () => {
    const r = map('how is therapy going');
    expect(r?.intent).toBe('explain_uc3_result');
    expect(r?.source).toBe('chat_map');
  });

  it('maps priorities explain phrasing (topic + qualifier)', () => {
    const r = map('why are these priorities');
    expect(r?.intent).toBe('explain_uc4_card');
    expect(r?.source).toBe('chat_map');
  });

  it('maps explicit surface phrases for priorities', () => {
    const r = map('explain today\'s priorities');
    expect(r?.intent).toBe('explain_uc4_card');
    expect(r?.source).toBe('surface');
  });

  it('returns null for unrelated text', () => {
    expect(map('what is for dinner')).toBeNull();
    expect(map('tell me a joke')).toBeNull();
  });

  it('does not treat a generic care-plan question as weekly review', () => {
    expect(map('How does the care plan look?')).toBeNull();
    expect(map('how is the care plan')).toBeNull();
  });
});

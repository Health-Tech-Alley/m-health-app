import {
  parseProposeCarePlanUpdate,
  stripProposeCarePlanUpdateAction,
} from './plan-tool-nlp';

describe('parseProposeCarePlanUpdate', () => {
  it('parses a valid promote call with cardId', () => {
    const call = parseProposeCarePlanUpdate(
      'I think we should watch this more closely.\n\n' +
        'ACTION: propose_care_plan_update({"intent":"promote_uc4_to_plan_task","cardId":"card-123"})',
    );
    expect(call).toEqual({
      intent: 'promote_uc4_to_plan_task',
      args: { cardId: 'card-123' },
    });
  });

  it('parses a therapy call without args', () => {
    const call = parseProposeCarePlanUpdate(
      'ACTION: propose_care_plan_update({"intent":"propose_therapy_contract_patch"})',
    );
    expect(call).toEqual({ intent: 'propose_therapy_contract_patch', args: {} });
  });

  it('rejects narrative intents (weekly review is answered inline in chat)', () => {
    expect(
      parseProposeCarePlanUpdate(
        'ACTION: propose_care_plan_update({"intent":"weekly_care_plan_review","windowDays":14})',
      ),
    ).toBeNull();
    expect(
      parseProposeCarePlanUpdate(
        'ACTION: propose_care_plan_update({"intent":"explain_uc4_card"})',
      ),
    ).toBeNull();
  });

  it('rejects malformed JSON and unknown args', () => {
    expect(
      parseProposeCarePlanUpdate(
        'ACTION: propose_care_plan_update({"intent": "promote_uc4_to_plan_task", )',
      ),
    ).toBeNull();
    const call = parseProposeCarePlanUpdate(
      'ACTION: propose_care_plan_update({"intent":"promote_uc4_to_plan_task","payload":{"x":1}})',
    );
    expect(call).toEqual({
      intent: 'promote_uc4_to_plan_task',
      args: {},
    });
  });

  it('returns null when no ACTION line present', () => {
    expect(parseProposeCarePlanUpdate('Here is a plain answer.')).toBeNull();
    expect(parseProposeCarePlanUpdate('')).toBeNull();
  });
});

describe('stripProposeCarePlanUpdateAction', () => {
  it('removes a valid ACTION line and keeps prose', () => {
    const text =
      'I can draft that.\n\n' +
      'ACTION: propose_care_plan_update({"intent":"promote_uc4_to_plan_task","cardId":"c1"})';
    expect(stripProposeCarePlanUpdateAction(text)).toBe('I can draft that.');
  });

  it('leaves text without an ACTION line untouched', () => {
    const text = 'Nothing to strip here.';
    expect(stripProposeCarePlanUpdateAction(text)).toBe(text);
  });

  it('strips an ACTION line even when the intent is not draftable', () => {
    const text =
      'Here is the walkthrough.\n\n' +
      'ACTION: propose_care_plan_update({"intent":"weekly_care_plan_review","windowDays":7})';
    expect(stripProposeCarePlanUpdateAction(text)).toBe('Here is the walkthrough.');
  });
});

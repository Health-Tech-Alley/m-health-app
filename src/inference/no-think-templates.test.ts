import {
  NO_THINK_CHATML_TEMPLATE,
  NO_THINK_TEMPLATE_FAMILIES,
  noThinkChatTemplateForFamily,
} from './no-think-templates';

describe('noThinkChatTemplateForFamily', () => {
  it('returns the ChatML no-think template for template-native families', () => {
    expect(noThinkChatTemplateForFamily('lfm2')).toBe(NO_THINK_CHATML_TEMPLATE);
    expect(noThinkChatTemplateForFamily('qwen3')).toBe(NO_THINK_CHATML_TEMPLATE);
  });

  it('returns undefined for families that honor reasoning_format', () => {
    expect(noThinkChatTemplateForFamily('gemma4')).toBeUndefined();
    expect(noThinkChatTemplateForFamily(undefined)).toBeUndefined();
  });

  it('template renders assistant turns without a think open', () => {
    expect(NO_THINK_CHATML_TEMPLATE).toContain('<|im_start|>assistant\\n');
    expect(NO_THINK_CHATML_TEMPLATE).not.toContain('<think>');
    expect(NO_THINK_CHATML_TEMPLATE).toContain('<|im_start|>');
    expect(NO_THINK_CHATML_TEMPLATE).toContain('<|im_end|>');
  });

  it('family set covers exactly lfm2 and qwen3', () => {
    expect([...NO_THINK_TEMPLATE_FAMILIES].sort()).toEqual(['lfm2', 'qwen3']);
  });
});

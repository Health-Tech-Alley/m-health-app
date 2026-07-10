import {
  countVitalsArgs,
  extractVitalsFromUserText,
  hasVitalsOrWhatIfIntent,
  normalizeVitalsArgs,
  parseEvaluateHypotheticalAction,
  resolveHypotheticalVitalsCandidate,
  stripEvaluateHypotheticalAction,
} from './vitals-tool-nlp';

describe('vitals-tool-nlp', () => {
  it('detects what-if / SpO2 intent', () => {
    expect(hasVitalsOrWhatIfIntent('What if SpO2 is 86% and heart rate is 118?')).toBe(true);
    expect(hasVitalsOrWhatIfIntent('When is the next med dose?')).toBe(false);
  });

  it('extracts SpO2 percent and HR from user text', () => {
    const args = extractVitalsFromUserText('What if SpO2 is 86% and heart rate is 118?');
    expect(args).toEqual({ blood_oxygen: 86, heart_rate: 118 });
  });

  it('normalizes fraction SpO2 to percent', () => {
    const args = extractVitalsFromUserText('what if spo2 is 0.86');
    expect(args?.blood_oxygen).toBe(86);
  });

  it('parses ACTION evaluate_hypothetical_vitals JSON', () => {
    const text =
      'I can check that.\nACTION: evaluate_hypothetical_vitals({"blood_oxygen":86,"heart_rate":110,"respiratory_rate":28})\nWaiting.';
    expect(parseEvaluateHypotheticalAction(text)).toEqual({
      blood_oxygen: 86,
      heart_rate: 110,
      respiratory_rate: 28,
    });
  });

  it('strips ACTION from visible prose', () => {
    const text = 'Checking vitals.\nACTION: evaluate_hypothetical_vitals({"blood_oxygen":86})\n';
    expect(stripEvaluateHypotheticalAction(text)).toBe('Checking vitals.');
  });

  it('prefers model ACTION over NLP when both present', () => {
    const candidate = resolveHypotheticalVitalsCandidate(
      'What if SpO2 is 90?',
      'ACTION: evaluate_hypothetical_vitals({"blood_oxygen":86,"heart_rate":118})',
    );
    expect(candidate?.blood_oxygen).toBe(86);
    expect(candidate?.heart_rate).toBe(118);
  });

  it('uses NLP when model omits ACTION but intent present', () => {
    const candidate = resolveHypotheticalVitalsCandidate(
      'What if SpO2 is 86% and HR is 118?',
      'I can look at that pattern for you.',
    );
    expect(countVitalsArgs(candidate)).toBe(2);
  });

  it('returns null for med-only questions', () => {
    expect(
      resolveHypotheticalVitalsCandidate(
        'What are the side effects of baclofen?',
        'Baclofen is a muscle relaxant.',
      ),
    ).toBeNull();
  });

  it('normalizeVitalsArgs coerces strings and spo2 fraction', () => {
    expect(
      normalizeVitalsArgs({ blood_oxygen: '0.88', heart_rate: '100' }),
    ).toEqual({ blood_oxygen: 88, heart_rate: 100 });
  });
});

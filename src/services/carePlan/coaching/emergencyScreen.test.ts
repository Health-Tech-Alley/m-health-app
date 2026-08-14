import { screenForEmergency } from './emergencyScreen';

describe('emergencyScreen', () => {
  it('hits canonical emergency phrases', () => {
    expect(screenForEmergency('he is not breathing')).toEqual({
      hit: true,
      matchedPhrase: 'not breathing',
    });
    expect(screenForEmergency('she turned blue')).toEqual({
      hit: true,
      matchedPhrase: 'turning blue',
    });
    expect(screenForEmergency('He is unresponsive!')).toEqual({
      hit: true,
      matchedPhrase: 'unresponsive',
    });
    expect(screenForEmergency('no pulse')).toEqual({
      hit: true,
      matchedPhrase: 'no pulse',
    });
    expect(screenForEmergency('having a seizure right now')).toEqual({
      hit: true,
      matchedPhrase: 'having a seizure',
    });
  });

  it('hits expanded paraphrases', () => {
    expect(screenForEmergency("she can't catch her breath")).toEqual({
      hit: true,
      matchedPhrase: 'not breathing',
    });
    expect(screenForEmergency('he is gasping for air')).toEqual({
      hit: true,
      matchedPhrase: 'not breathing',
    });
    expect(screenForEmergency("he won't wake up")).toEqual({
      hit: true,
      matchedPhrase: 'unresponsive',
    });
    expect(screenForEmergency('call 911 now')).toEqual({
      hit: true,
      matchedPhrase: 'call 911 now',
    });
    expect(screenForEmergency('get an ambulance')).toEqual({
      hit: true,
      matchedPhrase: 'call 911 now',
    });
  });

  it('does not false-positive on substrings', () => {
    expect(screenForEmergency('knot breathing under my hands')).toEqual({ hit: false });
    expect(screenForEmergency('he works on breathing exercises every day')).toEqual({
      hit: false,
    });
    expect(screenForEmergency('do we have a pulse oximeter?')).toEqual({ hit: false });
    expect(screenForEmergency('we reviewed choking hazard precautions')).toEqual({
      hit: false,
    });
    expect(screenForEmergency('he had a seizure yesterday and is fine now')).toEqual({
      hit: false,
    });
    expect(screenForEmergency('is he breathing okay?')).toEqual({ hit: false });
    expect(screenForEmergency('she says she has no chest pain')).toEqual({ hit: false });
  });

  it('still hits when negation words are absent', () => {
    expect(screenForEmergency('not responding and lips are blue')).toEqual({
      hit: true,
      matchedPhrase: 'turning blue',
    });
  });

  it('handles empty / unrelated text', () => {
    expect(screenForEmergency('')).toEqual({ hit: false });
    expect(screenForEmergency('   ')).toEqual({ hit: false });
    expect(screenForEmergency('what time is his next therapy session?')).toEqual({
      hit: false,
    });
  });
});

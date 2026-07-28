import { screenForEmergency } from '../emergencyScreen';

describe('screenForEmergency', () => {
  it('hits clear emergency phrases (S19)', () => {
    expect(screenForEmergency("he's not breathing").hit).toBe(true);
    expect(screenForEmergency('he is not breathing').hit).toBe(true);
    expect(screenForEmergency('she turned blue').hit).toBe(true);
    expect(screenForEmergency('unresponsive right now').hit).toBe(true);
    expect(screenForEmergency('I think he is having a seizure right now').hit).toBe(true);
  });

  it('respects negation guards', () => {
    expect(screenForEmergency('he is breathing fine').hit).toBe(false);
    expect(screenForEmergency('breathing exercises tonight').hit).toBe(false);
    expect(screenForEmergency('no chest pain').hit).toBe(false);
  });

  it('ignores empty and routine care text', () => {
    expect(screenForEmergency('').hit).toBe(false);
    expect(screenForEmergency('what should I log today').hit).toBe(false);
    expect(screenForEmergency('explain this priority').hit).toBe(false);
  });
});

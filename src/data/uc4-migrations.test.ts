import { MIGRATIONS } from './migrations';

describe('UC4 migrations', () => {
  it('appends UC4 storage after the approved UC3 migration 43', () => {
    const uc3Index = MIGRATIONS.findIndex((migration) =>
      migration.toString().includes('uc3_trajectory_results'),
    );
    const uc4Index = MIGRATIONS.findIndex((migration) =>
      migration.toString().includes('uc4_runs'),
    );

    expect(uc3Index).toBeGreaterThanOrEqual(0);
    expect(uc4Index).toBe(uc3Index + 1);
    expect(MIGRATIONS[uc4Index].toString()).toContain('uc4_priority_cards');
    expect(MIGRATIONS[uc4Index].toString()).toContain('uc4_caregiver_responses');
  });
});

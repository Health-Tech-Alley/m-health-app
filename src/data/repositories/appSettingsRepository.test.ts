import {
  getAppSettings,
  resetDeveloperTestFlags,
  saveAppSettings,
} from './appSettingsRepository';

const mockRows: { key: string; value_json: string }[] = [];

jest.mock('../db', () => ({
  getDatabase: () => ({
    getFirstSync: jest.fn((_sql: string, key: string) =>
      mockRows.find((r) => r.key === key) ?? null,
    ),
    runSync: jest.fn((_sql: string, key: string, valueJson: string) => {
      const idx = mockRows.findIndex((r) => r.key === key);
      if (idx >= 0) mockRows[idx] = { key, value_json: valueJson };
      else mockRows.push({ key, value_json: valueJson });
    }),
  }),
}));

function seedSettings(partial: Record<string, unknown>): void {
  mockRows.length = 0;
  const base = getAppSettings();
  saveAppSettings({ ...base, ...partial });
}

describe('resetDeveloperTestFlags', () => {
  afterEach(() => {
    mockRows.length = 0;
  });

  it('defaults simulateMissingOptionalFeatures to false on first run', () => {
    mockRows.length = 0;
    const settings = getAppSettings();
    expect(settings.simulateMissingOptionalFeatures).toBe(false);
  });

  it('forces the simulate-missing flag off when a stale value was persisted', () => {
    seedSettings({ simulateMissingOptionalFeatures: true });
    expect(getAppSettings().simulateMissingOptionalFeatures).toBe(true);

    const updated = resetDeveloperTestFlags();
    expect(updated.simulateMissingOptionalFeatures).toBe(false);
    expect(getAppSettings().simulateMissingOptionalFeatures).toBe(false);
  });

  it('leaves settings untouched when the flag is already off', () => {
    seedSettings({ simulateMissingOptionalFeatures: false, conciergeReasoning: 'off' });
    const before = getAppSettings();
    const updated = resetDeveloperTestFlags();
    expect(updated.simulateMissingOptionalFeatures).toBe(false);
    expect(updated.conciergeReasoning).toBe('off');
    expect(updated).toEqual(before);
  });
});

/**
 * Fixture-mode helper.
 *
 * Default is **live** NLM/open-data fetch (`app_settings.liveClinicalFetch`,
 * default true) so first onboarding / pack install pulls real evidence when
 * online. Fixtures are used when the setting is off, or as soft-fail fallbacks
 * inside layer fetchers if a live call fails.
 *
 * Override for a session via `setLiveClinicalFetch(true|false)`.
 */

/** null = defer to app_settings; boolean = session override */
let forceLive: boolean | null = null;

export function setLiveClinicalFetch(enabled: boolean): void {
  forceLive = enabled;
}

export function isLiveClinicalFetchEnabled(): boolean {
  if (forceLive !== null) return forceLive;
  try {
    // Lazy import avoids cycle at module init (settings → clinical-evidence).
    const { getAppSettings } = require('@/data/repositories/appSettingsRepository') as {
      getAppSettings: () => { liveClinicalFetch?: boolean };
    };
    // Default ON when key absent (first run / old settings blobs).
    return getAppSettings().liveClinicalFetch !== false;
  } catch {
    return true;
  }
}

export function isFixtureMode(): boolean {
  return !isLiveClinicalFetchEnabled();
}

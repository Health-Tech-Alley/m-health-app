/**
 * In-app banner fallback emitter.
 *
 * Used when native notifications (`expo-notifications`) are unavailable —
 * Track A / Expo Go without the module, or any environment where the bridge
 * is absent. The UI subscribes via `onInAppBanner` and renders a dismissible
 * banner (see `src/components/notifications/in-app-banner.tsx`).
 *
 * The emitter is intentionally tiny: a Map of listener callbacks and a single
 * `emitInAppBanner` function. No persistence — this is a transient UX channel;
 * the durable record lives in the `notifications` SQLite table.
 */

export interface InAppBannerPayload {
  title: string;
  body: string;
  severity?: number;
  notificationId?: string;
}

type BannerHandler = (payload: InAppBannerPayload) => void;

const listeners = new Map<symbol, BannerHandler>();

/**
 * Emit an in-app banner to all subscribed handlers.
 */
export function emitInAppBanner(payload: InAppBannerPayload): void {
  for (const handler of listeners.values()) {
    try {
      handler(payload);
    } catch (err) {
      console.warn('[notificationFallback] banner handler threw:', err);
    }
  }
}

/**
 * Subscribe to in-app banner events.
 *
 * @returns an unsubscribe function.
 */
export function onInAppBanner(handler: BannerHandler): () => void {
  const key: symbol = Symbol('in-app-banner');
  listeners.set(key, handler);
  return () => {
    listeners.delete(key);
  };
}

/**
 * Test-only: clear all listeners. Useful for jest setup/teardown.
 */
export function _clearInAppBannerListeners(): void {
  listeners.clear();
}

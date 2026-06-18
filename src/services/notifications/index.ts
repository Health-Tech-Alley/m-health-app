/**
 * Notifications & reminders service (L2 App Service).
 *
 * Public API for scheduling, dispatching, and cancelling local notifications,
 * plus the deterministic reminder engine. UI screens and the orchestrator
 * import from here — never from `expo-notifications` directly.
 */

export * from './notificationService';
export * from './notificationChannels';
export * from './notificationFallback';
export * from './reminderEngine';

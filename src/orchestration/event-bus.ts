/**
 * In-memory typed event bus for orchestration.
 *
 * Services publish events; the CEP engine and the orchestrator subscribe.
 * This is intentionally simple for v1. Future versions can swap in a persisted
 * event log without changing the public API.
 */

import type { OrchestrationEvent } from './events';

type Handler = (event: OrchestrationEvent) => void;

class EventBus {
  private handlers: Map<string, Set<Handler>> = new Map();

  subscribe(type: OrchestrationEvent['type'], handler: Handler): () => void {
    const set = this.handlers.get(type) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(type, set);
    return () => {
      set.delete(handler);
    };
  }

  publish(event: OrchestrationEvent): void {
    const set = this.handlers.get(event.type);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(event);
      } catch (err) {
        console.error('[EventBus] handler failed:', err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

let globalBus: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!globalBus) {
    globalBus = new EventBus();
  }
  return globalBus;
}

export function resetEventBus(): void {
  globalBus?.clear();
  globalBus = null;
}

export type { Handler as EventHandler };
export { EventBus };

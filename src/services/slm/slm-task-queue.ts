/**
 * SlmTaskQueue — the single owner of SLM load/unload lifecycle.
 *
 * Replaces the ad-hoc `scheduleAutoUnload` + AppState logic that was in
 * SLMContext. Multiple SLM-required tasks (explain_alert, clarifying_answer,
 * caregiver_chat, ML enrichment) acquire leases via `acquire(reason)`; the
 * model stays loaded while any lease is held. When the last lease is released
 * and policy is 'auto', a 30s auto-unload timer starts. Any new acquire()
 * cancels the timer.
 *
 * The AppState background handling lives in SLMProvider now (D1): instead of
 * a forced immediate unload, the provider debounces a 30s grace window. The
 * queue just owns refcount + timer; the provider owns the policy decision.
 *
 * The orchestrator calls `acquire('explain_alert')` before `slm.chat(...)` and
 * `lease.release()` in a finally block. This makes the SLM lifecycle the
 * queue's responsibility, not the orchestrator's or the UI's.
 */

export type SlmTaskReason =
  | 'explain_alert'
  | 'clarifying_answer'
  | 'caregiver_chat'
  | 'summarize_trends'
  | 'generate_next_steps'
  | 'enrich_summary'
  // Transient, on-demand SLM use (controlled load/unload):
  | 'safety_note_explain'
  | 'custom_med_check';

export type SlmLoadStatus = 'idle' | 'loading' | 'ready' | 'error';
export type SlmPolicy = 'manual' | 'auto';

export interface SlmTaskLease {
  readonly reason: SlmTaskReason;
  readonly acquiredAt: number;
  release: () => void;
}

export class SlmNotReadyError extends Error {
  constructor(reason: SlmTaskReason) {
    super(`SLM is not ready and policy is 'manual' — cannot acquire lease for '${reason}'`);
    this.name = 'SlmNotReadyError';
  }
}

export interface SlmTaskQueueConfig {
  getLoadStatus: () => SlmLoadStatus;
  getPolicy: () => SlmPolicy;
  getDefaultModelId: () => string;
  loadModel: (modelId: string) => Promise<void>;
  unloadModel: () => Promise<void>;
  /** Called when the queue wants to know if a load is already in progress. */
  getLoadPromise: () => Promise<void> | null;
  setLoadPromise: (promise: Promise<void> | null) => void;
  /** Idle-unload timer in ms. Default 30_000 (D1). */
  autoUnloadMs?: number;
}

export class SlmTaskQueue {
  private refcount = 0;
  private autoUnloadTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly autoUnloadMs: number;
  private config: SlmTaskQueueConfig;

  constructor(config: SlmTaskQueueConfig) {
    this.config = config;
    this.autoUnloadMs = config.autoUnloadMs ?? 30_000;
  }

  /** Update the config (called by SLMProvider when state changes). */
  updateConfig(config: SlmTaskQueueConfig): void {
    this.config = config;
  }

  /**
   * Acquire a lease for an SLM-required task.
   *
   * - If the model is 'ready', returns immediately with an incremented refcount.
   * - If 'loading', awaits the in-progress load (startup or another acquire).
   * - If 'idle'/'error' and policy is 'auto', triggers a fresh load.
   * - If policy is 'manual' and not ready, throws SlmNotReadyError.
   *
   * Cancels any pending auto-unload timer.
   *
   * Note: after awaiting a load we grant the lease directly rather than
   * re-reading getLoadStatus(). The await continuation runs as a microtask,
   * before React's scheduled render, so the status getter would still report
   * the pre-load value ('loading'/'idle') and wrongly reject the lease. A
   * resolved load promise means the model is ready.
   */
  async acquire(reason: SlmTaskReason): Promise<SlmTaskLease> {
    this.cancelAutoUnload();

    const status = this.config.getLoadStatus();
    const policy = this.config.getPolicy();

    // Already loaded — grant immediately.
    if (status === 'ready') {
      this.refcount++;
      return this.makeLease(reason);
    }

    // A load is already in progress (e.g. the startup load from
    // SLMProvider) — await it rather than starting a second.
    if (status === 'loading') {
      const existing = this.config.getLoadPromise();
      if (!existing) {
        // Inconsistent state (loading with no tracked promise) — bail safely.
        throw new SlmNotReadyError(reason);
      }
      await existing; // throws if the in-progress load fails
      this.refcount++;
      return this.makeLease(reason);
    }

    // status is 'idle' or 'error' — only auto-load on demand in auto policy.
    if (policy === 'manual') {
      throw new SlmNotReadyError(reason);
    }

    // Auto-load the default model, then grant the lease.
    const modelId = this.config.getDefaultModelId();
    const loadPromise = this.config.loadModel(modelId)
      .then(() => {
        this.config.setLoadPromise(null);
      })
      .catch((err) => {
        this.config.setLoadPromise(null);
        throw err;
      });
    this.config.setLoadPromise(loadPromise);

    await loadPromise; // throws if the load fails → propagates to the caller
    this.refcount++;
    return this.makeLease(reason);
  }

  /**
   * Release a lease. When refcount hits 0 and policy is 'auto', schedule the
   * auto-unload timer. Called automatically by the lease's `release()` method.
   */
  release(_reason: SlmTaskReason): void {
    if (this.refcount > 0) {
      this.refcount--;
    }
    if (this.refcount === 0 && this.config.getPolicy() === 'auto') {
      this.scheduleAutoUnload();
    }
  }

  /** Force-release all leases (no unload — the provider owns that decision). */
  releaseAll(): void {
    this.refcount = 0;
    this.cancelAutoUnload();
  }

  /** Current active lease count. */
  get activeLeaseCount(): number {
    return this.refcount;
  }

  /**
   * Back-compat alias for the old onAppBackground hook. SLMProvider no longer
   * calls this — it owns the debounced unload — but external callers may
   * still import it. The behavior is intentionally limited: clear the timer,
   * drop leases. Do not unload the model here.
   */
  onAppBackground(): void {
    this.releaseAll();
  }

  private scheduleAutoUnload(): void {
    this.cancelAutoUnload();
    this.autoUnloadTimer = setTimeout(() => {
      this.autoUnloadTimer = null;
      if (this.refcount === 0 && this.config.getPolicy() === 'auto') {
        void this.config.unloadModel();
      }
    }, this.autoUnloadMs);
  }

  private cancelAutoUnload(): void {
    if (this.autoUnloadTimer) {
      clearTimeout(this.autoUnloadTimer);
      this.autoUnloadTimer = null;
    }
  }

  private makeLease(reason: SlmTaskReason): SlmTaskLease {
    const queue = this;
    const acquiredAt = Date.now();
    let released = false;
    return {
      reason,
      acquiredAt,
      release() {
        if (released) return;
        released = true;
        queue.release(reason);
      },
    };
  }
}

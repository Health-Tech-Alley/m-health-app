/**
 * SlmTaskQueue — the single owner of SLM load/unload lifecycle.
 *
 * Replaces the ad-hoc `scheduleAutoUnload` + AppState logic that was in
 * SLMContext. Multiple SLM-required tasks (explain_alert, clarifying_answer,
 * caregiver_chat, ML enrichment) acquire leases via `acquire(reason)`; the
 * model stays loaded while any lease is held. When the last lease is released
 * and policy is 'auto', a configurable auto-unload timer starts (0ms for
 * dynamic mode = immediate, 30s for legacy). Any new acquire() cancels the
 * timer.
 *
 * Doc 34 additions:
 * - `preload_warm` reason for speculative warm-up (alert detail / emergency)
 * - `forceAutoLoadOnAcquire` to bypass manual policy in dynamic mode
 * - Mutable `autoUnloadMs` for hot-switching between dynamic (0) and legacy (30s)
 * - Immediate unload when autoUnloadMs <= 0 and refcount hits 0
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
  | 'custom_med_check'
  // Doc 34: speculative warm-up — no generation required
  | 'preload_warm'
  // UC3/UC4 (doc 38): SLM explain for rehab trajectory and provider summary rewrite
  | 'explain_rehab_trajectory'
  | 'uc4_provider_summary_rewrite';

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
  /** Idle-unload timer in ms. Default 30_000 (legacy). 0 = immediate (dynamic). */
  autoUnloadMs?: number;
  /**
   * When true, acquire() always auto-loads (ignores manual policy refuse).
   * Dynamic mode forces this true. Legacy keeps demo=auto / developer=manual.
   */
  forceAutoLoadOnAcquire?: boolean;
}

export class SlmTaskQueue {
  private refcount = 0;
  private autoUnloadTimer: ReturnType<typeof setTimeout> | null = null;
  private autoUnloadMs: number;
  private config: SlmTaskQueueConfig;

  constructor(config: SlmTaskQueueConfig) {
    this.config = config;
    this.autoUnloadMs = config.autoUnloadMs ?? 30_000;
  }

  /** Update the config (called by SLMProvider when state changes). */
  updateConfig(config: SlmTaskQueueConfig): void {
    this.config = config;
    if (config.autoUnloadMs !== undefined) {
      this.autoUnloadMs = config.autoUnloadMs;
    }
  }

  /**
   * Acquire a lease for an SLM-required task.
   *
   * - If the model is 'ready', returns immediately with an incremented refcount.
   * - If 'loading', awaits the in-progress load (startup or another acquire).
   * - If 'idle'/'error' and policy is 'auto' (or forceAutoLoadOnAcquire), triggers a fresh load.
   * - If policy is 'manual' and not ready, throws SlmNotReadyError.
   *
   * Cancels any pending auto-unload timer.
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

    // A load is already in progress — await it rather than starting a second.
    if (status === 'loading') {
      const existing = this.config.getLoadPromise();
      if (!existing) {
        throw new SlmNotReadyError(reason);
      }
      await existing;
      this.refcount++;
      return this.makeLease(reason);
    }

    // status is 'idle' or 'error' — check if we may auto-load.
    const mayAutoLoad =
      this.config.forceAutoLoadOnAcquire === true ||
      policy === 'auto';

    if (!mayAutoLoad) {
      throw new SlmNotReadyError(reason);
    }

    // Auto-load the default model, then grant the lease.
    const modelId = this.config.getDefaultModelId();
    const loadPromise = this.config
      .loadModel(modelId)
      .then(() => {
        this.config.setLoadPromise(null);
      })
      .catch((err) => {
        this.config.setLoadPromise(null);
        throw err;
      });
    this.config.setLoadPromise(loadPromise);

    await loadPromise;
    this.refcount++;
    return this.makeLease(reason);
  }

  /**
   * Release a lease. When refcount hits 0 and auto-unload is allowed, either
   * unload immediately (autoUnloadMs <= 0, dynamic mode) or schedule the
   * auto-unload timer (legacy 30s).
   *
   * Dynamic mode uses forceAutoLoadOnAcquire; unload must use the same signal
   * (not only policy==='auto') so we never leave the model green after the
   * last lease ends when policy is still briefly 'manual' or out of sync.
   */
  release(_reason: SlmTaskReason): void {
    if (this.refcount > 0) {
      this.refcount--;
    }
    if (this.refcount === 0 && this.mayAutoUnload()) {
      if (this.autoUnloadMs <= 0) {
        // Dynamic mode: immediate unload when last lease ends.
        void this.config.unloadModel();
      } else {
        this.scheduleAutoUnload();
      }
    }
  }

  /** Whether last-lease release should unload (dynamic force-auto or policy auto). */
  private mayAutoUnload(): boolean {
    return (
      this.config.forceAutoLoadOnAcquire === true ||
      this.config.getPolicy() === 'auto'
    );
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
      if (this.refcount === 0 && this.mayAutoUnload()) {
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

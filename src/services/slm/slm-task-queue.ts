/**
 * SlmTaskQueue — the single owner of SLM load/unload lifecycle.
 *
 * Replaces the ad-hoc `scheduleAutoUnload` + AppState logic that was in
 * SLMContext. Multiple SLM-required tasks (explain_alert, clarifying_answer,
 * caregiver_chat, ML enrichment) acquire leases via `acquire(reason)`; the
 * model stays loaded while any lease is held. When the last lease is released
 * and policy is 'auto', a 60s auto-unload timer starts. Any new acquire()
 * cancels the timer.
 *
 * AppState background force-releases all leases and unloads the model.
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
  autoUnloadMs?: number; // default 60_000
}

export class SlmTaskQueue {
  private refcount = 0;
  private autoUnloadTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly autoUnloadMs: number;
  private config: SlmTaskQueueConfig;

  constructor(config: SlmTaskQueueConfig) {
    this.config = config;
    this.autoUnloadMs = config.autoUnloadMs ?? 60_000;
  }

  /** Update the config (called by SLMProvider when state changes). */
  updateConfig(config: SlmTaskQueueConfig): void {
    this.config = config;
  }

  /**
   * Acquire a lease for an SLM-required task.
   *
   * - If the model is 'ready', returns immediately with an incremented refcount.
   * - If 'idle' and policy is 'auto', loads the default model first.
   * - If 'loading', awaits the in-progress load.
   * - If policy is 'manual' and not ready, throws SlmNotReadyError.
   *
   * Cancels any pending auto-unload timer.
   */
  async acquire(reason: SlmTaskReason): Promise<SlmTaskLease> {
    this.cancelAutoUnload();

    const status = this.config.getLoadStatus();
    const policy = this.config.getPolicy();

    if (status === 'ready') {
      this.refcount++;
      return this.makeLease(reason);
    }

    if (status === 'loading') {
      const existing = this.config.getLoadPromise();
      if (existing) {
        await existing;
        if (this.config.getLoadStatus() === 'ready') {
          this.refcount++;
          return this.makeLease(reason);
        }
      }
      // Load failed — fall through to manual check below.
    }

    if (status === 'idle' || status === 'error') {
      if (policy === 'manual') {
        throw new SlmNotReadyError(reason);
      }

      // Auto-load the default model.
      const modelId = this.config.getDefaultModelId();
      const loadPromise = this.config.loadModel(modelId).then(() => {
        this.config.setLoadPromise(null);
      }).catch((err) => {
        this.config.setLoadPromise(null);
        throw err;
      });
      this.config.setLoadPromise(loadPromise);

      await loadPromise;

      if (this.config.getLoadStatus() === 'ready') {
        this.refcount++;
        return this.makeLease(reason);
      }
    }

    // Status is 'error' after a failed load, or 'loading' but didn't become ready.
    if (policy === 'manual') {
      throw new SlmNotReadyError(reason);
    }
    // In auto mode, if the load failed, throw with the underlying error.
    throw new SlmNotReadyError(reason);
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

  /** Force-release all leases (e.g. on AppState background). */
  releaseAll(): void {
    this.refcount = 0;
    this.cancelAutoUnload();
  }

  /** Current active lease count. */
  get activeLeaseCount(): number {
    return this.refcount;
  }

  /**
   * Called on AppState 'background'. Force-releases all leases and unloads
   * the model immediately, regardless of policy.
   */
  onAppBackground(): void {
    this.releaseAll();
    const status = this.config.getLoadStatus();
    if (status === 'ready') {
      void this.config.unloadModel();
    }
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

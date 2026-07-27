/**
 * Simple rate limiter for NLM/NIH public APIs.
 *
 * Without an NCBI API key, PubMed E-utilities allow 3 req/s. MedlinePlus,
 * RxNorm, DailyMed, and OpenFDA have their own (looser) limits. This utility
 * enforces a minimum delay between sequential API calls to avoid 429s.
 *
 * Usage:
 *   const limiter = new RateLimiter(400); // 400ms between calls = 2.5 req/s
 *   await limiter.throttle();
 *   await fetch(...);
 */

export class RateLimiter {
  private minIntervalMs: number;
  private lastCallTime = 0;
  private pending: Promise<void> | null = null;

  constructor(minIntervalMs = 400) {
    this.minIntervalMs = minIntervalMs;
  }

  /**
   * Wait until enough time has elapsed since the last throttle() call.
   * Call this immediately before each API request.
   */
  async throttle(): Promise<void> {
    // Chain onto any pending throttle so concurrent callers queue up
    if (this.pending) {
      await this.pending;
    }

    this.pending = this.doThrottle();
    await this.pending;
    this.pending = null;
  }

  private async doThrottle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCallTime;
    const wait = this.minIntervalMs - elapsed;
    if (wait > 0) {
      await sleep(wait);
    }
    this.lastCallTime = Date.now();
  }
}

/**
 * Retry a function with exponential backoff on 429 / 5xx.
 *
 * Timeouts and aborts are NOT retried by default — the caller already waited
 * the full timeout budget; re-waiting multiplies hang time (DailyMed was
 * spending 45s+ on canceled fetches). Pass `retryNetwork: true` only when a
 * single quick retry is worth it.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    /** Retry generic network blips (not timeouts/aborts). Default false. */
    retryNetwork?: boolean;
  } = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 8000,
    retryNetwork = false,
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (isTimeoutOrAbortError(err)) {
        throw err;
      }
      const isRetryable =
        is429Error(err) ||
        is5xxError(err) ||
        (retryNetwork && isNetworkError(err));
      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }
      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempt),
        maxDelayMs,
      );
      await sleep(delay);
    }
  }
  throw lastError;
}

function is429Error(err: unknown): boolean {
  if (err instanceof Error) {
    return /429|too many requests|rate limit/i.test(err.message);
  }
  return false;
}

function is5xxError(err: unknown): boolean {
  if (err instanceof Error) {
    // Match "failed: 500", "HTTP 503", status property on custom errors.
    if (/5\d\d/.test(err.message) && /fail|http|status|dailymed|request/i.test(err.message)) {
      return true;
    }
    const status = (err as { status?: number }).status;
    if (typeof status === 'number' && status >= 500 && status < 600) return true;
  }
  return false;
}

function isTimeoutOrAbortError(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.name === 'AbortError') return true;
    return /timeout|aborted|abort|canceled|cancelled/i.test(err.message);
  }
  return false;
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof Error) {
    if (isTimeoutOrAbortError(err)) return false;
    return /network|fetch failed|ECONNRESET|ENOTFOUND|ETIMEDOUT/i.test(err.message);
  }
  return false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

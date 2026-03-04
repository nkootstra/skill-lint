import * as core from "@actions/core";

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 5) */
  maxRetries?: number;
  /** Initial delay in ms before first retry (default: 5000) */
  initialDelayMs?: number;
  /** Maximum delay in ms between retries (default: 60000) */
  maxDelayMs?: number;
  /** Label for log messages */
  label?: string;
}

/**
 * Returns true if the error looks like a rate-limit (HTTP 429) or transient
 * server error (5xx) that is worth retrying.
 */
function isRetryable(error: unknown): boolean {
  if (error == null) return false;

  const msg = error instanceof Error ? error.message : String(error);

  // Match "429" status codes and common rate-limit phrases
  if (/\b429\b/.test(msg)) return true;
  if (/rate.?limit/i.test(msg)) return true;
  if (/too many requests/i.test(msg)) return true;

  // Transient server errors (500, 502, 503, 529)
  if (/\b(500|502|503|529)\b/.test(msg)) return true;
  if (/overloaded/i.test(msg)) return true;

  // OpenAI SDK / HTTP status property
  const status = (error as Record<string, unknown>)?.status;
  if (typeof status === "number" && (status === 429 || status >= 500)) return true;

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps an async function with exponential-backoff retries for
 * rate-limit (429) and transient server errors.
 *
 * Non-retryable errors are thrown immediately without consuming retries.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 5,
    initialDelayMs = 5_000,
    maxDelayMs = 60_000,
    label = "request",
  } = opts;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isRetryable(error) || attempt === maxRetries) {
        throw error;
      }

      // Exponential backoff with jitter: delay * 2^attempt + random jitter
      const baseDelay = initialDelayMs * 2 ** attempt;
      const jitter = Math.random() * initialDelayMs * 0.5;
      const delay = Math.min(baseDelay + jitter, maxDelayMs);

      core.info(`  Retry ${attempt + 1}/${maxRetries} for ${label} after ${Math.round(delay)}ms (rate limited)`);
      await sleep(delay);
    }
  }

  // Unreachable in practice, but satisfies TypeScript
  throw lastError;
}

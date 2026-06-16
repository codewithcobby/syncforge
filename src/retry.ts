export interface RetryStrategy {
  getDelay(attempt: number): number
}

export const immediateRetryStrategy: RetryStrategy = {
  getDelay: () => 0,
}

const DEFAULT_BASE_DELAY_MS = 1_000
const DEFAULT_MAX_DELAY_MS = 30_000
const DEFAULT_FACTOR = 2

export interface LinearBackoffRetryStrategyOptions {
  baseDelayMs?: number
  maxDelayMs?: number
}

export interface ExponentialBackoffRetryStrategyOptions {
  baseDelayMs?: number
  maxDelayMs?: number
  factor?: number
  jitter?: boolean
}

function capDelay(delayMs: number, maxDelayMs: number): number {
  return Math.min(delayMs, maxDelayMs)
}

/**
 * Current implementation uses 50%–100% jitter. The exact jitter algorithm is not
 * part of the public API and may evolve.
 */
function applyJitter(delayMs: number): number {
  return delayMs * (0.5 + Math.random() * 0.5)
}

export function linearBackoffRetryStrategy(
  options: LinearBackoffRetryStrategyOptions = {},
): RetryStrategy {
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS

  return {
    getDelay(attempt: number): number {
      return capDelay(baseDelayMs * attempt, maxDelayMs)
    },
  }
}

export function exponentialBackoffRetryStrategy(
  options: ExponentialBackoffRetryStrategyOptions = {},
): RetryStrategy {
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const factor = options.factor ?? DEFAULT_FACTOR
  const jitter = options.jitter ?? false

  return {
    getDelay(attempt: number): number {
      const delayMs = capDelay(baseDelayMs * factor ** attempt, maxDelayMs)
      return jitter ? applyJitter(delayMs) : delayMs
    },
  }
}

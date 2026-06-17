import type { HealthSignal, HealthStatus, HealthThresholds, MetricsSnapshot, SyncOperation } from "./types.js"

export const DEFAULT_HEALTH_THRESHOLDS: Required<HealthThresholds> = {
  queueSizeDegraded: 10_000,
  queueSizeUnhealthy: 50_000,
  pendingCountDegraded: 100,
  pendingCountUnhealthy: 500,
  oldestPendingAgeMsDegraded: 60 * 60 * 1000,
  oldestPendingAgeMsUnhealthy: 24 * 60 * 60 * 1000,
  failureRateDegraded: 0.05,
  failureRateUnhealthy: 0.2,
  storageBytesDegraded: 5 * 1024 * 1024,
  storageBytesUnhealthy: 20 * 1024 * 1024,
  failureRateMinSample: 10,
}

export interface HealthSignals {
  queueSize: number
  pendingCount: number
  oldestPendingAgeMs: number
  failureRate: number
  storageBytesEstimate: number
  terminalOutcomes: number
}

export interface HealthEvaluation {
  status: HealthStatus
  breachedSignals: HealthSignal[]
}

export function mergeHealthThresholds(
  overrides?: HealthThresholds,
): Required<HealthThresholds> {
  return { ...DEFAULT_HEALTH_THRESHOLDS, ...overrides }
}

export function computeOldestPendingAgeMs(
  operations: SyncOperation[],
  now: number,
): number {
  let oldestCreatedAt: number | null = null

  for (const operation of operations) {
    if (operation.status !== "pending") {
      continue
    }

    const createdAt = operation.createdAt.getTime()
    if (oldestCreatedAt === null || createdAt < oldestCreatedAt) {
      oldestCreatedAt = createdAt
    }
  }

  return oldestCreatedAt === null ? 0 : now - oldestCreatedAt
}

export function computeStorageBytesEstimate(operations: SyncOperation[]): number {
  return new TextEncoder().encode(JSON.stringify(operations)).byteLength
}

export function computeFailureRate(metrics: MetricsSnapshot): number {
  const denominator = metrics.totalSucceeded + metrics.totalFailed
  return denominator > 0 ? metrics.totalFailed / denominator : 0
}

function breachLevel(
  value: number,
  degraded: number,
  unhealthy: number,
): "healthy" | "degraded" | "unhealthy" {
  if (value >= unhealthy) {
    return "unhealthy"
  }
  if (value >= degraded) {
    return "degraded"
  }
  return "healthy"
}

export function evaluateHealth(
  signals: HealthSignals,
  thresholds: Required<HealthThresholds>,
): HealthEvaluation {
  const breachedSignals: HealthSignal[] = []
  let status: HealthStatus = "healthy"

  const apply = (signal: HealthSignal, level: "healthy" | "degraded" | "unhealthy") => {
    if (level === "healthy") {
      return
    }
    breachedSignals.push(signal)
    if (level === "unhealthy") {
      status = "unhealthy"
      return
    }
    if (status !== "unhealthy") {
      status = "degraded"
    }
  }

  apply(
    "queueSize",
    breachLevel(signals.queueSize, thresholds.queueSizeDegraded, thresholds.queueSizeUnhealthy),
  )
  apply(
    "pendingCount",
    breachLevel(
      signals.pendingCount,
      thresholds.pendingCountDegraded,
      thresholds.pendingCountUnhealthy,
    ),
  )
  apply(
    "oldestPendingAgeMs",
    breachLevel(
      signals.oldestPendingAgeMs,
      thresholds.oldestPendingAgeMsDegraded,
      thresholds.oldestPendingAgeMsUnhealthy,
    ),
  )
  apply(
    "storageBytesEstimate",
    breachLevel(
      signals.storageBytesEstimate,
      thresholds.storageBytesDegraded,
      thresholds.storageBytesUnhealthy,
    ),
  )

  if (signals.terminalOutcomes >= thresholds.failureRateMinSample) {
    apply(
      "failureRate",
      breachLevel(
        signals.failureRate,
        thresholds.failureRateDegraded,
        thresholds.failureRateUnhealthy,
      ),
    )
  }

  return { status, breachedSignals }
}

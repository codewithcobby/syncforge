import { describe, expect, it } from "vitest"
import {
  computeOldestPendingAgeMs,
  computeStorageBytesEstimate,
  DEFAULT_HEALTH_THRESHOLDS,
  evaluateHealth,
  type HealthSignals,
} from "../src/health.js"
import { SyncOperationStatuses, type SyncOperation } from "../src/index.js"

function baseSignals(overrides: Partial<HealthSignals> = {}): HealthSignals {
  return {
    queueSize: 0,
    pendingCount: 0,
    oldestPendingAgeMs: 0,
    failureRate: 0,
    storageBytesEstimate: 0,
    terminalOutcomes: 0,
    ...overrides,
  }
}

function makePendingOp(id: string, createdAt: Date): SyncOperation {
  return {
    id,
    type: "test",
    payload: {},
    status: SyncOperationStatuses.Pending,
    retries: 0,
    createdAt,
  }
}

describe("evaluateHealth()", () => {
  it("returns healthy with empty breachedSignals when all signals are within thresholds", () => {
    const result = evaluateHealth(baseSignals(), DEFAULT_HEALTH_THRESHOLDS)
    expect(result).toEqual({ status: "healthy", breachedSignals: [] })
  })

  it("flags queueSize as degraded then unhealthy", () => {
    const degraded = evaluateHealth(
      baseSignals({ queueSize: DEFAULT_HEALTH_THRESHOLDS.queueSizeDegraded }),
      DEFAULT_HEALTH_THRESHOLDS,
    )
    expect(degraded.status).toBe("degraded")
    expect(degraded.breachedSignals).toEqual(["queueSize"])

    const unhealthy = evaluateHealth(
      baseSignals({ queueSize: DEFAULT_HEALTH_THRESHOLDS.queueSizeUnhealthy }),
      DEFAULT_HEALTH_THRESHOLDS,
    )
    expect(unhealthy.status).toBe("unhealthy")
    expect(unhealthy.breachedSignals).toEqual(["queueSize"])
  })

  it("flags pendingCount as degraded then unhealthy", () => {
    const degraded = evaluateHealth(
      baseSignals({ pendingCount: DEFAULT_HEALTH_THRESHOLDS.pendingCountDegraded }),
      DEFAULT_HEALTH_THRESHOLDS,
    )
    expect(degraded.status).toBe("degraded")
    expect(degraded.breachedSignals).toEqual(["pendingCount"])
  })

  it("flags oldestPendingAgeMs as degraded then unhealthy", () => {
    const degraded = evaluateHealth(
      baseSignals({
        oldestPendingAgeMs: DEFAULT_HEALTH_THRESHOLDS.oldestPendingAgeMsDegraded,
      }),
      DEFAULT_HEALTH_THRESHOLDS,
    )
    expect(degraded.status).toBe("degraded")
    expect(degraded.breachedSignals).toEqual(["oldestPendingAgeMs"])
  })

  it("flags storageBytesEstimate as degraded then unhealthy", () => {
    const degraded = evaluateHealth(
      baseSignals({
        storageBytesEstimate: DEFAULT_HEALTH_THRESHOLDS.storageBytesDegraded,
      }),
      DEFAULT_HEALTH_THRESHOLDS,
    )
    expect(degraded.status).toBe("degraded")
    expect(degraded.breachedSignals).toEqual(["storageBytesEstimate"])
  })

  it("uses worst-signal-wins and lists all breached signals", () => {
    const result = evaluateHealth(
      baseSignals({
        pendingCount: DEFAULT_HEALTH_THRESHOLDS.pendingCountDegraded,
        oldestPendingAgeMs: DEFAULT_HEALTH_THRESHOLDS.oldestPendingAgeMsUnhealthy,
      }),
      DEFAULT_HEALTH_THRESHOLDS,
    )
    expect(result.status).toBe("unhealthy")
    expect(result.breachedSignals).toEqual(["pendingCount", "oldestPendingAgeMs"])
  })

  it("ignores failureRate below failureRateMinSample", () => {
    const result = evaluateHealth(
      baseSignals({
        failureRate: 1,
        terminalOutcomes: DEFAULT_HEALTH_THRESHOLDS.failureRateMinSample - 1,
      }),
      DEFAULT_HEALTH_THRESHOLDS,
    )
    expect(result.status).toBe("healthy")
    expect(result.breachedSignals).toEqual([])
  })

  it("evaluates failureRate when terminalOutcomes meets min sample", () => {
    const result = evaluateHealth(
      baseSignals({
        failureRate: DEFAULT_HEALTH_THRESHOLDS.failureRateUnhealthy,
        terminalOutcomes: DEFAULT_HEALTH_THRESHOLDS.failureRateMinSample,
      }),
      DEFAULT_HEALTH_THRESHOLDS,
    )
    expect(result.status).toBe("unhealthy")
    expect(result.breachedSignals).toEqual(["failureRate"])
  })
})

describe("computeOldestPendingAgeMs()", () => {
  it("returns 0 when there are no pending operations", () => {
    const ops = [
      makePendingOp("1", new Date("2026-01-01T00:00:00.000Z")),
    ]
    ops[0]!.status = SyncOperationStatuses.Completed

    expect(computeOldestPendingAgeMs(ops, Date.parse("2026-06-01T00:00:00.000Z"))).toBe(0)
  })

  it("returns age of the oldest pending operation", () => {
    const now = Date.parse("2026-06-01T12:00:00.000Z")
    const ops = [
      makePendingOp("new", new Date("2026-06-01T11:00:00.000Z")),
      makePendingOp("old", new Date("2026-06-01T08:00:00.000Z")),
    ]

    expect(computeOldestPendingAgeMs(ops, now)).toBe(4 * 60 * 60 * 1000)
  })
})

describe("computeStorageBytesEstimate()", () => {
  it("scales with operation count", () => {
    const one = computeStorageBytesEstimate([makePendingOp("1", new Date())])
    const two = computeStorageBytesEstimate([
      makePendingOp("1", new Date()),
      makePendingOp("2", new Date()),
    ])

    expect(two).toBeGreaterThan(one)
    expect(two).toBeGreaterThan(0)
  })
})

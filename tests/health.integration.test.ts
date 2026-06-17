import { describe, expect, it, vi } from "vitest"
import {
  createMemoryStorage,
  createSyncEngine,
  DEFAULT_HEALTH_THRESHOLDS,
  SyncOperationStatuses,
  type TransportAdapter,
} from "../src/index.js"
import { computeStorageBytesEstimate as computeStorageBytesEstimateDirect } from "../src/health.js"
import { buildMixedQueue, buildOperations, seedStorage } from "./helpers/queue-scale.js"

class FailingTransport implements TransportAdapter {
  async send(): Promise<void> {
    throw new Error("network error")
  }
}

describe("getHealth()", () => {
  it("returns healthy zeros for an empty queue", async () => {
    const sync = createSyncEngine({ storage: createMemoryStorage() })
    const health = await sync.getHealth()

    expect(health).toEqual({
      queueSize: 0,
      pendingCount: 0,
      failedCount: 0,
      completedCount: 0,
      oldestPendingAgeMs: 0,
      storageBytesEstimate: 2,
      failureRate: 0,
      status: "healthy",
      breachedSignals: [],
    })
  })

  it("reports high pending count with breachedSignals", async () => {
    const storage = createMemoryStorage()
    await seedStorage(
      storage,
      buildMixedQueue({
        total: 200,
        pending: DEFAULT_HEALTH_THRESHOLDS.pendingCountDegraded,
        failed: 0,
        payloadBytes: 100,
      }),
    )

    const sync = createSyncEngine({ storage })
    const now = Date.parse("2026-01-01T00:30:00.000Z")
    const health = await sync.getHealth({ now })

    expect(health.pendingCount).toBe(DEFAULT_HEALTH_THRESHOLDS.pendingCountDegraded)
    expect(health.status).toBe("degraded")
    expect(health.breachedSignals).toContain("pendingCount")
  })

  it("computes oldestPendingAgeMs from pending createdAt", async () => {
    const storage = createMemoryStorage()
    const createdAt = new Date("2020-01-01T00:00:00.000Z")
    await seedStorage(storage, [
      {
        id: "stale",
        type: "test",
        payload: {},
        status: SyncOperationStatuses.Pending,
        retries: 0,
        createdAt,
      },
    ])

    const sync = createSyncEngine({ storage })
    const now = Date.parse("2026-06-01T00:00:00.000Z")
    const health = await sync.getHealth({ now })

    expect(health.oldestPendingAgeMs).toBe(now - createdAt.getTime())
    expect(health.breachedSignals).toContain("oldestPendingAgeMs")
    expect(health.status).toBe("unhealthy")
  })

  it("reports session failureRate after enough terminal outcomes", async () => {
    const sync = createSyncEngine({
      storage: createMemoryStorage(),
      transport: new FailingTransport(),
      maxRetries: 0,
    })

    for (let index = 0; index < DEFAULT_HEALTH_THRESHOLDS.failureRateMinSample; index += 1) {
      await sync.mutate("test.fail", { index })
      await sync.flush()
    }

    const health = await sync.getHealth()
    expect(health.failureRate).toBe(1)
    expect(health.failedCount).toBe(DEFAULT_HEALTH_THRESHOLDS.failureRateMinSample)
    expect(health.breachedSignals).toContain("failureRate")
    expect(health.status).toBe("unhealthy")
  })

  it("reports large completed backlog in queueSize and storageBytesEstimate", async () => {
    const storage = createMemoryStorage()
    const operations = buildOperations(500, SyncOperationStatuses.Completed, {
      payloadBytes: 1024,
    })
    await seedStorage(storage, operations)

    const sync = createSyncEngine({ storage })
    const health = await sync.getHealth()

    expect(health.queueSize).toBe(500)
    expect(health.completedCount).toBe(500)
    expect(health.storageBytesEstimate).toBe(computeStorageBytesEstimateDirect(operations))
    expect(health.status).toBe("healthy")
  })

  it("allows custom thresholds to relax status", async () => {
    const storage = createMemoryStorage()
    await seedStorage(
      storage,
      buildMixedQueue({
        total: 200,
        pending: DEFAULT_HEALTH_THRESHOLDS.pendingCountDegraded,
        failed: 0,
        payloadBytes: 100,
      }),
    )

    const sync = createSyncEngine({ storage })
    const now = Date.parse("2026-01-01T00:30:00.000Z")
    const defaultHealth = await sync.getHealth({ now })
    expect(defaultHealth.status).toBe("degraded")

    const relaxed = await sync.getHealth({
      now,
      thresholds: { pendingCountDegraded: DEFAULT_HEALTH_THRESHOLDS.pendingCountDegraded + 1 },
    })
    expect(relaxed.status).toBe("healthy")
    expect(relaxed.breachedSignals).toEqual([])
  })

  it("caches storageBytesEstimate across repeated getHealth calls until mutation", async () => {
    const storage = createMemoryStorage()
    await seedStorage(storage, buildOperations(10, SyncOperationStatuses.Pending, { payloadBytes: 100 }))

    const sync = createSyncEngine({ storage })
    const stringifySpy = vi.spyOn(JSON, "stringify")

    const first = await sync.getHealth({ now: Date.parse("2026-01-01T00:30:00.000Z") })
    const callsAfterFirst = stringifySpy.mock.calls.length
    const second = await sync.getHealth({ now: Date.parse("2026-01-01T00:30:00.000Z") })
    expect(first.storageBytesEstimate).toBe(second.storageBytesEstimate)
    expect(stringifySpy.mock.calls.length).toBe(callsAfterFirst)

    await sync.mutate("test.add", {})
    const third = await sync.getHealth({ now: Date.parse("2026-01-01T00:30:00.000Z") })
    expect(third.storageBytesEstimate).toBeGreaterThan(first.storageBytesEstimate)
    expect(stringifySpy.mock.calls.length).toBeGreaterThan(callsAfterFirst)

    stringifySpy.mockRestore()
  })

  it("does not emit events or persist on getHealth", async () => {
    const storage = createMemoryStorage()
    const saveSpy = vi.spyOn(storage, "saveOperations")
    const sync = createSyncEngine({ storage })
    const events: string[] = []
    sync.on("queue:changed", () => {
      events.push("queue:changed")
    })

    await sync.getHealth()
    expect(saveSpy).not.toHaveBeenCalled()
    expect(events).toEqual([])
    saveSpy.mockRestore()
  })
})

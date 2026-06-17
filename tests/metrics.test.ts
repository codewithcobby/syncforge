import { describe, expect, it } from "vitest"
import { createSyncEngine } from "../src/index.js"

describe("getMetrics()", () => {
  it("returns zero counters on a fresh engine", () => {
    const sync = createSyncEngine()
    const metrics = sync.getMetrics()

    expect(metrics).toEqual({
      totalQueued: 0,
      totalSucceeded: 0,
      totalFailed: 0,
      totalRetried: 0,
      averageRetries: 0,
      lastSuccessfulFlushAt: null,
    })
  })

  it("is synchronous and does not require hydration", async () => {
    const sync = createSyncEngine()
    await sync.mutate("create", { id: "1" })

    const metrics = sync.getMetrics()
    expect(metrics.totalQueued).toBe(1)
  })

  it("derives averageRetries as zero when totalSucceeded is zero", async () => {
    const sync = createSyncEngine({ maxRetries: 0 })
    await sync.mutate("create", { id: "1" })

    expect(sync.getMetrics().averageRetries).toBe(0)
  })
})

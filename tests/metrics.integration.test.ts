import { describe, expect, it } from "vitest"
import {
  createMemoryStorage,
  createSyncEngine,
  SyncOperationStatuses,
  type SyncOperation,
  type TransportAdapter,
} from "../src/index.js"
import { buildOperations, seedStorage } from "./helpers/queue-scale.js"

class MockTransport implements TransportAdapter {
  sent: SyncOperation[] = []

  async send(operation: SyncOperation): Promise<void> {
    this.sent.push({ ...operation })
  }
}

class FailingTransport implements TransportAdapter {
  async send(): Promise<void> {
    throw new Error("network error")
  }
}

class PerOpFlakyTransport implements TransportAdapter {
  private readonly attempts = new Map<string, number>()

  constructor(private readonly failuresBeforeSuccess: number) {}

  async send(operation: SyncOperation): Promise<void> {
    const attempt = (this.attempts.get(operation.id) ?? 0) + 1
    this.attempts.set(operation.id, attempt)
    if (attempt <= this.failuresBeforeSuccess) {
      throw new Error("network error")
    }
  }
}

class ToggleTransport implements TransportAdapter {
  shouldFail = true
  sent: SyncOperation[] = []

  async send(operation: SyncOperation): Promise<void> {
    this.sent.push({ ...operation })
    if (this.shouldFail) {
      throw new Error("network error")
    }
  }
}

describe("metrics integration", () => {
  it("does not increment totalQueued on retry(id)", async () => {
    const sync = createSyncEngine({
      transport: new FailingTransport(),
      maxRetries: 1,
    })

    await sync.mutate("create", { id: "1" })
    await sync.flush()
    await sync.retry((await sync.getFailed())[0]!.id)

    expect(sync.getMetrics().totalQueued).toBe(1)
  })

  it("retry(id) and a later flush success keep totalQueued at mutate count", async () => {
    const transport = new ToggleTransport()
    transport.shouldFail = true
    const sync = createSyncEngine({ transport, maxRetries: 1 })

    await sync.mutate("create", { id: "1" })
    await sync.flush()

    expect(sync.getMetrics().totalFailed).toBe(1)
    expect(sync.getMetrics().totalQueued).toBe(1)

    await sync.retry((await sync.getFailed())[0]!.id)
    transport.shouldFail = false
    await sync.flush()

    const metrics = sync.getMetrics()
    expect(metrics.totalQueued).toBe(1)
    expect(metrics.totalSucceeded).toBe(1)
  })

  it("tracks three mutate() calls in totalQueued", async () => {
    const sync = createSyncEngine({ transport: new MockTransport() })

    await sync.mutate("a", { n: 1 })
    await sync.mutate("b", { n: 2 })
    await sync.mutate("c", { n: 3 })

    expect(sync.getMetrics().totalQueued).toBe(3)
  })

  it("tracks flush successes and lastSuccessfulFlushAt", async () => {
    const sync = createSyncEngine({ transport: new MockTransport() })

    await sync.mutate("a", { n: 1 })
    await sync.mutate("b", { n: 2 })

    const before = sync.getMetrics().lastSuccessfulFlushAt
    expect(before).toBeNull()

    await sync.flush()

    const metrics = sync.getMetrics()
    expect(metrics.totalSucceeded).toBe(2)
    expect(metrics.lastSuccessfulFlushAt).toBeInstanceOf(Date)
  })

  it("does not update lastSuccessfulFlushAt when flush has zero successes", async () => {
    const sync = createSyncEngine({
      transport: new FailingTransport(),
      maxRetries: 0,
    })

    await sync.mutate("create", { id: "1" })
    await sync.flush()

    expect(sync.getMetrics().totalSucceeded).toBe(0)
    expect(sync.getMetrics().lastSuccessfulFlushAt).toBeNull()
  })

  it("counts each transport failure as a retry attempt until success", async () => {
    const transport = new PerOpFlakyTransport(2)
    const sync = createSyncEngine({ transport, maxRetries: 5 })

    await sync.mutate("create", { id: "1" })
    await sync.flush()
    await sync.flush()
    await sync.flush()

    const metrics = sync.getMetrics()
    expect(metrics.totalSucceeded).toBe(1)
    expect(metrics.totalRetried).toBe(2)
    expect(metrics.averageRetries).toBe(2)
  })

  it("with maxRetries=0 records totalFailed=1 and totalRetried=0", async () => {
    const sync = createSyncEngine({
      transport: new FailingTransport(),
      maxRetries: 0,
    })

    await sync.mutate("create", { id: "1" })
    await sync.flush()

    const metrics = sync.getMetrics()
    expect(metrics.totalFailed).toBe(1)
    expect(metrics.totalRetried).toBe(0)
  })

  it("with maxRetries=1 records totalFailed=1 and totalRetried=1", async () => {
    const sync = createSyncEngine({
      transport: new FailingTransport(),
      maxRetries: 1,
    })

    await sync.mutate("create", { id: "1" })
    await sync.flush()

    const metrics = sync.getMetrics()
    expect(metrics.totalFailed).toBe(1)
    expect(metrics.totalRetried).toBe(1)
  })

  it("does not backfill metrics from hydrated storage", async () => {
    const storage = createMemoryStorage()
    await seedStorage(
      storage,
      buildOperations(500, SyncOperationStatuses.Completed, { payloadBytes: 100 }),
    )

    const sync = createSyncEngine({ storage })
    await sync.inspect()

    expect(sync.getMetrics()).toEqual({
      totalQueued: 0,
      totalSucceeded: 0,
      totalFailed: 0,
      totalRetried: 0,
      averageRetries: 0,
      lastSuccessfulFlushAt: null,
    })
  })

  it("resets metrics on a new engine instance after reload", async () => {
    const storage = createMemoryStorage()
    const sync1 = createSyncEngine({ storage, transport: new MockTransport() })

    await sync1.mutate("create", { id: "1" })
    await sync1.flush()
    expect(sync1.getMetrics().totalSucceeded).toBe(1)

    const sync2 = createSyncEngine({ storage, transport: new MockTransport() })
    await sync2.inspect()

    expect(sync2.getMetrics().totalQueued).toBe(0)
    expect(sync2.getMetrics().totalSucceeded).toBe(0)
  })

  it("preserves metrics after destroy()", async () => {
    const sync = createSyncEngine({ transport: new MockTransport() })

    await sync.mutate("create", { id: "1" })
    await sync.flush()
    await sync.destroy()

    const metrics = sync.getMetrics()
    expect(metrics.totalQueued).toBe(1)
    expect(metrics.totalSucceeded).toBe(1)
  })

  it("does not change metrics when compact() or remove() run", async () => {
    const sync = createSyncEngine({ transport: new MockTransport() })
    const operation = await sync.mutate("create", { id: "1" })
    await sync.flush()

    const before = sync.getMetrics()
    await sync.compact()
    await sync.mutate("another", { id: "2" })
    await sync.remove(operation.id)

    const after = sync.getMetrics()
    expect(after.totalQueued).toBe(before.totalQueued + 1)
    expect(after.totalSucceeded).toBe(before.totalSucceeded)
    expect(after.totalFailed).toBe(before.totalFailed)
    expect(after.totalRetried).toBe(before.totalRetried)
  })
})

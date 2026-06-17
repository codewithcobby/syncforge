import { describe, expect, it } from "vitest"
import {
  createMemoryStorage,
  createSyncEngine,
  SyncEventTypes,
  type SyncEvent,
  type SyncOperation,
  type TransportAdapter,
} from "../src/index.js"

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

function collectQueueChanged(sync: ReturnType<typeof createSyncEngine>): SyncEvent[] {
  const events: SyncEvent[] = []
  sync.on(SyncEventTypes.QueueChanged, (event) => events.push(event))
  return events
}

describe("queue:changed integration", () => {
  it("mutate() emits queue:changed without operation field", async () => {
    const sync = createSyncEngine({ storage: createMemoryStorage() })
    const events = collectQueueChanged(sync)

    await sync.mutate("createOrder", { id: "1" })

    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe(SyncEventTypes.QueueChanged)
    expect(events[0]!.operation).toBeUndefined()
    expect(events[0]!.timestamp).toBeInstanceOf(Date)
  })

  it("inspect() does not emit queue:changed", async () => {
    const sync = createSyncEngine({ storage: createMemoryStorage() })
    const events = collectQueueChanged(sync)

    await sync.mutate("createOrder", { id: "1" })
    events.length = 0

    await sync.inspect()

    expect(events).toHaveLength(0)
  })

  it("flush() emits queue:changed on status transitions", async () => {
    const sync = createSyncEngine({
      transport: new MockTransport(),
      storage: createMemoryStorage(),
    })
    const events = collectQueueChanged(sync)

    await sync.mutate("createOrder", { id: "1" })
    events.length = 0

    await sync.flush()

    expect(events.length).toBeGreaterThanOrEqual(2)
    expect(events.every((event) => event.type === SyncEventTypes.QueueChanged)).toBe(true)
    expect(events.every((event) => event.operation === undefined)).toBe(true)
  })

  it("compact() emits queue:changed when completed ops are removed", async () => {
    const sync = createSyncEngine({
      transport: new MockTransport(),
      storage: createMemoryStorage(),
    })
    const events = collectQueueChanged(sync)

    await sync.mutate("createOrder", { id: "1" })
    await sync.flush()
    events.length = 0

    const removed = await sync.compact()

    expect(removed).toBe(1)
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe(SyncEventTypes.QueueChanged)
  })

  it("compact() does not emit queue:changed when nothing to remove", async () => {
    const sync = createSyncEngine({ storage: createMemoryStorage() })
    const events = collectQueueChanged(sync)

    const removed = await sync.compact()

    expect(removed).toBe(0)
    expect(events).toHaveLength(0)
  })

  it("remove() emits queue:changed", async () => {
    const sync = createSyncEngine({ storage: createMemoryStorage() })
    const events = collectQueueChanged(sync)

    const operation = await sync.mutate("createOrder", { id: "1" })
    events.length = 0

    const removed = await sync.remove(operation.id)

    expect(removed).toBe(true)
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe(SyncEventTypes.QueueChanged)
  })

  it("remove() does not emit queue:changed when id is not found", async () => {
    const sync = createSyncEngine({ storage: createMemoryStorage() })
    const events = collectQueueChanged(sync)

    const removed = await sync.remove("missing")

    expect(removed).toBe(false)
    expect(events).toHaveLength(0)
  })

  it("clear() emits queue:changed", async () => {
    const sync = createSyncEngine({ storage: createMemoryStorage() })
    const events = collectQueueChanged(sync)

    await sync.mutate("createOrder", { id: "1" })
    events.length = 0

    await sync.clear()

    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe(SyncEventTypes.QueueChanged)
  })

  it("destroy() emits queue:changed", async () => {
    const sync = createSyncEngine({ storage: createMemoryStorage() })
    const events = collectQueueChanged(sync)

    await sync.mutate("createOrder", { id: "1" })
    events.length = 0

    await sync.destroy()

    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe(SyncEventTypes.QueueChanged)
  })

  it("retry() emits queue:changed when op moves failed to pending", async () => {
    const sync = createSyncEngine({
      transport: new FailingTransport(),
      storage: createMemoryStorage(),
      maxRetries: 1,
    })
    const events = collectQueueChanged(sync)

    const operation = await sync.mutate("createOrder", { id: "1" })
    await sync.flush()
    events.length = 0

    const retried = await sync.retry(operation.id)

    expect(retried).toBe(true)
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe(SyncEventTypes.QueueChanged)
  })

  it("retry() does not emit queue:changed on non-failed id", async () => {
    const sync = createSyncEngine({ storage: createMemoryStorage() })
    const events = collectQueueChanged(sync)

    const operation = await sync.mutate("createOrder", { id: "1" })
    events.length = 0

    const retried = await sync.retry(operation.id)

    expect(retried).toBe(false)
    expect(events).toHaveLength(0)
  })

  it("retryAllFailed() emits one queue:changed per successfully retried operation", async () => {
    const sync = createSyncEngine({
      transport: new FailingTransport(),
      storage: createMemoryStorage(),
      maxRetries: 1,
    })
    const events = collectQueueChanged(sync)

    await sync.mutate("createOrder", { id: "1" })
    await sync.mutate("createOrder", { id: "2" })
    await sync.mutate("createOrder", { id: "3" })
    await sync.flush()
    events.length = 0

    const count = await sync.retryAllFailed()

    expect(count).toBe(3)
    expect(events).toHaveLength(3)
    expect(events.every((event) => event.type === SyncEventTypes.QueueChanged)).toBe(true)
  })
})

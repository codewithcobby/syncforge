import { describe, expect, it, vi } from "vitest"
import {
  createMemoryStorage,
  createSyncEngine,
  SyncEventTypes,
  SyncOperationStatuses,
  type StorageAdapter,
  type SyncEvent,
  type SyncOperation,
  type TransportAdapter,
} from "../src/index.js"

class MockTransport implements TransportAdapter {
  async send(): Promise<void> {}
}

class FailingTransport implements TransportAdapter {
  attempts = 0

  async send(): Promise<void> {
    this.attempts += 1
    throw new Error("network error")
  }
}

function createJsonStorage(): StorageAdapter {
  let serialized = "[]"

  return {
    async loadOperations(): Promise<SyncOperation[]> {
      return JSON.parse(serialized) as SyncOperation[]
    },

    async saveOperations(operations: SyncOperation[]): Promise<void> {
      serialized = JSON.stringify(operations)
    },
  }
}

function createOrderStore() {
  const orders: Array<{ id: string; label: string; badge?: string }> = []

  return {
    orders,
    add(order: { id: string; label: string; badge?: string }) {
      orders.push(order)
    },
    remove(id: string) {
      const index = orders.findIndex((order) => order.id === id)
      if (index !== -1) {
        orders.splice(index, 1)
      }
    },
  }
}

describe("optimistic integration", () => {
  it("runs registry apply on mutate and emits optimistic then queued", async () => {
    const orderStore = createOrderStore()
    const events: SyncEvent[] = []

    const sync = createSyncEngine({
      storage: createMemoryStorage(),
      context: { orderStore },
      optimisticHandlers: {
        createOrder: {
          apply(operation, ctx) {
            const payload = operation.payload as { id: string; label: string }
            ctx.orderStore.add(payload)
          },
          rollback() {},
        },
      },
    })

    sync.on(SyncEventTypes.Optimistic, (event) => events.push(event))
    sync.on(SyncEventTypes.Queued, (event) => events.push(event))

    await sync.mutate(
      "createOrder",
      { id: "1", label: "A" },
      {
        optimisticData: { tempId: "1" },
      },
    )

    expect(orderStore.orders).toEqual([{ id: "1", label: "A" }])
    expect(events.map((event) => event.type)).toEqual([SyncEventTypes.Optimistic, SyncEventTypes.Queued])
  })

  it("uses inline apply only and registry rollback on terminal failure", async () => {
    const orderStore = createOrderStore()
    const rollback = vi.fn((operation, _error, ctx) => {
      const tempId = (operation.optimisticData as { tempId: string }).tempId
      ctx.orderStore.remove(tempId)
    })

    const sync = createSyncEngine({
      transport: new FailingTransport(),
      storage: createMemoryStorage(),
      maxRetries: 1,
      context: { orderStore },
      optimisticHandlers: {
        createOrder: {
          apply() {
            orderStore.add({ id: "registry", label: "should-not-run" })
          },
          rollback,
        },
      },
    })

    await sync.mutate(
      "createOrder",
      { id: "1", label: "inline" },
      {
        optimisticData: { tempId: "1" },
        optimisticUpdate(operation, ctx) {
          const payload = operation.payload as { id: string; label: string }
          ctx.orderStore.add({ ...payload, badge: "new" })
        },
      },
    )

    expect(orderStore.orders).toEqual([{ id: "1", label: "inline", badge: "new" }])

    await sync.flush()

    expect(rollback).toHaveBeenCalledTimes(1)
    expect(orderStore.orders).toEqual([])
  })

  it("uses registry apply and inline rollback on terminal failure", async () => {
    const orderStore = createOrderStore()
    const inlineRollback = vi.fn()

    const sync = createSyncEngine({
      transport: new FailingTransport(),
      storage: createMemoryStorage(),
      maxRetries: 1,
      context: { orderStore },
      optimisticHandlers: {
        createOrder: {
          apply(operation, ctx) {
            const payload = operation.payload as { id: string; label: string }
            ctx.orderStore.add(payload)
          },
          rollback() {
            orderStore.remove("registry-should-not-run")
          },
        },
      },
    })

    await sync.mutate(
      "createOrder",
      { id: "1", label: "A" },
      {
        optimisticData: { tempId: "1" },
        rollback: inlineRollback,
      },
    )

    expect(orderStore.orders).toHaveLength(1)
    await sync.flush()
    expect(inlineRollback).toHaveBeenCalledTimes(1)
    expect(orderStore.orders).toHaveLength(1)
  })

  it("uses both inline handlers and ignores registry for that operation", async () => {
    const orderStore = createOrderStore()
    const registryRollback = vi.fn()
    const inlineRollback = vi.fn()

    const sync = createSyncEngine({
      transport: new FailingTransport(),
      storage: createMemoryStorage(),
      maxRetries: 1,
      context: { orderStore },
      optimisticHandlers: {
        createOrder: {
          apply() {
            orderStore.add({ id: "registry", label: "no" })
          },
          rollback: registryRollback,
        },
      },
    })

    await sync.mutate(
      "createOrder",
      { id: "1", label: "inline" },
      {
        optimisticUpdate(operation, ctx) {
          const payload = operation.payload as { id: string; label: string }
          ctx.orderStore.add(payload)
        },
        rollback: inlineRollback,
      },
    )

    expect(orderStore.orders).toEqual([{ id: "1", label: "inline" }])
    await sync.flush()
    expect(inlineRollback).toHaveBeenCalledTimes(1)
    expect(registryRollback).not.toHaveBeenCalled()
  })

  it("does not rollback on retryable failure", async () => {
    const orderStore = createOrderStore()
    const rollback = vi.fn()
    const events: SyncEvent[] = []

    const sync = createSyncEngine({
      transport: new FailingTransport(),
      storage: createMemoryStorage(),
      maxRetries: 3,
      context: { orderStore },
      optimisticHandlers: {
        createOrder: {
          apply(operation, ctx) {
            const payload = operation.payload as { id: string; label: string }
            ctx.orderStore.add(payload)
          },
          rollback,
        },
      },
    })

    sync.on(SyncEventTypes.Syncing, (event) => events.push(event))
    sync.on(SyncEventTypes.Queued, (event) => events.push(event))
    sync.on(SyncEventTypes.Rollback, (event) => events.push(event))

    await sync.mutate("createOrder", { id: "1", label: "A" })
    events.length = 0
    await sync.flush()

    expect(rollback).not.toHaveBeenCalled()
    expect(events.map((event) => event.type)).toEqual([SyncEventTypes.Syncing, SyncEventTypes.Queued])
    expect(orderStore.orders).toHaveLength(1)
  })

  it("emits syncing, rollback, then failed on terminal failure", async () => {
    const orderStore = createOrderStore()
    const events: SyncEvent[] = []

    const sync = createSyncEngine({
      transport: new FailingTransport(),
      storage: createMemoryStorage(),
      maxRetries: 1,
      context: { orderStore },
      optimisticHandlers: {
        createOrder: {
          apply(operation, ctx) {
            const payload = operation.payload as { id: string; label: string }
            ctx.orderStore.add(payload)
          },
          rollback(operation, error, ctx) {
            const tempId = (operation.optimisticData as { tempId: string }).tempId
            ctx.orderStore.remove(tempId)
          },
        },
      },
    })

    sync.on(SyncEventTypes.Syncing, (event) => events.push(event))
    sync.on(SyncEventTypes.Rollback, (event) => events.push(event))
    sync.on(SyncEventTypes.Failed, (event) => events.push(event))

    await sync.mutate(
      "createOrder",
      { id: "1", label: "A" },
      {
        optimisticData: { tempId: "1" },
      },
    )
    await sync.flush()

    expect(events.map((event) => event.type)).toEqual([SyncEventTypes.Syncing, SyncEventTypes.Rollback, SyncEventTypes.Failed])
    expect(events[1]?.error).toBeInstanceOf(Error)
    expect(events[2]?.error).toBeInstanceOf(Error)
    expect(orderStore.orders).toEqual([])
  })

  it("uses registry rollback after reload with persisted optimisticData", async () => {
    const storage = createJsonStorage()
    const orderStore = createOrderStore()

    const sync1 = createSyncEngine({
      transport: new FailingTransport(),
      storage,
      maxRetries: 1,
      context: { orderStore },
      optimisticHandlers: {
        createOrder: {
          apply(operation, ctx) {
            const payload = operation.payload as { id: string; label: string }
            ctx.orderStore.add(payload)
          },
          rollback(operation, _error, ctx) {
            const tempId = (operation.optimisticData as { tempId: string }).tempId
            ctx.orderStore.remove(tempId)
          },
        },
      },
    })

    await sync1.mutate(
      "createOrder",
      { id: "1", label: "A" },
      {
        optimisticData: { tempId: "1" },
      },
    )

    const sync2 = createSyncEngine({
      transport: new FailingTransport(),
      storage,
      maxRetries: 1,
      context: { orderStore },
      optimisticHandlers: {
        createOrder: {
          apply(operation, ctx) {
            const payload = operation.payload as { id: string; label: string }
            ctx.orderStore.add(payload)
          },
          rollback(operation, _error, ctx) {
            const tempId = (operation.optimisticData as { tempId: string }).tempId
            ctx.orderStore.remove(tempId)
          },
        },
      },
    })

    orderStore.orders.splice(0, orderStore.orders.length, { id: "1", label: "A" })
    await sync2.flush()

    expect(orderStore.orders).toEqual([])
    const failed = await sync2.getFailed()
    expect(failed).toHaveLength(1)
    expect(failed[0]?.optimisticData).toEqual({ tempId: "1" })
  })

  it("persists optimisticData across storage round-trip", async () => {
    const storage = createJsonStorage()

    const sync1 = createSyncEngine({ storage })
    await sync1.mutate(
      "createOrder",
      { id: "1" },
      {
        optimisticData: { tempId: "temp-1" },
      },
    )

    const sync2 = createSyncEngine({ storage })
    const pending = await sync2.getPending()

    expect(pending[0]?.optimisticData).toEqual({ tempId: "temp-1" })
  })

  it("lists failed operations and retries with cleared lastError", async () => {
    const sync = createSyncEngine({
      transport: new FailingTransport(),
      storage: createMemoryStorage(),
      maxRetries: 1,
      context: {},
      optimisticHandlers: {
        createOrder: {
          apply() {},
          rollback() {},
        },
      },
    })

    await sync.mutate("createOrder", { id: "1" })
    await sync.flush()

    const failed = await sync.getFailed()
    expect(failed).toHaveLength(1)
    expect(failed[0]?.lastError).toBeInstanceOf(Error)
    expect(failed[0]?.status).toBe(SyncOperationStatuses.Failed)

    const retried = await sync.retry(failed[0]!.id)
    expect(retried).toBe(true)

    const pending = await sync.getPending()
    expect(pending).toHaveLength(1)
    expect(pending[0]?.lastError).toBeUndefined()
    expect(pending[0]?.status).toBe(SyncOperationStatuses.Pending)
    expect(await sync.getFailed()).toHaveLength(0)
  })

  it("does not re-apply on hydrate", async () => {
    const storage = createJsonStorage()
    const apply = vi.fn()

    const sync1 = createSyncEngine({
      storage,
      context: {},
      optimisticHandlers: {
        createOrder: { apply, rollback() {} },
      },
    })

    await sync1.mutate("createOrder", { id: "1" })
    expect(apply).toHaveBeenCalledTimes(1)

    const events: SyncEvent[] = []
    const sync2 = createSyncEngine({
      storage,
      context: {},
      optimisticHandlers: {
        createOrder: { apply, rollback() {} },
      },
    })

    sync2.on(SyncEventTypes.Optimistic, (event) => events.push(event))
    await sync2.getPending()

    expect(apply).toHaveBeenCalledTimes(1)
    expect(events).toHaveLength(0)
  })

  it("does not run apply when persist fails", async () => {
    const apply = vi.fn()
    const storage: StorageAdapter = {
      async loadOperations() {
        return []
      },
      async saveOperations() {
        throw new Error("persist failed")
      },
    }

    const sync = createSyncEngine({
      storage,
      context: {},
      optimisticHandlers: {
        createOrder: { apply, rollback() {} },
      },
    })

    const events: SyncEvent[] = []
    sync.on(SyncEventTypes.Optimistic, (event) => events.push(event))

    await expect(sync.mutate("createOrder", { id: "1" })).rejects.toThrow("persist failed")
    expect(apply).not.toHaveBeenCalled()
    expect(events).toHaveLength(0)
  })

  it("does not mutate store on retry", async () => {
    const orderStore = createOrderStore()
    const apply = vi.fn((operation, ctx) => {
      const payload = operation.payload as { id: string; label: string }
      ctx.orderStore.add(payload)
    })

    const sync = createSyncEngine({
      transport: new FailingTransport(),
      storage: createMemoryStorage(),
      maxRetries: 1,
      context: { orderStore },
      optimisticHandlers: {
        createOrder: { apply, rollback() {} },
      },
    })

    await sync.mutate("createOrder", { id: "1", label: "A" })
    await sync.flush()
    apply.mockClear()

    const failed = await sync.getFailed()
    await sync.retry(failed[0]!.id)

    expect(apply).not.toHaveBeenCalled()
    expect(orderStore.orders).toHaveLength(1)
  })
})

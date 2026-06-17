import { describe, expect, it, vi } from "vitest"
import {
  createMemoryStorage,
  createSyncEngine,
  SyncEventTypes,
  SyncOperationStatuses,
  type SyncEvent,
  type SyncOperation,
  type TransportAdapter,
} from "../src/index.js"

class FailingTransport implements TransportAdapter {
  attempts = 0

  async send(): Promise<void> {
    this.attempts += 1
    throw new Error("network error")
  }
}

class MockTransport implements TransportAdapter {
  sent: SyncOperation[] = []

  async send(operation: SyncOperation): Promise<void> {
    this.sent.push({ ...operation })
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

function createFailingEngine() {
  return createSyncEngine({
    transport: new FailingTransport(),
    storage: createMemoryStorage(),
    maxRetries: 1,
  })
}

describe("recovery integration", () => {
  describe("retryAllFailed()", () => {
    it("returns 0 and emits no operation:queued when no failed operations exist", async () => {
      const sync = createSyncEngine({ storage: createMemoryStorage() })
      const events: SyncEvent[] = []
      sync.on(SyncEventTypes.Queued, (event) => events.push(event))

      const count = await sync.retryAllFailed()

      expect(count).toBe(0)
      expect(events).toHaveLength(0)
    })

    it("retries multiple failed operations and clears lastError", async () => {
      const sync = createFailingEngine()

      await sync.mutate("createOrder", { id: "1" })
      await sync.mutate("createOrder", { id: "2" })
      await sync.mutate("createOrder", { id: "3" })
      await sync.flush()

      expect(await sync.getFailed()).toHaveLength(3)

      const count = await sync.retryAllFailed()

      expect(count).toBe(3)
      expect(await sync.getFailed()).toHaveLength(0)

      const pending = await sync.getPending()
      expect(pending).toHaveLength(3)
      expect(pending.every((op) => op.status === SyncOperationStatuses.Pending)).toBe(true)
      expect(pending.every((op) => op.lastError === undefined)).toBe(true)
    })

    it("preserves queue order after retryAllFailed and subsequent flush", async () => {
      const transport = new ToggleTransport()
      const sync = createSyncEngine({
        transport,
        storage: createMemoryStorage(),
        maxRetries: 1,
      })

      const opA = await sync.mutate("createOrder", { label: "A" })
      const opB = await sync.mutate("createOrder", { label: "B" })
      const opC = await sync.mutate("createOrder", { label: "C" })
      await sync.flush()

      expect(await sync.getFailed()).toHaveLength(3)

      await sync.retryAllFailed()

      const pending = await sync.getPending()
      expect(pending.map((op) => op.id)).toEqual([opA.id, opB.id, opC.id])

      transport.shouldFail = false
      await sync.flush()

      const labelsAfterRecovery = transport.sent
        .slice(3)
        .map((op) => (op.payload as { label: string }).label)
      expect(labelsAfterRecovery).toEqual(["A", "B", "C"])
    })

    it("only retries failed operations in a mixed queue", async () => {
      const storage = createMemoryStorage()

      const completing = createSyncEngine({
        transport: new MockTransport(),
        storage,
      })
      await completing.mutate("createOrder", { id: "completed" })
      await completing.flush()

      const failing = createSyncEngine({
        transport: new FailingTransport(),
        storage,
        maxRetries: 1,
      })
      await failing.mutate("createOrder", { id: "failed-1" })
      await failing.mutate("createOrder", { id: "failed-2" })
      await failing.flush()

      const queuing = createSyncEngine({ storage })
      await queuing.mutate("createOrder", { id: "pending" })

      const recovery = createSyncEngine({ storage })
      const count = await recovery.retryAllFailed()

      expect(count).toBe(2)
      expect(await recovery.getFailed()).toHaveLength(0)

      const pending = await recovery.getPending()
      expect(pending).toHaveLength(3)
      expect(pending.map((op) => (op.payload as { id: string }).id)).toEqual([
        "failed-1",
        "failed-2",
        "pending",
      ])
    })

    it("emits operation:queued for each retried operation", async () => {
      const sync = createFailingEngine()

      await sync.mutate("createOrder", { id: "1" })
      await sync.mutate("createOrder", { id: "2" })
      await sync.flush()

      const failed = await sync.getFailed()
      const failedIds = new Set(failed.map((op) => op.id))

      const events: SyncEvent[] = []
      sync.on(SyncEventTypes.Queued, (event) => events.push(event))

      const count = await sync.retryAllFailed()

      expect(count).toBe(2)
      expect(events).toHaveLength(2)
      expect(events.every((event) => failedIds.has(event.operation.id))).toBe(true)
    })

    it("does not re-run optimistic apply", async () => {
      const apply = vi.fn()
      const sync = createSyncEngine({
        transport: new FailingTransport(),
        storage: createMemoryStorage(),
        maxRetries: 1,
        context: {},
        optimisticHandlers: {
          createOrder: { apply, rollback() {} },
        },
      })

      await sync.mutate("createOrder", { id: "1" })
      await sync.mutate("createOrder", { id: "2" })
      await sync.flush()
      apply.mockClear()

      await sync.retryAllFailed()

      expect(apply).not.toHaveBeenCalled()
    })

    it("recovers failed operations end-to-end after retryAllFailed and flush", async () => {
      const transport = new ToggleTransport()
      const sync = createSyncEngine({
        transport,
        storage: createMemoryStorage(),
        maxRetries: 1,
      })

      await sync.mutate("createOrder", { id: "1" })
      await sync.mutate("createOrder", { id: "2" })
      await sync.flush()

      expect(await sync.getFailed()).toHaveLength(2)

      const count = await sync.retryAllFailed()
      expect(count).toBe(2)

      transport.shouldFail = false
      const result = await sync.flush()

      expect(result).toEqual({ successful: 2, failed: 0 })
      expect(await sync.getPending()).toHaveLength(0)
    })
  })
})

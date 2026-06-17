import { describe, expect, it, vi } from "vitest"
import {
  createMemoryStorage,
  createSyncEngine,
  SyncOperationStatuses,
  type StorageAdapter,
  type SyncOperation,
  type TransportAdapter,
} from "../src/index.js"

class MockTransport implements TransportAdapter {
  sent: SyncOperation[] = []

  async send(operation: SyncOperation): Promise<void> {
    this.sent.push({ ...operation })
  }
}

class SlowTransport implements TransportAdapter {
  sent: SyncOperation[] = []

  async send(operation: SyncOperation): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 50))
    this.sent.push({ ...operation })
  }
}

class FailingTransport implements TransportAdapter {
  async send(): Promise<void> {
    throw new Error("network error")
  }
}

describe("inspect integration", () => {
  describe("inspect()", () => {
    it("returns zero counts and no operations on an empty queue", async () => {
      const sync = createSyncEngine({ storage: createMemoryStorage() })

      const snapshot = await sync.inspect()

      expect(snapshot).toEqual({
        pending: 0,
        failed: 0,
        completed: 0,
        syncing: 0,
        total: 0,
        isSyncing: false,
      })
      expect(snapshot.operations).toBeUndefined()
    })

    it("returns correct counts for a mixed queue", async () => {
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
      await failing.mutate("createOrder", { id: "failed" })
      await failing.flush()

      await createSyncEngine({ storage }).mutate("createOrder", { id: "pending" })

      const snapshot = await createSyncEngine({ storage }).inspect()

      expect(snapshot).toEqual({
        pending: 1,
        failed: 1,
        completed: 1,
        syncing: 0,
        total: 3,
        isSyncing: false,
      })
      expect(snapshot.operations).toBeUndefined()
    })

    it("reports isSyncing during an active flush", async () => {
      const sync = createSyncEngine({
        transport: new SlowTransport(),
        storage: createMemoryStorage(),
      })

      await sync.mutate("createOrder", { id: "1" })

      const flushPromise = sync.flush()
      const snapshot = await sync.inspect()
      await flushPromise

      expect(snapshot.isSyncing).toBe(true)
      expect(snapshot.syncing).toBeGreaterThanOrEqual(1)
    })

    it("attaches filtered operations when operations option is set", async () => {
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
      await failing.mutate("createOrder", { id: "failed" })
      await failing.flush()

      await createSyncEngine({ storage }).mutate("createOrder", { id: "pending" })

      const snapshot = await createSyncEngine({ storage }).inspect({
        operations: [SyncOperationStatuses.Pending, SyncOperationStatuses.Failed],
      })

      expect(snapshot.pending).toBe(1)
      expect(snapshot.failed).toBe(1)
      expect(snapshot.completed).toBe(1)
      expect(snapshot.total).toBe(3)
      expect(snapshot.operations).toHaveLength(2)
      expect(
        snapshot.operations?.every(
          (op) =>
            op.status === SyncOperationStatuses.Pending ||
            op.status === SyncOperationStatuses.Failed,
        ),
      ).toBe(true)
      expect(
        snapshot.operations?.some((op) => op.status === SyncOperationStatuses.Completed),
      ).toBe(false)
    })

    it("does not attach operations by default", async () => {
      const sync = createSyncEngine({
        transport: new MockTransport(),
        storage: createMemoryStorage(),
      })

      await sync.mutate("createOrder", { id: "1" })
      await sync.flush()

      const snapshot = await sync.inspect()

      expect(snapshot.completed).toBe(1)
      expect(snapshot.operations).toBeUndefined()
    })

    it("returns shallow copies that do not mutate the queue", async () => {
      const sync = createSyncEngine({
        transport: new FailingTransport(),
        storage: createMemoryStorage(),
        maxRetries: 1,
      })

      await sync.mutate("createOrder", { id: "failed" })
      await sync.flush()

      const snapshot = await sync.inspect({
        operations: [SyncOperationStatuses.Failed],
      })

      expect(snapshot.operations).toHaveLength(1)
      snapshot.operations![0]!.status = SyncOperationStatuses.Completed

      const again = await sync.inspect({
        operations: [SyncOperationStatuses.Failed],
      })

      expect(again.failed).toBe(1)
      expect(again.operations?.[0]?.status).toBe(SyncOperationStatuses.Failed)
    })

    it("does not persist or mutate the queue", async () => {
      const saveOperations = vi.fn()
      const storage: StorageAdapter = {
        async loadOperations() {
          return []
        },
        saveOperations,
      }

      const sync = createSyncEngine({ storage })
      await sync.mutate("createOrder", { id: "1" })

      saveOperations.mockClear()
      await sync.inspect()

      expect(saveOperations).not.toHaveBeenCalled()
      expect(await sync.getPending()).toHaveLength(1)
    })

    it("reflects completed removal after compact", async () => {
      const sync = createSyncEngine({
        transport: new MockTransport(),
        storage: createMemoryStorage(),
      })

      await sync.mutate("createOrder", { id: "1" })
      await sync.mutate("createOrder", { id: "2" })
      await sync.flush()
      await sync.compact()

      const snapshot = await sync.inspect()

      expect(snapshot.completed).toBe(0)
      expect(snapshot.total).toBe(0)
      expect(snapshot.pending).toBe(0)
    })
  })
})

import { describe, expect, it } from "vitest"
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

describe("compaction integration", () => {
  describe("compact()", () => {
    it("returns 0 when no completed operations exist", async () => {
      const sync = createSyncEngine({ storage: createMemoryStorage() })
      await sync.mutate("createOrder", { id: "pending" })

      const removed = await sync.compact()

      expect(removed).toBe(0)
      expect(await sync.getPending()).toHaveLength(1)
    })

    it("removes completed operations after flush", async () => {
      const sync = createSyncEngine({
        transport: new MockTransport(),
        storage: createMemoryStorage(),
      })

      await sync.mutate("createOrder", { id: "1" })
      await sync.mutate("createOrder", { id: "2" })
      await sync.mutate("createOrder", { id: "3" })
      await sync.flush()

      const removed = await sync.compact()

      expect(removed).toBe(3)
      expect(await sync.getPending()).toHaveLength(0)
      expect(await sync.getFailed()).toHaveLength(0)
    })

    it("only removes completed operations in a mixed queue", async () => {
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

      const queuing = createSyncEngine({ storage })
      await queuing.mutate("createOrder", { id: "pending" })

      const compacting = createSyncEngine({ storage })
      const removed = await compacting.compact()

      expect(removed).toBe(1)

      const reloaded = createSyncEngine({ storage })
      expect(await reloaded.getPending()).toHaveLength(1)
      expect((await reloaded.getPending())[0]?.payload).toEqual({ id: "pending" })
      expect(await reloaded.getFailed()).toHaveLength(1)
      expect((await reloaded.getFailed())[0]?.payload).toEqual({ id: "failed" })
    })

    it("preserves queue order of remaining operations", async () => {
      const storage = createMemoryStorage()
      const sync = createSyncEngine({
        transport: new MockTransport(),
        storage,
      })

      const opA = await sync.mutate("createOrder", { label: "A" })
      const opB = await sync.mutate("createOrder", { label: "B" })
      const opC = await sync.mutate("createOrder", { label: "C" })
      await sync.flush()

      const opD = await sync.mutate("createOrder", { label: "D" })
      const opE = await sync.mutate("createOrder", { label: "E" })

      await sync.compact()

      const pending = await sync.getPending()
      expect(pending.map((op) => op.id)).toEqual([opD.id, opE.id])
      expect(pending.map((op) => (op.payload as { label: string }).label)).toEqual(["D", "E"])

      const reloaded = createSyncEngine({ storage })
      const reloadedPending = await reloaded.getPending()
      expect(reloadedPending.map((op) => op.id)).toEqual([opD.id, opE.id])

      expect(opA.status).toBe(SyncOperationStatuses.Completed)
      expect(opB.status).toBe(SyncOperationStatuses.Completed)
      expect(opC.status).toBe(SyncOperationStatuses.Completed)
    })

    it("persists compaction across a new storage instance", async () => {
      const storage = createJsonStorage()
      const sync1 = createSyncEngine({
        transport: new MockTransport(),
        storage,
      })

      await sync1.mutate("createOrder", { id: "completed" })
      await sync1.flush()

      await sync1.mutate("createOrder", { id: "pending" })
      await sync1.compact()

      const sync2 = createSyncEngine({ storage })
      const pending = await sync2.getPending()

      expect(pending).toHaveLength(1)
      expect(pending[0]?.payload).toEqual({ id: "pending" })
      expect(pending[0]?.status).toBe(SyncOperationStatuses.Pending)
    })

    it("is idempotent when called twice", async () => {
      const sync = createSyncEngine({
        transport: new MockTransport(),
        storage: createMemoryStorage(),
      })

      await sync.mutate("createOrder", { id: "1" })
      await sync.flush()

      expect(await sync.compact()).toBe(1)
      expect(await sync.compact()).toBe(0)
    })

    it("waits for active flush before compacting", async () => {
      const transport = new SlowTransport()
      const sync = createSyncEngine({
        transport,
        storage: createMemoryStorage(),
      })

      await sync.mutate("createOrder", { id: "1" })
      await sync.mutate("createOrder", { id: "2" })

      const flushPromise = sync.flush()
      const compactPromise = sync.compact()

      const removed = await compactPromise
      await flushPromise

      expect(removed).toBe(2)
      expect(transport.sent).toHaveLength(2)
      expect(await sync.getPending()).toHaveLength(0)
    })

    it("rejects when persistence fails and leaves storage unchanged", async () => {
      const baseStorage = createJsonStorage()
      const sync1 = createSyncEngine({
        transport: new MockTransport(),
        storage: baseStorage,
      })

      await sync1.mutate("createOrder", { id: "1" })
      await sync1.flush()

      let saveCount = 0
      const throwingStorage: StorageAdapter = {
        async loadOperations() {
          return baseStorage.loadOperations()
        },
        async saveOperations(operations) {
          saveCount += 1
          if (saveCount > 0) {
            throw new Error("persist failed")
          }
          await baseStorage.saveOperations(operations)
        },
      }

      const sync2 = createSyncEngine({ storage: throwingStorage })
      await sync2.getPending()

      await expect(sync2.compact()).rejects.toThrow("persist failed")

      const sync3 = createSyncEngine({ storage: baseStorage })
      const pending = await sync3.getPending()
      expect(pending).toHaveLength(0)

      const allOps = await baseStorage.loadOperations()
      expect(allOps).toHaveLength(1)
      expect(allOps[0]?.status).toBe(SyncOperationStatuses.Completed)
    })
  })
})

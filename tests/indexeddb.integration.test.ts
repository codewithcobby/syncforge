import "fake-indexeddb/auto"
import { describe, expect, it } from "vitest"
import {
  createIndexedDbStorage,
  createSyncEngine,
  SyncOperationStatuses,
  type SyncOperation,
  type TransportAdapter,
} from "../src/index.js"

class MockTransport implements TransportAdapter {
  sent: SyncOperation[] = []

  async send(operation: SyncOperation): Promise<void> {
    this.sent.push({ ...operation })
  }
}

function storageOptions(suffix: string) {
  return {
    dbName: `syncforge-integration-${suffix}`,
    storeName: "sync-queue",
  }
}

describe("IndexedDB integration", () => {
  it("reloads pending operations from a new storage instance after restart", async () => {
    const transport = new MockTransport()
    const options = storageOptions("restart")

    const sync1 = createSyncEngine({
      transport,
      storage: createIndexedDbStorage(options),
    })
    await sync1.mutate("createOrder", { id: 1 })

    const sync2 = createSyncEngine({
      transport,
      storage: createIndexedDbStorage(options),
    })

    const pending = await sync2.getPending()
    expect(pending).toHaveLength(1)
    expect(pending[0]?.type).toBe("createOrder")
    expect(pending[0]?.createdAt).toBeInstanceOf(Date)

    await sync2.flush()
    expect(transport.sent).toHaveLength(1)
    expect(transport.sent[0]?.payload).toEqual({ id: 1 })
  })

  it("persists remove across a new storage instance", async () => {
    const options = storageOptions("remove")

    const sync1 = createSyncEngine({
      storage: createIndexedDbStorage(options),
    })
    const first = await sync1.mutate("createOrder", { id: 1 })
    await sync1.mutate("createOrder", { id: 2 })
    await sync1.remove(first.id)

    const sync2 = createSyncEngine({
      storage: createIndexedDbStorage(options),
    })

    const pending = await sync2.getPending()
    expect(pending).toHaveLength(1)
    expect(pending[0]?.payload).toEqual({ id: 2 })
  })

  it("persists clear across a new storage instance", async () => {
    const options = storageOptions("clear")

    const sync1 = createSyncEngine({
      storage: createIndexedDbStorage(options),
    })
    await sync1.mutate("createOrder", { id: 1 })
    await sync1.clear()

    const sync2 = createSyncEngine({
      storage: createIndexedDbStorage(options),
    })

    expect(await sync2.getPending()).toHaveLength(0)
  })

  it("preserves retries and status across a new storage instance", async () => {
    const options = storageOptions("retries")

    class FailingTransport implements TransportAdapter {
      async send(): Promise<void> {
        throw new Error("network error")
      }
    }

    const sync1 = createSyncEngine({
      storage: createIndexedDbStorage(options),
      transport: new FailingTransport(),
      maxRetries: 3,
    })

    await sync1.mutate("createOrder", { id: 1 })
    await sync1.flush()

    const sync2 = createSyncEngine({
      storage: createIndexedDbStorage(options),
      transport: new MockTransport(),
      maxRetries: 3,
    })

    const pending = await sync2.getPending()
    expect(pending).toHaveLength(1)
    expect(pending[0]?.retries).toBe(1)
    expect(pending[0]?.status).toBe(SyncOperationStatuses.Pending)
    expect(pending[0]?.createdAt).toBeInstanceOf(Date)
  })
})

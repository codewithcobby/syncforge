import "fake-indexeddb/auto"
import { describe, expect, it } from "vitest"
import { createIndexedDbStorage, StorageError, SyncOperationStatuses, type SyncOperation } from "../src/index.js"

function uniqueStorageOptions(suffix: string) {
  return {
    dbName: `syncforge-test-${suffix}`,
    storeName: "operations",
  }
}

function sampleOperation(): SyncOperation {
  return {
    id: "op-1",
    type: "createOrder",
    payload: { total: 100 },
    status: SyncOperationStatuses.Pending,
    retries: 0,
    createdAt: new Date("2026-01-15T10:00:00.000Z"),
  }
}

describe("createIndexedDbStorage", () => {
  it("returns an empty array when no operations are stored", async () => {
    const storage = createIndexedDbStorage(uniqueStorageOptions("empty"))

    await expect(storage.loadOperations()).resolves.toEqual([])
  })

  it("round-trips operations through save and load", async () => {
    const storage = createIndexedDbStorage(uniqueStorageOptions("round-trip"))
    const operation = sampleOperation()

    await storage.saveOperations([operation])
    const loaded = await storage.loadOperations()

    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toEqual({
      ...operation,
      createdAt: operation.createdAt.toISOString(),
    })
  })

  it("isolates data by dbName", async () => {
    const operation = sampleOperation()
    const storageA = createIndexedDbStorage({
      dbName: "syncforge-test-a",
      storeName: "operations",
    })
    const storageB = createIndexedDbStorage({
      dbName: "syncforge-test-b",
      storeName: "operations",
    })

    await storageA.saveOperations([operation])

    await expect(storageA.loadOperations()).resolves.toHaveLength(1)
    await expect(storageB.loadOperations()).resolves.toEqual([])
  })

  it("throws StorageError when IndexedDB is unavailable", () => {
    const originalIndexedDb = globalThis.indexedDB
    // @ts-expect-error — simulate environments without IndexedDB
    delete globalThis.indexedDB

    try {
      expect(() => createIndexedDbStorage()).toThrow(StorageError)
      expect(() => createIndexedDbStorage()).toThrow(/IndexedDB is not available/)
    } finally {
      globalThis.indexedDB = originalIndexedDb
    }
  })
})

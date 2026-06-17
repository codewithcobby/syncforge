import { describe, expect, it, vi } from "vitest"
import {
  createAsyncStorageAdapter,
  StorageError,
  SyncOperationStatuses,
  type SyncOperation,
} from "../src/index.js"
import { createMockAsyncStorage } from "./helpers/mock-async-storage.js"

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

describe("createAsyncStorageAdapter", () => {
  it("throws StorageError when asyncStorage is missing", () => {
    expect(() =>
      createAsyncStorageAdapter({ asyncStorage: undefined as unknown as never }),
    ).toThrow(StorageError)
    expect(() =>
      createAsyncStorageAdapter({ asyncStorage: undefined as unknown as never }),
    ).toThrow(/Invalid asyncStorage instance/)
  })

  it("throws StorageError when getItem or setItem are not functions", () => {
    expect(() =>
      createAsyncStorageAdapter({
        asyncStorage: { getItem: "not-a-function" } as unknown as never,
      }),
    ).toThrow(StorageError)

    expect(() =>
      createAsyncStorageAdapter({
        asyncStorage: {
          getItem: async () => null,
          setItem: "not-a-function",
        } as unknown as never,
      }),
    ).toThrow(/Invalid asyncStorage instance/)
  })

  it("returns an empty array when no operations are stored", async () => {
    const storage = createAsyncStorageAdapter({
      asyncStorage: createMockAsyncStorage(),
      key: "test-empty",
    })

    await expect(storage.loadOperations()).resolves.toEqual([])
  })

  it("round-trips operations through save and load", async () => {
    const asyncStorage = createMockAsyncStorage()
    const storage = createAsyncStorageAdapter({ asyncStorage, key: "test-round-trip" })
    const operation = sampleOperation()

    await storage.saveOperations([operation])
    const loaded = await storage.loadOperations()

    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toEqual({
      ...operation,
      createdAt: operation.createdAt.toISOString(),
    })
  })

  it("round-trips optimisticData through save and load", async () => {
    const storage = createAsyncStorageAdapter({
      asyncStorage: createMockAsyncStorage(),
      key: "test-optimistic",
    })
    const operation: SyncOperation = {
      ...sampleOperation(),
      optimisticData: { tempId: "temp-1" },
    }

    await storage.saveOperations([operation])
    const loaded = await storage.loadOperations()

    expect(loaded[0]?.optimisticData).toEqual({ tempId: "temp-1" })
  })

  it("removes the key when saving an empty queue and removeItem is available", async () => {
    const asyncStorage = createMockAsyncStorage()
    const storage = createAsyncStorageAdapter({ asyncStorage, key: "test-clear-key" })

    await storage.saveOperations([sampleOperation()])
    await storage.saveOperations([])

    expect(await asyncStorage.getItem("test-clear-key")).toBeNull()
    await expect(storage.loadOperations()).resolves.toEqual([])
  })

  it("falls back to setItem when saving an empty queue without removeItem", async () => {
    const map = new Map<string, string>()
    const asyncStorage = {
      async getItem(key: string) {
        return map.get(key) ?? null
      },
      async setItem(key: string, value: string) {
        map.set(key, value)
      },
    }

    const storage = createAsyncStorageAdapter({ asyncStorage, key: "test-empty-fallback" })

    await storage.saveOperations([])
    expect(await asyncStorage.getItem("test-empty-fallback")).toBe("[]")
  })

  it("isolates data by key", async () => {
    const asyncStorage = createMockAsyncStorage()
    const operation = sampleOperation()
    const storageA = createAsyncStorageAdapter({ asyncStorage, key: "queue-a" })
    const storageB = createAsyncStorageAdapter({ asyncStorage, key: "queue-b" })

    await storageA.saveOperations([operation])

    await expect(storageA.loadOperations()).resolves.toHaveLength(1)
    await expect(storageB.loadOperations()).resolves.toEqual([])
  })

  it("isolates data by prefix", async () => {
    const asyncStorage = createMockAsyncStorage()
    const operation = sampleOperation()
    const storageA = createAsyncStorageAdapter({
      asyncStorage,
      prefix: "widget-a:",
      key: "queue",
    })
    const storageB = createAsyncStorageAdapter({
      asyncStorage,
      prefix: "widget-b:",
      key: "queue",
    })

    await storageA.saveOperations([operation])

    await expect(storageA.loadOperations()).resolves.toHaveLength(1)
    await expect(storageB.loadOperations()).resolves.toEqual([])
  })

  it("does not interfere when multiple adapters share the same asyncStorage", async () => {
    const asyncStorage = createMockAsyncStorage()
    const operationA = { ...sampleOperation(), id: "op-a" }
    const operationB = { ...sampleOperation(), id: "op-b" }

    const storageA = createAsyncStorageAdapter({
      asyncStorage,
      prefix: "app-a:",
      key: "queue",
    })
    const storageB = createAsyncStorageAdapter({
      asyncStorage,
      prefix: "app-b:",
      key: "queue",
    })

    await storageA.saveOperations([operationA])
    await storageB.saveOperations([operationB])

    const loadedA = await storageA.loadOperations()
    const loadedB = await storageB.loadOperations()

    expect(loadedA).toHaveLength(1)
    expect(loadedA[0]?.id).toBe("op-a")
    expect(loadedB).toHaveLength(1)
    expect(loadedB[0]?.id).toBe("op-b")
  })

  it("throws StorageError when stored JSON is invalid", async () => {
    const asyncStorage = createMockAsyncStorage()
    await asyncStorage.setItem("test-invalid-json", "not-json")
    const storage = createAsyncStorageAdapter({ asyncStorage, key: "test-invalid-json" })

    await expect(storage.loadOperations()).rejects.toThrow(StorageError)
    await expect(storage.loadOperations()).rejects.toMatchObject({
      message: expect.stringContaining("Failed to parse stored operations"),
    })
  })

  it("throws StorageError when setItem fails", async () => {
    const asyncStorage = createMockAsyncStorage()
    const storage = createAsyncStorageAdapter({ asyncStorage, key: "test-set-fail" })
    const setItemSpy = vi.spyOn(asyncStorage, "setItem").mockRejectedValue(new Error("disk full"))

    await expect(storage.saveOperations([sampleOperation()])).rejects.toThrow(StorageError)
    await expect(storage.saveOperations([sampleOperation()])).rejects.toThrow(/disk full/)

    setItemSpy.mockRestore()
  })
})

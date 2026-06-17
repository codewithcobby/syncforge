import { describe, expect, it, vi } from "vitest"
import {
  createCapacitorStorageAdapter,
  StorageError,
  SyncOperationStatuses,
  type SyncOperation,
} from "../src/index.js"
import { createMockPreferences } from "./helpers/mock-preferences.js"

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

describe("createCapacitorStorageAdapter", () => {
  it("throws StorageError when preferences is missing", () => {
    expect(() =>
      createCapacitorStorageAdapter({ preferences: undefined as unknown as never }),
    ).toThrow(StorageError)
    expect(() =>
      createCapacitorStorageAdapter({ preferences: undefined as unknown as never }),
    ).toThrow(/Invalid preferences instance/)
  })

  it("throws StorageError when get or set are not functions", () => {
    expect(() =>
      createCapacitorStorageAdapter({
        preferences: { get: "not-a-function" } as unknown as never,
      }),
    ).toThrow(StorageError)

    expect(() =>
      createCapacitorStorageAdapter({
        preferences: {
          get: async () => ({ value: null }),
          set: "not-a-function",
        } as unknown as never,
      }),
    ).toThrow(/Invalid preferences instance/)
  })

  it("returns an empty array when no operations are stored", async () => {
    const storage = createCapacitorStorageAdapter({
      preferences: createMockPreferences(),
      key: "test-empty",
    })

    await expect(storage.loadOperations()).resolves.toEqual([])
  })

  it("round-trips operations through save and load", async () => {
    const preferences = createMockPreferences()
    const storage = createCapacitorStorageAdapter({ preferences, key: "test-round-trip" })
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
    const storage = createCapacitorStorageAdapter({
      preferences: createMockPreferences(),
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

  it("removes the key when saving an empty queue and remove is available", async () => {
    const preferences = createMockPreferences()
    const storage = createCapacitorStorageAdapter({ preferences, key: "test-clear-key" })

    await storage.saveOperations([sampleOperation()])
    await storage.saveOperations([])

    expect((await preferences.get({ key: "test-clear-key" })).value).toBeNull()
    await expect(storage.loadOperations()).resolves.toEqual([])
  })

  it("falls back to set when saving an empty queue without remove", async () => {
    const map = new Map<string, string>()
    const preferences = {
      async get(options: { key: string }) {
        return { value: map.get(options.key) ?? null }
      },
      async set(options: { key: string; value: string }) {
        map.set(options.key, options.value)
      },
    }

    const storage = createCapacitorStorageAdapter({ preferences, key: "test-empty-fallback" })

    await storage.saveOperations([])
    expect((await preferences.get({ key: "test-empty-fallback" })).value).toBe("[]")
  })

  it("isolates data by key", async () => {
    const preferences = createMockPreferences()
    const operation = sampleOperation()
    const storageA = createCapacitorStorageAdapter({ preferences, key: "queue-a" })
    const storageB = createCapacitorStorageAdapter({ preferences, key: "queue-b" })

    await storageA.saveOperations([operation])

    await expect(storageA.loadOperations()).resolves.toHaveLength(1)
    await expect(storageB.loadOperations()).resolves.toEqual([])
  })

  it("isolates data by prefix", async () => {
    const preferences = createMockPreferences()
    const operation = sampleOperation()
    const storageA = createCapacitorStorageAdapter({
      preferences,
      prefix: "widget-a:",
      key: "queue",
    })
    const storageB = createCapacitorStorageAdapter({
      preferences,
      prefix: "widget-b:",
      key: "queue",
    })

    await storageA.saveOperations([operation])

    await expect(storageA.loadOperations()).resolves.toHaveLength(1)
    await expect(storageB.loadOperations()).resolves.toEqual([])
  })

  it("does not interfere when multiple adapters share the same preferences", async () => {
    const preferences = createMockPreferences()
    const operationA = { ...sampleOperation(), id: "op-a" }
    const operationB = { ...sampleOperation(), id: "op-b" }

    const storageA = createCapacitorStorageAdapter({
      preferences,
      prefix: "app-a:",
      key: "queue",
    })
    const storageB = createCapacitorStorageAdapter({
      preferences,
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
    const preferences = createMockPreferences()
    await preferences.set({ key: "test-invalid-json", value: "not-json" })
    const storage = createCapacitorStorageAdapter({ preferences, key: "test-invalid-json" })

    await expect(storage.loadOperations()).rejects.toThrow(StorageError)
    await expect(storage.loadOperations()).rejects.toMatchObject({
      message: expect.stringContaining("Failed to parse stored operations"),
    })
  })

  it("throws StorageError when set fails", async () => {
    const preferences = createMockPreferences()
    const storage = createCapacitorStorageAdapter({ preferences, key: "test-set-fail" })
    const setSpy = vi.spyOn(preferences, "set").mockRejectedValue(new Error("disk full"))

    await expect(storage.saveOperations([sampleOperation()])).rejects.toThrow(StorageError)
    await expect(storage.saveOperations([sampleOperation()])).rejects.toThrow(/disk full/)

    setSpy.mockRestore()
  })
})

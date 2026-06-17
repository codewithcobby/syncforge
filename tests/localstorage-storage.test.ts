import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createLocalStorageStorage,
  StorageError,
  SyncOperationStatuses,
  type SyncOperation,
} from "../src/index.js"
import { installMockLocalStorage } from "./helpers/mock-local-storage.js"

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

describe("createLocalStorageStorage", () => {
  let originalLocalStorage: Storage | undefined

  beforeEach(() => {
    originalLocalStorage = globalThis.localStorage
    installMockLocalStorage()
  })

  afterEach(() => {
    if (originalLocalStorage === undefined) {
      // @ts-expect-error — restore missing localStorage in Node
      delete globalThis.localStorage
    } else {
      globalThis.localStorage = originalLocalStorage
    }
  })

  it("returns an empty array when no operations are stored", async () => {
    const storage = createLocalStorageStorage({ key: "test-empty" })

    await expect(storage.loadOperations()).resolves.toEqual([])
  })

  it("round-trips operations through save and load", async () => {
    const storage = createLocalStorageStorage({ key: "test-round-trip" })
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
    const storage = createLocalStorageStorage({ key: "test-optimistic" })
    const operation: SyncOperation = {
      ...sampleOperation(),
      optimisticData: { tempId: "temp-1" },
    }

    await storage.saveOperations([operation])
    const loaded = await storage.loadOperations()

    expect(loaded[0]?.optimisticData).toEqual({ tempId: "temp-1" })
  })

  it("isolates data by key", async () => {
    const operation = sampleOperation()
    const storageA = createLocalStorageStorage({ key: "queue-a" })
    const storageB = createLocalStorageStorage({ key: "queue-b" })

    await storageA.saveOperations([operation])

    await expect(storageA.loadOperations()).resolves.toHaveLength(1)
    await expect(storageB.loadOperations()).resolves.toEqual([])
  })

  it("isolates data by prefix", async () => {
    const operation = sampleOperation()
    const storageA = createLocalStorageStorage({ prefix: "widget-a:", key: "queue" })
    const storageB = createLocalStorageStorage({ prefix: "widget-b:", key: "queue" })

    await storageA.saveOperations([operation])

    await expect(storageA.loadOperations()).resolves.toHaveLength(1)
    await expect(storageB.loadOperations()).resolves.toEqual([])
  })

  it("does not interfere when multiple adapters share the same localStorage", async () => {
    const operationA = { ...sampleOperation(), id: "op-a" }
    const operationB = { ...sampleOperation(), id: "op-b" }

    const storageA = createLocalStorageStorage({ prefix: "app-a:", key: "queue" })
    const storageB = createLocalStorageStorage({ prefix: "app-b:", key: "queue" })

    await storageA.saveOperations([operationA])
    await storageB.saveOperations([operationB])

    const loadedA = await storageA.loadOperations()
    const loadedB = await storageB.loadOperations()

    expect(loadedA).toHaveLength(1)
    expect(loadedA[0]?.id).toBe("op-a")
    expect(loadedB).toHaveLength(1)
    expect(loadedB[0]?.id).toBe("op-b")
  })

  it("uses default resolved key syncforge-queue", async () => {
    const storage = createLocalStorageStorage()
    const operation = sampleOperation()

    await storage.saveOperations([operation])

    expect(globalThis.localStorage.getItem("syncforge-queue")).not.toBeNull()
  })

  it("throws StorageError when localStorage is unavailable", () => {
    // @ts-expect-error — simulate environments without localStorage
    delete globalThis.localStorage

    expect(() => createLocalStorageStorage()).toThrow(StorageError)
    expect(() => createLocalStorageStorage()).toThrow(/localStorage is not available/)
  })

  it("throws StorageError when stored JSON is invalid", async () => {
    const storage = createLocalStorageStorage({ key: "test-invalid-json" })
    globalThis.localStorage.setItem("test-invalid-json", "not-json")

    await expect(storage.loadOperations()).rejects.toThrow(StorageError)
    await expect(storage.loadOperations()).rejects.toMatchObject({
      message: expect.stringContaining("Failed to parse stored operations"),
    })
  })

  it("throws StorageError with quota guidance when setItem quota is exceeded", async () => {
    const storage = createLocalStorageStorage({ key: "test-quota" })
    const quotaError = new DOMException("quota", "QuotaExceededError")
    const setItemSpy = vi.spyOn(globalThis.localStorage, "setItem").mockImplementation(() => {
      throw quotaError
    })

    await expect(storage.saveOperations([sampleOperation()])).rejects.toThrow(StorageError)
    await expect(storage.saveOperations([sampleOperation()])).rejects.toThrow(
      /LocalStorage quota exceeded/,
    )

    setItemSpy.mockRestore()
  })

  it("detects quota exceeded from plain error name fallback", async () => {
    const storage = createLocalStorageStorage({ key: "test-quota-fallback" })
    const setItemSpy = vi.spyOn(globalThis.localStorage, "setItem").mockImplementation(() => {
      throw { name: "QuotaExceededError" }
    })

    await expect(storage.saveOperations([sampleOperation()])).rejects.toThrow(
      /LocalStorage quota exceeded/,
    )

    setItemSpy.mockRestore()
  })
})

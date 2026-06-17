import { StorageError } from "./errors.js"
import type { StorageAdapter, SyncOperation } from "./types.js"

const DEFAULT_KEY = "syncforge-queue"

/**
 * Minimal subset of AsyncStorage used by SyncForge.
 * Additional methods on the injected object (mergeItem, multiGet, clear, etc.) are ignored.
 */
export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  /** When present, used to clear the key when the queue becomes empty */
  removeItem?(key: string): Promise<void>
}

export interface AsyncStorageAdapterOptions {
  /** Required — inject the app's AsyncStorage instance */
  asyncStorage: AsyncStorageLike
  /** Storage key; default `"syncforge-queue"` */
  key?: string
  /**
   * Prepended to `key` for per-app isolation; default `""`.
   * Include any separator you want (e.g. `"my-app:"`) — SyncForge does not insert colons or dashes.
   */
  prefix?: string
}

function assertAsyncStorageLike(asyncStorage: unknown): asserts asyncStorage is AsyncStorageLike {
  if (
    !asyncStorage ||
    typeof (asyncStorage as AsyncStorageLike).getItem !== "function" ||
    typeof (asyncStorage as AsyncStorageLike).setItem !== "function"
  ) {
    throw new StorageError(
      "Invalid asyncStorage instance. createAsyncStorageAdapter() requires an object with getItem() and setItem() methods.",
    )
  }
}

function storageErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return "unknown error"
}

export function createAsyncStorageAdapter(options: AsyncStorageAdapterOptions): StorageAdapter {
  assertAsyncStorageLike(options.asyncStorage)

  const asyncStorage = options.asyncStorage
  const resolvedKey = `${options.prefix ?? ""}${options.key ?? DEFAULT_KEY}`

  return {
    async loadOperations(): Promise<SyncOperation[]> {
      let raw: string | null

      try {
        raw = await asyncStorage.getItem(resolvedKey)
      } catch (error) {
        throw new StorageError(`Failed to load operations from AsyncStorage key "${resolvedKey}": ${storageErrorMessage(error)}`)
      }

      if (raw === null) {
        return []
      }

      try {
        return JSON.parse(raw) as SyncOperation[]
      } catch {
        throw new StorageError(`Failed to parse stored operations from AsyncStorage key "${resolvedKey}"`)
      }
    },

    async saveOperations(operations: SyncOperation[]): Promise<void> {
      try {
        if (operations.length === 0 && typeof asyncStorage.removeItem === "function") {
          await asyncStorage.removeItem(resolvedKey)
          return
        }

        await asyncStorage.setItem(resolvedKey, JSON.stringify(operations))
      } catch (error) {
        throw new StorageError(`Failed to save operations to AsyncStorage key "${resolvedKey}": ${storageErrorMessage(error)}`)
      }
    },
  }
}

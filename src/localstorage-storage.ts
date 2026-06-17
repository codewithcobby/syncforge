import { StorageError } from "./errors.js"
import type { StorageAdapter, SyncOperation } from "./types.js"

const DEFAULT_KEY = "syncforge-queue"

const QUOTA_EXCEEDED_MESSAGE =
  "LocalStorage quota exceeded (~5MB limit). Consider compact(), reducing queue size, or switching to createIndexedDbStorage()."

export interface LocalStorageStorageOptions {
  /** localStorage key; default `"syncforge-queue"` */
  key?: string
  /**
   * Prepended to `key` for per-app isolation; default `""`.
   * Include any separator you want (e.g. `"my-app:"`) — SyncForge does not insert colons or dashes.
   */
  prefix?: string
}

function assertLocalStorageAvailable(): void {
  if (typeof globalThis.localStorage === "undefined") {
    throw new StorageError(
      "localStorage is not available in this environment. createLocalStorageStorage() requires a browser with localStorage support.",
    )
  }
}

function isQuotaExceededError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === "QuotaExceededError" || error.code === 22
  }
  return (error as { name?: string }).name === "QuotaExceededError"
}

function storageErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return "unknown error"
}

export function createLocalStorageStorage(options: LocalStorageStorageOptions = {}): StorageAdapter {
  assertLocalStorageAvailable()

  const resolvedKey = `${options.prefix ?? ""}${options.key ?? DEFAULT_KEY}`
  const storage = globalThis.localStorage

  return {
    async loadOperations(): Promise<SyncOperation[]> {
      const raw = storage.getItem(resolvedKey)

      if (raw === null) {
        return []
      }

      try {
        return JSON.parse(raw) as SyncOperation[]
      } catch {
        throw new StorageError(`Failed to parse stored operations from localStorage key "${resolvedKey}"`)
      }
    },

    async saveOperations(operations: SyncOperation[]): Promise<void> {
      try {
        storage.setItem(resolvedKey, JSON.stringify(operations))
      } catch (error) {
        if (isQuotaExceededError(error)) {
          throw new StorageError(QUOTA_EXCEEDED_MESSAGE)
        }
        throw new StorageError(`Failed to save operations to localStorage key "${resolvedKey}": ${storageErrorMessage(error)}`)
      }
    },
  }
}

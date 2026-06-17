import { StorageError } from "./errors.js"
import type { StorageAdapter, SyncOperation } from "./types.js"

const DEFAULT_KEY = "syncforge-queue"

/**
 * Minimal subset of Capacitor Preferences used by SyncForge.
 * Additional methods on the injected object (configure, clear, keys, migrate, etc.) are ignored.
 */
export interface PreferencesLike {
  get(options: { key: string }): Promise<{ value: string | null }>
  set(options: { key: string; value: string }): Promise<void>
  /** When present, used to clear the key when the queue becomes empty */
  remove?(options: { key: string }): Promise<void>
}

export interface CapacitorStorageAdapterOptions {
  /** Required — inject the app's Capacitor Preferences instance */
  preferences: PreferencesLike
  /** Storage key; default `"syncforge-queue"` */
  key?: string
  /**
   * Prepended to `key` for per-app isolation; default `""`.
   * Include any separator you want (e.g. `"my-app:"`) — SyncForge does not insert colons or dashes.
   */
  prefix?: string
}

function assertPreferencesLike(preferences: unknown): asserts preferences is PreferencesLike {
  if (
    !preferences ||
    typeof (preferences as PreferencesLike).get !== "function" ||
    typeof (preferences as PreferencesLike).set !== "function"
  ) {
    throw new StorageError(
      "Invalid preferences instance. createCapacitorStorageAdapter() requires an object with get() and set() methods.",
    )
  }
}

function storageErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return "unknown error"
}

export function createCapacitorStorageAdapter(
  options: CapacitorStorageAdapterOptions,
): StorageAdapter {
  assertPreferencesLike(options.preferences)

  const preferences = options.preferences
  const resolvedKey = `${options.prefix ?? ""}${options.key ?? DEFAULT_KEY}`

  return {
    async loadOperations(): Promise<SyncOperation[]> {
      let raw: string | null

      try {
        const result = await preferences.get({ key: resolvedKey })
        raw = result.value
      } catch (error) {
        throw new StorageError(
          `Failed to load operations from Capacitor Preferences key "${resolvedKey}": ${storageErrorMessage(error)}`,
        )
      }

      if (raw === null) {
        return []
      }

      try {
        return JSON.parse(raw) as SyncOperation[]
      } catch {
        throw new StorageError(
          `Failed to parse stored operations from Capacitor Preferences key "${resolvedKey}"`,
        )
      }
    },

    async saveOperations(operations: SyncOperation[]): Promise<void> {
      try {
        if (operations.length === 0 && typeof preferences.remove === "function") {
          await preferences.remove({ key: resolvedKey })
          return
        }

        await preferences.set({ key: resolvedKey, value: JSON.stringify(operations) })
      } catch (error) {
        throw new StorageError(
          `Failed to save operations to Capacitor Preferences key "${resolvedKey}": ${storageErrorMessage(error)}`,
        )
      }
    },
  }
}

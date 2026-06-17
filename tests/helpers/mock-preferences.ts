import type { PreferencesLike } from "../../src/capacitor-storage-adapter.js"

export function createMockPreferences(): PreferencesLike {
  const map = new Map<string, string>()

  return {
    async get(options: { key: string }) {
      return { value: map.has(options.key) ? map.get(options.key)! : null }
    },

    async set(options: { key: string; value: string }) {
      map.set(options.key, options.value)
    },

    async remove(options: { key: string }) {
      map.delete(options.key)
    },
  }
}

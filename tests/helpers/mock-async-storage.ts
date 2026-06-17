import type { AsyncStorageLike } from "../../src/asyncstorage-adapter.js"

export function createMockAsyncStorage(): AsyncStorageLike {
  const map = new Map<string, string>()

  return {
    async getItem(key: string) {
      return map.has(key) ? map.get(key)! : null
    },

    async setItem(key: string, value: string) {
      map.set(key, value)
    },

    async removeItem(key: string) {
      map.delete(key)
    },
  }
}

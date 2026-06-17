export function createMockLocalStorage(): Storage {
  const map = new Map<string, string>()

  return {
    get length() {
      return map.size
    },

    clear() {
      map.clear()
    },

    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null
    },

    key(index: number) {
      return [...map.keys()][index] ?? null
    },

    removeItem(key: string) {
      map.delete(key)
    },

    setItem(key: string, value: string) {
      map.set(key, value)
    },
  }
}

export function installMockLocalStorage(): Storage {
  const mock = createMockLocalStorage()
  globalThis.localStorage = mock
  return mock
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createMemoryStorage, createSyncEngine, type SyncOperation, type TransportAdapter } from "../src/index.js"

class MockTransport implements TransportAdapter {
  sent: SyncOperation[] = []

  async send(operation: SyncOperation): Promise<void> {
    this.sent.push({ ...operation })
  }
}

class SlowTransport implements TransportAdapter {
  sent: SyncOperation[] = []

  async send(operation: SyncOperation): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 50))
    this.sent.push({ ...operation })
  }
}

type Listener = () => void

function createWindowMock() {
  const listeners = new Map<string, Set<Listener>>()

  return {
    listeners,
    addEventListener(type: string, listener: Listener) {
      if (!listeners.has(type)) {
        listeners.set(type, new Set())
      }
      listeners.get(type)!.add(listener)
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.get(type)?.delete(listener)
    },
    dispatchOnline() {
      listeners.get("online")?.forEach((listener) => listener())
    },
    hasOnlineListener() {
      return (listeners.get("online")?.size ?? 0) > 0
    },
    onlineListenerCount() {
      return listeners.get("online")?.size ?? 0
    },
  }
}

describe("autoSync on reconnect", () => {
  const originalWindow = globalThis.window

  beforeEach(() => {
    vi.stubGlobal("window", createWindowMock())
  })

  afterEach(() => {
    vi.stubGlobal("window", originalWindow)
  })

  it("registers an online listener by default in browser environments", () => {
    createSyncEngine({ transport: new MockTransport() })

    expect(window.onlineListenerCount()).toBe(1)
  })

  it("does not register an online listener when autoSync is false", () => {
    createSyncEngine({
      transport: new MockTransport(),
      autoSync: false,
    })

    expect(window.hasOnlineListener()).toBe(false)
  })

  it("flushes pending operations when online fires without manual flush", async () => {
    const transport = new MockTransport()
    const sync = createSyncEngine({ transport })

    await sync.mutate("createOrder", { id: 1 })
    window.dispatchOnline()
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1))

    expect(transport.sent[0]?.payload).toEqual({ id: 1 })
  })

  it("deduplicates rapid online events via activeFlush", async () => {
    const transport = new MockTransport()
    const sync = createSyncEngine({ transport })

    await sync.mutate("createOrder", { id: 1 })
    window.dispatchOnline()
    window.dispatchOnline()
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
  })

  it("deduplicates online event while manual flush is already running", async () => {
    const transport = new SlowTransport()
    const sync = createSyncEngine({ transport })

    await sync.mutate("createOrder", { id: 1 })

    const flushPromise = sync.flush()
    window.dispatchOnline()
    await flushPromise

    expect(transport.sent).toHaveLength(1)
  })

  it("removes the online listener on destroy", async () => {
    const transport = new MockTransport()
    const sync = createSyncEngine({ transport })

    expect(window.hasOnlineListener()).toBe(true)

    await sync.destroy()

    expect(window.hasOnlineListener()).toBe(false)

    await sync.mutate("createOrder", { id: 1 })
    window.dispatchOnline()
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(transport.sent).toHaveLength(0)
  })

  it("does not throw on online when transport is missing", () => {
    const sync = createSyncEngine()

    expect(() => window.dispatchOnline()).not.toThrow()
    expect(sync).toBeDefined()
  })

  it("still supports manual flush when autoSync is enabled", async () => {
    const transport = new MockTransport()
    const sync = createSyncEngine({ transport })

    await sync.mutate("createOrder", { id: 1 })
    const result = await sync.flush()

    expect(result).toEqual({ successful: 1, failed: 0 })
    expect(transport.sent).toHaveLength(1)
  })
})

describe("autoSync in Node", () => {
  const originalWindow = globalThis.window

  afterEach(() => {
    vi.stubGlobal("window", originalWindow)
  })

  it("does not register a listener when window is unavailable", () => {
    // @ts-expect-error — simulate Node/SSR
    vi.stubGlobal("window", undefined)

    expect(() =>
      createSyncEngine({
        transport: new MockTransport(),
        storage: createMemoryStorage(),
      }),
    ).not.toThrow()
  })
})

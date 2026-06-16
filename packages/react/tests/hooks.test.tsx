import { render, waitFor, act } from "@testing-library/react"
import { useEffect } from "react"
import { describe, expect, it, vi } from "vitest"
import {
  createMemoryStorage,
  createSyncEngine,
  SyncEventTypes,
  type SyncEvent,
  type SyncOperation,
  type TransportAdapter,
} from "syncforge"
import { SyncForgeProvider } from "../src/provider.js"
import { useSyncEngine } from "../src/hooks/useSyncEngine.js"
import { useSyncFlush } from "../src/hooks/useSyncFlush.js"
import { useSyncStatus } from "../src/hooks/useSyncStatus.js"

class MockTransport implements TransportAdapter {
  sent: SyncOperation[] = []

  async send(operation: SyncOperation): Promise<void> {
    this.sent.push({ ...operation })
  }
}

class FailingTransport implements TransportAdapter {
  attempts = 0

  async send(): Promise<void> {
    this.attempts += 1
    throw new Error("network error")
  }
}

class SlowTransport implements TransportAdapter {
  async send(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

function OutsideProviderProbe() {
  useSyncEngine()
  return null
}

function EngineProbe({ onEngine }: { onEngine: (engine: ReturnType<typeof useSyncEngine>) => void }) {
  const engine = useSyncEngine()
  onEngine(engine)
  return null
}

function StatusProbe() {
  const status = useSyncStatus()
  return (
    <div>
      <span data-testid="pending">{status.pendingCount}</span>
      <span data-testid="syncing">{status.isSyncing ? "yes" : "no"}</span>
      <span data-testid="error">{status.lastError ? status.lastError.operation.type : "none"}</span>
    </div>
  )
}

function FlushProbe({ onFlush }: { onFlush: (flush: ReturnType<typeof useSyncFlush>) => void }) {
  const flush = useSyncFlush()
  onFlush(flush)
  return null
}

describe("useSyncEngine", () => {
  it("throws outside provider", () => {
    expect(() => render(<OutsideProviderProbe />)).toThrow(
      "SyncForge hooks must be used within a SyncForgeProvider",
    )
  })

  it("returns the same engine reference passed to the provider", () => {
    const engine = createSyncEngine({ storage: createMemoryStorage() })
    const originalFlush = engine.flush
    let received: ReturnType<typeof useSyncEngine> | null = null

    render(
      <SyncForgeProvider engine={engine}>
        <EngineProbe onEngine={(value) => { received = value }} />
      </SyncForgeProvider>,
    )

    expect(received).toBe(engine)
    expect(received?.flush).toBe(originalFlush)
  })
})

describe("useSyncFlush", () => {
  it("tracks manual flush without replacing engine.flush", async () => {
    const transport = new SlowTransport()
    const engine = createSyncEngine({ transport, storage: createMemoryStorage() })
    const originalFlush = engine.flush
    let trackedFlush: ReturnType<typeof useSyncFlush> | null = null

    const view = render(
      <SyncForgeProvider engine={engine}>
        <FlushProbe onFlush={(value) => { trackedFlush = value }} />
        <StatusProbe />
      </SyncForgeProvider>,
    )

    expect(trackedFlush).not.toBeNull()
    expect(engine.flush).toBe(originalFlush)

    await act(async () => {
      await engine.mutate("createOrder", { id: 1 })
    })

    await waitFor(() => {
      expect(view.getByTestId("pending").textContent).toBe("1")
    })

    let flushPromise: Promise<unknown> | null = null
    await act(async () => {
      flushPromise = trackedFlush!()
    })

    await waitFor(() => {
      expect(view.getByTestId("syncing").textContent).toBe("yes")
    })

    await act(async () => {
      await flushPromise
    })

    await waitFor(() => {
      expect(view.getByTestId("syncing").textContent).toBe("no")
      expect(view.getByTestId("pending").textContent).toBe("0")
    })
  })
})

describe("useSyncStatus", () => {
  it("starts with empty status", () => {
    const engine = createSyncEngine({ storage: createMemoryStorage() })
    const view = render(
      <SyncForgeProvider engine={engine}>
        <StatusProbe />
      </SyncForgeProvider>,
    )

    expect(view.getByTestId("pending").textContent).toBe("0")
    expect(view.getByTestId("syncing").textContent).toBe("no")
    expect(view.getByTestId("error").textContent).toBe("none")
  })

  it("updates pendingCount after mutate", async () => {
    const engine = createSyncEngine({ storage: createMemoryStorage() })
    const view = render(
      <SyncForgeProvider engine={engine}>
        <StatusProbe />
      </SyncForgeProvider>,
    )

    await act(async () => {
      await engine.mutate("createOrder", { id: 1 })
    })

    await waitFor(() => {
      expect(view.getByTestId("pending").textContent).toBe("1")
    })
  })

  it("updates during raw engine.flush via lifecycle events", async () => {
    const transport = new SlowTransport()
    const engine = createSyncEngine({ transport, storage: createMemoryStorage() })
    const view = render(
      <SyncForgeProvider engine={engine}>
        <StatusProbe />
      </SyncForgeProvider>,
    )

    await act(async () => {
      await engine.mutate("createOrder", { id: 1 })
    })

    let flushPromise: Promise<unknown> | null = null
    await act(async () => {
      flushPromise = engine.flush()
    })

    await waitFor(() => {
      expect(view.getByTestId("syncing").textContent).toBe("yes")
    })

    await act(async () => {
      await flushPromise
    })

    await waitFor(() => {
      expect(view.getByTestId("syncing").textContent).toBe("no")
      expect(view.getByTestId("pending").textContent).toBe("0")
    })
  })

  it("clears isSyncing after a failed flush with retries remaining", async () => {
    const transport = new FailingTransport()
    const engine = createSyncEngine({
      transport,
      storage: createMemoryStorage(),
      maxRetries: 3,
    })

    const view = render(
      <SyncForgeProvider engine={engine}>
        <StatusProbe />
      </SyncForgeProvider>,
    )

    await act(async () => {
      await engine.mutate("createOrder", { id: 1 })
      await engine.flush()
    })

    await waitFor(() => {
      expect(view.getByTestId("syncing").textContent).toBe("no")
      expect(view.getByTestId("pending").textContent).toBe("1")
    })
  })

  it("records lastError after max retries", async () => {
    const transport = new FailingTransport()
    const engine = createSyncEngine({
      transport,
      storage: createMemoryStorage(),
      maxRetries: 2,
    })

    const view = render(
      <SyncForgeProvider engine={engine}>
        <StatusProbe />
      </SyncForgeProvider>,
    )

    await act(async () => {
      await engine.mutate("createOrder", { id: 1 })
      await engine.flush()
      await engine.flush()
    })

    await waitFor(() => {
      expect(view.getByTestId("error").textContent).toBe("createOrder")
      expect(view.getByTestId("pending").textContent).toBe("0")
      expect(view.getByTestId("syncing").textContent).toBe("no")
    })
  })

  it("removes listeners on unmount without modifying engine.flush", () => {
    const engine = createSyncEngine({ storage: createMemoryStorage() })
    const originalFlush = engine.flush
    const onSpy = vi.spyOn(engine, "on")
    const offSpy = vi.spyOn(engine, "off")

    const { unmount } = render(
      <SyncForgeProvider engine={engine}>
        <StatusProbe />
      </SyncForgeProvider>,
    )

    expect(onSpy).toHaveBeenCalled()
    unmount()
    expect(offSpy).toHaveBeenCalled()
    expect(engine.flush).toBe(originalFlush)
  })
})

describe("optimistic events", () => {
  function OptimisticListenerProbe({
    onOptimistic,
  }: {
    onOptimistic: (event: SyncEvent) => void
  }) {
    const engine = useSyncEngine()

    useEffect(() => {
      const listener = (event: SyncEvent) => onOptimistic(event)
      engine.on(SyncEventTypes.Optimistic, listener)
      return () => {
        engine.off(SyncEventTypes.Optimistic, listener)
      }
    }, [engine, onOptimistic])

    return null
  }

  it("fires optimistic listeners from useSyncEngine", async () => {
    const engine = createSyncEngine({
      storage: createMemoryStorage(),
      context: { orders: [] as Array<{ id: string }> },
      optimisticHandlers: {
        createOrder: {
          apply(operation, ctx) {
            const payload = operation.payload as { id: string }
            ctx.orders.push(payload)
          },
          rollback() {},
        },
      },
    })

    const optimisticEvents: SyncEvent[] = []
    const onOptimistic = vi.fn((event: SyncEvent) => {
      optimisticEvents.push(event)
    })

    render(
      <SyncForgeProvider engine={engine}>
        <OptimisticListenerProbe onOptimistic={onOptimistic} />
      </SyncForgeProvider>,
    )

    await act(async () => {
      await engine.mutate("createOrder", { id: "1" })
    })

    await waitFor(() => {
      expect(onOptimistic).toHaveBeenCalledTimes(1)
      expect(optimisticEvents[0]?.type).toBe(SyncEventTypes.Optimistic)
    })
  })

  it("does not add revision to useSyncStatus", async () => {
    const engine = createSyncEngine({
      storage: createMemoryStorage(),
      context: {},
      optimisticHandlers: {
        createOrder: {
          apply() {},
          rollback() {},
        },
      },
    })

    let statusSnapshot: ReturnType<typeof useSyncStatus> | null = null

    function StatusShapeProbe() {
      statusSnapshot = useSyncStatus()
      return null
    }

    render(
      <SyncForgeProvider engine={engine}>
        <StatusShapeProbe />
      </SyncForgeProvider>,
    )

    expect(statusSnapshot).not.toBeNull()
    expect("revision" in statusSnapshot!).toBe(false)

    await act(async () => {
      await engine.mutate("createOrder", { id: "1" })
    })

    await waitFor(() => {
      expect(statusSnapshot?.pendingCount).toBe(1)
      expect("revision" in statusSnapshot!).toBe(false)
    })
  })

  it("removes optimistic listeners on unmount", () => {
    const engine = createSyncEngine({ storage: createMemoryStorage() })
    const onSpy = vi.spyOn(engine, "on")
    const offSpy = vi.spyOn(engine, "off")
    const onOptimistic = vi.fn()

    const { unmount } = render(
      <SyncForgeProvider engine={engine}>
        <OptimisticListenerProbe onOptimistic={onOptimistic} />
      </SyncForgeProvider>,
    )

    expect(onSpy).toHaveBeenCalledWith(SyncEventTypes.Optimistic, expect.any(Function))

    unmount()

    expect(offSpy).toHaveBeenCalledWith(SyncEventTypes.Optimistic, expect.any(Function))
  })
})

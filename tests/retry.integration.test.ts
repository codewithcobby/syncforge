import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createSyncEngine,
  exponentialBackoffRetryStrategy,
  linearBackoffRetryStrategy,
  type TransportAdapter,
} from "../src/index.js"

class FailingTransport implements TransportAdapter {
  attempts = 0

  async send(): Promise<void> {
    this.attempts += 1
    throw new Error("network error")
  }
}

describe("retry strategies (integration)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("exponential backoff delays inside flush until timers advance", async () => {
    const transport = new FailingTransport()
    const sync = createSyncEngine({
      transport,
      retry: exponentialBackoffRetryStrategy({
        baseDelayMs: 1_000,
        factor: 2,
        jitter: false,
      }),
      maxRetries: 5,
    })

    await sync.mutate("createOrder", { id: 1 })

    const firstFlush = sync.flush()
    await vi.advanceTimersByTimeAsync(0)

    expect(transport.attempts).toBe(1)

    let firstFlushSettled = false
    void firstFlush.then(() => {
      firstFlushSettled = true
    })

    await vi.advanceTimersByTimeAsync(1_999)
    expect(firstFlushSettled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await firstFlush
    expect(firstFlushSettled).toBe(true)
    expect(transport.attempts).toBe(1)

    const secondFlush = sync.flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(transport.attempts).toBe(2)

    await vi.advanceTimersByTimeAsync(4_000)
    await secondFlush
  })

  it("linear backoff delays inside flush until timers advance", async () => {
    const transport = new FailingTransport()
    const sync = createSyncEngine({
      transport,
      retry: linearBackoffRetryStrategy({ baseDelayMs: 1_000 }),
      maxRetries: 5,
    })

    await sync.mutate("createOrder", { id: 1 })

    const firstFlush = sync.flush()
    await vi.advanceTimersByTimeAsync(0)

    expect(transport.attempts).toBe(1)

    let firstFlushSettled = false
    void firstFlush.then(() => {
      firstFlushSettled = true
    })

    await vi.advanceTimersByTimeAsync(999)
    expect(firstFlushSettled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await firstFlush
    expect(firstFlushSettled).toBe(true)
    expect(transport.attempts).toBe(1)

    const secondFlush = sync.flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(transport.attempts).toBe(2)

    await vi.advanceTimersByTimeAsync(2_000)
    await secondFlush
  })
})

import { describe, expect, it, vi } from "vitest"
import {
  exponentialBackoffRetryStrategy,
  immediateRetryStrategy,
  linearBackoffRetryStrategy,
} from "../src/index.js"

describe("immediateRetryStrategy", () => {
  it("returns 0 for any attempt", () => {
    expect(immediateRetryStrategy.getDelay(0)).toBe(0)
    expect(immediateRetryStrategy.getDelay(1)).toBe(0)
    expect(immediateRetryStrategy.getDelay(99)).toBe(0)
  })
})

describe("exponentialBackoffRetryStrategy", () => {
  it("uses defaults: getDelay(0) is base, then base * factor^attempt", () => {
    const retry = exponentialBackoffRetryStrategy()

    expect(retry.getDelay(0)).toBe(1_000)
    expect(retry.getDelay(1)).toBe(2_000)
    expect(retry.getDelay(2)).toBe(4_000)
    expect(retry.getDelay(3)).toBe(8_000)
  })

  it("respects custom base, factor, and maxDelayMs", () => {
    const retry = exponentialBackoffRetryStrategy({
      baseDelayMs: 500,
      factor: 3,
      maxDelayMs: 2_000,
    })

    expect(retry.getDelay(0)).toBe(500)
    expect(retry.getDelay(1)).toBe(1_500)
    expect(retry.getDelay(2)).toBe(2_000)
    expect(retry.getDelay(3)).toBe(2_000)
  })

  it("applies 50%–100% jitter when enabled", () => {
    const randomSpy = vi.spyOn(Math, "random")

    try {
      randomSpy.mockReturnValueOnce(0)
      const retry = exponentialBackoffRetryStrategy({ baseDelayMs: 1_000, jitter: true })
      expect(retry.getDelay(1)).toBe(1_000)

      randomSpy.mockReturnValueOnce(1)
      expect(retry.getDelay(1)).toBe(2_000)

      randomSpy.mockReturnValueOnce(0.5)
      expect(retry.getDelay(1)).toBe(1_500)
    } finally {
      randomSpy.mockRestore()
    }
  })
})

describe("linearBackoffRetryStrategy", () => {
  it("returns base * attempt with defaults", () => {
    const retry = linearBackoffRetryStrategy()

    expect(retry.getDelay(0)).toBe(0)
    expect(retry.getDelay(1)).toBe(1_000)
    expect(retry.getDelay(2)).toBe(2_000)
    expect(retry.getDelay(3)).toBe(3_000)
  })

  it("caps delay at maxDelayMs", () => {
    const retry = linearBackoffRetryStrategy({
      baseDelayMs: 1_000,
      maxDelayMs: 2_500,
    })

    expect(retry.getDelay(2)).toBe(2_000)
    expect(retry.getDelay(3)).toBe(2_500)
    expect(retry.getDelay(10)).toBe(2_500)
  })
})

import "fake-indexeddb/auto"
import { describe, expect, it } from "vitest"
import {
  createIndexedDbStorage,
  createSyncEngine,
  SyncOperationStatuses,
} from "../src/index.js"
import {
  buildMixedQueue,
  buildOperations,
  createInstrumentedStorage,
  createJsonStorage,
  PAYLOAD_PRESETS,
  seedStorage,
  timeAsync,
} from "./helpers/queue-scale.js"
import { MockTransport } from "./helpers/transports.js"

const CI_SCALE = 1_000
const MIXED_PENDING = 50

describe("large queue smoke @ci", () => {
  it(
    "hydrates a pre-seeded 1k queue and inspect() counts match",
    async () => {
      const storage = createJsonStorage()
      await seedStorage(
        storage,
        buildMixedQueue({
          total: CI_SCALE,
          pending: MIXED_PENDING,
          failed: 10,
          payloadBytes: PAYLOAD_PRESETS.realistic,
        }),
      )

      const sync = createSyncEngine({ storage })
      const snapshot = await sync.inspect()

      expect(snapshot.total).toBe(CI_SCALE)
      expect(snapshot.pending).toBe(MIXED_PENDING)
      expect(snapshot.failed).toBe(10)
      expect(snapshot.completed).toBe(CI_SCALE - MIXED_PENDING - 10)
    },
    30_000,
  )

  it(
    "flushes a mixed 1k queue (small pending subset)",
    async () => {
      const storage = createInstrumentedStorage(createJsonStorage())
      await seedStorage(
        storage,
        buildMixedQueue({
          total: CI_SCALE,
          pending: MIXED_PENDING,
          payloadBytes: PAYLOAD_PRESETS.realistic,
        }),
      )

      const transport = new MockTransport()
      const sync = createSyncEngine({ storage, transport })
      storage.resetSaveOperationsCallCount()

      const result = await sync.flush()

      expect(result.successful).toBe(MIXED_PENDING)
      expect(transport.sent).toHaveLength(MIXED_PENDING)
      expect(storage.saveOperationsCallCount).toBeGreaterThan(MIXED_PENDING)
      const snapshot = await sync.inspect()
      expect(snapshot.pending).toBe(0)
      expect(snapshot.completed).toBe(CI_SCALE)
    },
    30_000,
  )

  it(
    "compact() removes completed backlog and reload preserves pending/failed",
    async () => {
      const storage = createJsonStorage()
      await seedStorage(
        storage,
        buildMixedQueue({
          total: CI_SCALE,
          pending: 5,
          failed: 3,
          payloadBytes: PAYLOAD_PRESETS.realistic,
        }),
      )

      const sync = createSyncEngine({ storage })
      const removed = await sync.compact()

      expect(removed).toBe(CI_SCALE - 8)

      const reloaded = createSyncEngine({ storage })
      const snapshot = await reloaded.inspect()

      expect(snapshot.total).toBe(8)
      expect(snapshot.pending).toBe(5)
      expect(snapshot.failed).toBe(3)
      expect(snapshot.completed).toBe(0)
    },
    30_000,
  )

  it(
    "mutate() succeeds on a hydrated 1k queue",
    async () => {
      const storage = createJsonStorage()
      await seedStorage(
        storage,
        buildOperations(CI_SCALE, SyncOperationStatuses.Completed, {
          payloadBytes: PAYLOAD_PRESETS.realistic,
        }),
      )

      const sync = createSyncEngine({ storage })
      await sync.inspect()

      const operation = await sync.mutate("benchmark.mutate", {
        data: "x".repeat(PAYLOAD_PRESETS.realistic),
      })

      expect(operation.status).toBe(SyncOperationStatuses.Pending)
      const snapshot = await sync.inspect()
      expect(snapshot.total).toBe(CI_SCALE + 1)
      expect(snapshot.pending).toBe(1)
    },
    30_000,
  )

  it(
    "indexeddb adapter hydrates and flushes a 1k mixed queue",
    async () => {
      const storage = createIndexedDbStorage({
        dbName: `syncforge-large-queue-smoke-${Date.now()}`,
        storeName: "operations",
      })
      await seedStorage(
        storage,
        buildMixedQueue({
          total: CI_SCALE,
          pending: MIXED_PENDING,
          payloadBytes: PAYLOAD_PRESETS.minimal,
        }),
      )

      const transport = new MockTransport()
      const sync = createSyncEngine({ storage, transport })
      const before = await sync.inspect()
      expect(before.pending).toBe(MIXED_PENDING)

      const result = await sync.flush()
      expect(result.successful).toBe(MIXED_PENDING)
    },
    30_000,
  )
})

describe.skipIf(!process.env.STRESS)("large queue stress @stress", () => {
  const tiers = process.env.STRESS_N
    ? [Number.parseInt(process.env.STRESS_N, 10)]
    : [1_000, 10_000]

  for (const tier of tiers) {
    it(
      `records flush write amplification at tier ${tier}`,
      async () => {
        const pending = tier >= 10_000 ? 500 : 50
        const storage = createInstrumentedStorage(createJsonStorage())
        await seedStorage(
          storage,
          buildMixedQueue({
            total: tier,
            pending,
            payloadBytes: PAYLOAD_PRESETS.realistic,
          }),
        )

        const transport = new MockTransport()
        const sync = createSyncEngine({ storage, transport })
        storage.resetSaveOperationsCallCount()

        const { ms, result } = await timeAsync(() => sync.flush())

        expect(result.successful).toBe(pending)
        expect(storage.saveOperationsCallCount).toBeGreaterThanOrEqual(pending * 2)

        console.log(
          `[stress] tier=${tier} pending=${pending} flushMs=${ms.toFixed(1)} saveOps=${storage.saveOperationsCallCount}`,
        )
      },
      300_000,
    )

    it(
      `hydrates tier ${tier} within stress window`,
      async () => {
        const storage = createJsonStorage()
        await seedStorage(
          storage,
          buildOperations(tier, SyncOperationStatuses.Completed, {
            payloadBytes: PAYLOAD_PRESETS.realistic,
          }),
        )

        const sync = createSyncEngine({ storage })
        const { ms } = await timeAsync(() => sync.inspect())

        console.log(`[stress] tier=${tier} hydrateMs=${ms.toFixed(1)}`)
        expect(ms).toBeGreaterThan(0)
      },
      300_000,
    )
  }
})

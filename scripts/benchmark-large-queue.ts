import "fake-indexeddb/auto"
import { writeFileSync } from "node:fs"
import { createIndexedDbStorage, createSyncEngine, SyncOperationStatuses } from "../src/index.js"
import {
  buildMixedQueue,
  buildOperations,
  createInstrumentedStorage,
  createJsonStorage,
  measureHeapDelta,
  PAYLOAD_PRESETS,
  resolvePayloadBytes,
  resolveScaleTiers,
  seedStorage,
  timeAsync,
  type InstrumentedStorage,
} from "../tests/helpers/queue-scale.js"
import { MockTransport } from "../tests/helpers/transports.js"

type AdapterName = "json" | "indexeddb"

interface BenchmarkRow {
  adapter: AdapterName
  scenario: string
  tier: number
  payloadBytes: number
  ms: number
  saveOperationsCalls?: number
  heapBeforeMb?: number
  heapAfterMb?: number
  heapDeltaMb?: number
  notes?: string
}

function parseArgs(argv: string[]): { jsonPath?: string; payloadBytes: number } {
  let jsonPath: string | undefined
  let payloadBytes: number = PAYLOAD_PRESETS.realistic

  for (const arg of argv) {
    if (arg.startsWith("--json=")) {
      jsonPath = arg.slice("--json=".length)
      continue
    }
    if (arg.startsWith("--payload-bytes=")) {
      payloadBytes = Number.parseInt(arg.slice("--payload-bytes=".length), 10)
      continue
    }
    if (arg.startsWith("--payload=")) {
      const preset = arg.slice("--payload=".length) as keyof typeof PAYLOAD_PRESETS
      payloadBytes = resolvePayloadBytes(preset)
    }
  }

  return { jsonPath, payloadBytes }
}

function createAdapter(name: AdapterName, suffix: string): InstrumentedStorage {
  const base =
    name === "json"
      ? createJsonStorage()
      : createIndexedDbStorage({
          dbName: `syncforge-benchmark-${suffix}`,
          storeName: "operations",
        })

  return createInstrumentedStorage(base)
}

function formatMb(value: number | undefined): string {
  return value === undefined ? "—" : value.toFixed(1)
}

function printRows(rows: BenchmarkRow[]): void {
  console.log("\nSyncForge large-queue benchmark\n")
  console.log(
    [
      "adapter".padEnd(10),
      "scenario".padEnd(28),
      "tier".padStart(8),
      "payloadB".padStart(10),
      "ms".padStart(10),
      "saveOps".padStart(8),
      "heapΔMB".padStart(10),
      "notes",
    ].join(" "),
  )
  console.log("-".repeat(110))

  for (const row of rows) {
    console.log(
      [
        row.adapter.padEnd(10),
        row.scenario.padEnd(28),
        String(row.tier).padStart(8),
        String(row.payloadBytes).padStart(10),
        row.ms.toFixed(1).padStart(10),
        String(row.saveOperationsCalls ?? "—").padStart(8),
        formatMb(row.heapDeltaMb).padStart(10),
        row.notes ?? "",
      ].join(" "),
    )
  }
}

async function benchmarkHydrate(adapter: AdapterName, tier: number, payloadBytes: number, suffix: string): Promise<BenchmarkRow> {
  const storage = createAdapter(adapter, `${suffix}-hydrate`)
  await seedStorage(storage, buildOperations(tier, SyncOperationStatuses.Completed, { payloadBytes }))

  const { heap, result } = await measureHeapDelta(async () => {
    const sync = createSyncEngine({ storage })
    return timeAsync(() => sync.inspect())
  })

  return {
    adapter,
    scenario: "hydrate",
    tier,
    payloadBytes,
    ms: result.ms,
    heapBeforeMb: heap.beforeMb,
    heapAfterMb: heap.afterMb,
    heapDeltaMb: heap.deltaMb,
  }
}

async function benchmarkMutate(adapter: AdapterName, tier: number, payloadBytes: number, suffix: string): Promise<BenchmarkRow> {
  const storage = createAdapter(adapter, `${suffix}-mutate`)
  await seedStorage(storage, buildOperations(tier, SyncOperationStatuses.Completed, { payloadBytes }))

  const sync = createSyncEngine({ storage })
  await sync.inspect()

  const { ms } = await timeAsync(() => sync.mutate("benchmark.mutate", { data: "x".repeat(payloadBytes) }))

  return {
    adapter,
    scenario: "mutate",
    tier,
    payloadBytes,
    ms,
    saveOperationsCalls: storage.saveOperationsCallCount,
  }
}

async function benchmarkPersist(adapter: AdapterName, tier: number, payloadBytes: number, suffix: string): Promise<BenchmarkRow> {
  const storage = createAdapter(adapter, `${suffix}-persist`)
  const operations = buildOperations(tier, SyncOperationStatuses.Completed, { payloadBytes })

  const { ms } = await timeAsync(() => storage.saveOperations(operations))

  return {
    adapter,
    scenario: "persist",
    tier,
    payloadBytes,
    ms,
    saveOperationsCalls: storage.saveOperationsCallCount,
  }
}

async function benchmarkCompact(adapter: AdapterName, tier: number, payloadBytes: number, suffix: string): Promise<BenchmarkRow> {
  const storage = createAdapter(adapter, `${suffix}-compact`)
  await seedStorage(storage, buildOperations(tier, SyncOperationStatuses.Completed, { payloadBytes }))

  const sync = createSyncEngine({ storage })
  storage.resetSaveOperationsCallCount()

  const { ms } = await timeAsync(() => sync.compact())

  return {
    adapter,
    scenario: "compact",
    tier,
    payloadBytes,
    ms,
    saveOperationsCalls: storage.saveOperationsCallCount,
  }
}

async function benchmarkPostCompactHydrate(
  adapter: AdapterName,
  tier: number,
  payloadBytes: number,
  suffix: string,
): Promise<BenchmarkRow> {
  const storage = createAdapter(adapter, `${suffix}-post-compact`)
  await seedStorage(storage, buildOperations(tier, SyncOperationStatuses.Completed, { payloadBytes }))

  const sync = createSyncEngine({ storage })
  await sync.compact()

  const { heap, result } = await measureHeapDelta(async () => {
    const reloaded = createSyncEngine({ storage })
    return timeAsync(() => reloaded.inspect())
  })

  return {
    adapter,
    scenario: "post-compact-hydrate",
    tier,
    payloadBytes,
    ms: result.ms,
    heapBeforeMb: heap.beforeMb,
    heapAfterMb: heap.afterMb,
    heapDeltaMb: heap.deltaMb,
  }
}

async function benchmarkScenarioA(
  adapter: AdapterName,
  tier: number,
  payloadBytes: number,
  suffix: string,
): Promise<BenchmarkRow[]> {
  const storage = createAdapter(adapter, `${suffix}-scenario-a`)
  await seedStorage(storage, buildOperations(tier, SyncOperationStatuses.Completed, { payloadBytes }))

  const sync = createSyncEngine({ storage })
  storage.resetSaveOperationsCallCount()

  const compact = await timeAsync(() => sync.compact())

  const hydrate = await measureHeapDelta(async () => {
    const reloaded = createSyncEngine({ storage })
    return timeAsync(() => reloaded.inspect())
  })

  return [
    {
      adapter,
      scenario: "A-completed-compact",
      tier,
      payloadBytes,
      ms: compact.ms,
      saveOperationsCalls: storage.saveOperationsCallCount,
      notes: `removed ${compact.result}`,
    },
    {
      adapter,
      scenario: "A-post-compact-hydrate",
      tier,
      payloadBytes,
      ms: hydrate.result.ms,
      heapBeforeMb: hydrate.heap.beforeMb,
      heapAfterMb: hydrate.heap.afterMb,
      heapDeltaMb: hydrate.heap.deltaMb,
    },
  ]
}

async function benchmarkScenarioB(
  adapter: AdapterName,
  total: number,
  pending: number,
  payloadBytes: number,
  suffix: string,
  scenario = "B-mixed-flush",
): Promise<BenchmarkRow> {
  const storage = createAdapter(adapter, `${suffix}-scenario-b`)
  await seedStorage(storage, buildMixedQueue({ total, pending, payloadBytes }))

  const transport = new MockTransport()
  const sync = createSyncEngine({ storage, transport })
  storage.resetSaveOperationsCallCount()

  const { ms, result } = await timeAsync(() => sync.flush())

  return {
    adapter,
    scenario,
    tier: total,
    payloadBytes,
    ms,
    saveOperationsCalls: storage.saveOperationsCallCount,
    notes: `pending=${pending} successful=${result.successful}`,
  }
}

async function benchmarkScenarioC(adapter: AdapterName, payloadBytes: number, suffix: string): Promise<BenchmarkRow> {
  return benchmarkScenarioB(adapter, 10_000, 50, payloadBytes, `${suffix}-scenario-c`, "C-mixed-flush")
}

async function run(): Promise<BenchmarkRow[]> {
  const { jsonPath, payloadBytes } = parseArgs(process.argv.slice(2))
  const tiers = resolveScaleTiers()
  const rows: BenchmarkRow[] = []
  const suffix = `${Date.now()}`

  for (const adapter of ["json", "indexeddb"] as const) {
    for (const tier of tiers) {
      rows.push(await benchmarkHydrate(adapter, tier, payloadBytes, suffix))
      rows.push(await benchmarkMutate(adapter, tier, payloadBytes, suffix))
      rows.push(await benchmarkPersist(adapter, tier, payloadBytes, suffix))
      rows.push(await benchmarkCompact(adapter, tier, payloadBytes, suffix))
      rows.push(await benchmarkPostCompactHydrate(adapter, tier, payloadBytes, suffix))
    }

    if (tiers.includes(100_000) || process.env.STRESS_N === "100000") {
      rows.push(...(await benchmarkScenarioA(adapter, 100_000, payloadBytes, suffix)))
      rows.push(await benchmarkScenarioB(adapter, 100_000, 500, payloadBytes, suffix))
    }

    rows.push(await benchmarkScenarioC(adapter, payloadBytes, suffix))
  }

  printRows(rows)

  const output = {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    payloadBytes,
    tiers,
    rows,
  }

  if (jsonPath) {
    writeFileSync(jsonPath, `${JSON.stringify(output, null, 2)}\n`)
    console.log(`\nWrote ${jsonPath}`)
  }

  return rows
}

run().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})

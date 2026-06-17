import { SyncOperationStatuses, type StorageAdapter, type SyncOperation, type SyncOperationStatus } from "../../src/index.js"

export const SCALE_TIERS = [1_000, 10_000, 100_000] as const

export const PAYLOAD_PRESETS = {
  minimal: 100,
  realistic: 1_024,
  large: 10_240,
} as const

export type PayloadPreset = keyof typeof PAYLOAD_PRESETS

export interface BuildOperationsOptions {
  payloadBytes?: number
  type?: string
}

export interface MixedQueueOptions {
  total: number
  pending?: number
  failed?: number
  payloadBytes?: number
}

function deterministicPayload(bytes: number): { data: string } {
  const fill = "x".repeat(Math.max(0, bytes - 20))
  return { data: fill }
}

export function resolvePayloadBytes(presetOrBytes?: PayloadPreset | number): number {
  if (presetOrBytes === undefined) {
    return PAYLOAD_PRESETS.realistic
  }
  if (typeof presetOrBytes === "number") {
    return presetOrBytes
  }
  return PAYLOAD_PRESETS[presetOrBytes]
}

export function buildOperations(
  count: number,
  status: SyncOperationStatus,
  options: BuildOperationsOptions = {},
): SyncOperation[] {
  const payloadBytes = options.payloadBytes ?? PAYLOAD_PRESETS.realistic
  const type = options.type ?? "benchmark.mutate"
  const payload = deterministicPayload(payloadBytes)
  const operations: SyncOperation[] = []

  for (let index = 0; index < count; index += 1) {
    operations.push({
      id: `op-${status}-${index}`,
      type,
      payload,
      status,
      retries: 0,
      createdAt: new Date(`2026-01-01T00:00:${String(index % 60).padStart(2, "0")}.000Z`),
    })
  }

  return operations
}

export function buildMixedQueue(options: MixedQueueOptions): SyncOperation[] {
  const { total, pending = 0, failed = 0, payloadBytes = PAYLOAD_PRESETS.realistic } = options
  const completed = total - pending - failed

  if (completed < 0) {
    throw new Error("pending + failed cannot exceed total")
  }

  return [
    ...buildOperations(pending, SyncOperationStatuses.Pending, { payloadBytes }),
    ...buildOperations(failed, SyncOperationStatuses.Failed, { payloadBytes }),
    ...buildOperations(completed, SyncOperationStatuses.Completed, { payloadBytes }),
  ]
}

export async function seedStorage(storage: StorageAdapter, operations: SyncOperation[]): Promise<void> {
  await storage.saveOperations(operations)
}

export function createJsonStorage(): StorageAdapter {
  let serialized = "[]"

  return {
    async loadOperations(): Promise<SyncOperation[]> {
      return JSON.parse(serialized) as SyncOperation[]
    },

    async saveOperations(operations: SyncOperation[]): Promise<void> {
      serialized = JSON.stringify(operations)
    },
  }
}

export interface InstrumentedStorage extends StorageAdapter {
  saveOperationsCallCount: number
  resetSaveOperationsCallCount(): void
}

export function createInstrumentedStorage(base: StorageAdapter): InstrumentedStorage {
  let saveOperationsCallCount = 0

  return {
    get saveOperationsCallCount() {
      return saveOperationsCallCount
    },

    resetSaveOperationsCallCount() {
      saveOperationsCallCount = 0
    },

    async loadOperations(): Promise<SyncOperation[]> {
      return base.loadOperations()
    },

    async saveOperations(operations: SyncOperation[]): Promise<void> {
      saveOperationsCallCount += 1
      await base.saveOperations(operations)
    },
  }
}

export async function timeAsync<T>(fn: () => Promise<T>): Promise<{ ms: number; result: T }> {
  const start = performance.now()
  const result = await fn()
  return { ms: performance.now() - start, result }
}

export interface HeapDelta {
  beforeMb: number
  afterMb: number
  deltaMb: number
}

function heapUsedMb(): number {
  return process.memoryUsage().heapUsed / (1024 * 1024)
}

export async function measureHeapDelta<T>(fn: () => Promise<T>): Promise<{ heap: HeapDelta; result: T }> {
  if (globalThis.gc) {
    globalThis.gc()
  }

  const beforeMb = heapUsedMb()
  const result = await fn()
  const afterMb = heapUsedMb()

  return {
    heap: {
      beforeMb,
      afterMb,
      deltaMb: afterMb - beforeMb,
    },
    result,
  }
}

export function resolveScaleTiers(): number[] {
  if (process.env.STRESS_N) {
    const n = Number.parseInt(process.env.STRESS_N, 10)
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`Invalid STRESS_N: ${process.env.STRESS_N}`)
    }
    return [n]
  }

  if (process.env.STRESS === "1") {
    return [1_000, 10_000]
  }

  return [1_000, 10_000]
}

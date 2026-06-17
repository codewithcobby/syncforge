import type { SyncEventListener, SyncEventType } from "./events.js"
import type { RetryStrategy } from "./retry.js"
import type { TransportAdapter } from "./transport.js"

export const SyncOperationStatuses = {
  Pending: "pending",
  Syncing: "syncing",
  Completed: "completed",
  Failed: "failed",
} as const

export type SyncOperationStatus = (typeof SyncOperationStatuses)[keyof typeof SyncOperationStatuses]

export interface SyncOperation<TPayload = unknown, TOptimisticData = unknown> {
  id: string
  type: string
  payload: TPayload
  status: SyncOperationStatus
  retries: number
  createdAt: Date
  optimisticData?: TOptimisticData
  lastError?: unknown
}

export type OptimisticApplyFn<TContext = unknown> = (
  operation: SyncOperation,
  context: TContext,
) => void | Promise<void>

export type OptimisticRollbackFn<TContext = unknown> = (
  operation: SyncOperation,
  error: unknown,
  context: TContext,
) => void | Promise<void>

export interface OptimisticHandler<TContext = unknown> {
  apply: OptimisticApplyFn<TContext>
  rollback: OptimisticRollbackFn<TContext>
}

export interface MutateOptions<TContext = unknown, TOptimisticData = unknown> {
  optimisticData?: TOptimisticData
  optimisticUpdate?: OptimisticApplyFn<TContext>
  rollback?: OptimisticRollbackFn<TContext>
}

export interface StorageAdapter {
  loadOperations(): Promise<SyncOperation[]>
  saveOperations(operations: SyncOperation[]): Promise<void>
}

export interface SyncEngineOptions<TContext = unknown> {
  transport?: TransportAdapter
  storage?: StorageAdapter
  retry?: RetryStrategy
  maxRetries?: number
  autoSync?: boolean
  context?: TContext
  optimisticHandlers?: Record<string, OptimisticHandler<TContext>>
}

export interface FlushResult {
  successful: number
  failed: number
}

export interface InspectOptions {
  /** When set, attach shallow copies of operations matching these statuses. Counts are always full-queue. */
  operations?: SyncOperationStatus[]
}

export interface InspectSnapshot {
  pending: number
  failed: number
  completed: number
  syncing: number
  total: number
  /** True when any operation has status "syncing". */
  isSyncing: boolean
  /** Present only when `options.operations` is non-empty. Shallow copies — mutating does not affect the queue. */
  operations?: SyncOperation[]
}

export interface MetricsSnapshot {
  /** New operations enqueued via `mutate()` this session (not `retry()` re-queues). */
  totalQueued: number
  /** Operations that reached `operation:succeeded` this session. */
  totalSucceeded: number
  /** Operations that reached terminal `operation:failed` this session. */
  totalFailed: number
  /** Transport failures this session (each failed send attempt; see README). */
  totalRetried: number
  /** `totalRetried / totalSucceeded` when `totalSucceeded > 0`, else `0`. */
  averageRetries: number
  /** When the last `flush()` batch completed with at least one success; `null` if none yet. */
  lastSuccessfulFlushAt: Date | null
}

export interface SyncEngine {
  mutate<TPayload = unknown, TOptimisticData = unknown>(
    type: string,
    payload: TPayload,
    options?: MutateOptions<unknown, TOptimisticData>,
  ): Promise<SyncOperation<TPayload, TOptimisticData>>
  getPending<T = unknown>(): Promise<SyncOperation<T>[]>
  getFailed<T = unknown>(): Promise<SyncOperation<T>[]>
  retry(id: string): Promise<boolean>
  retryAllFailed(): Promise<number>
  compact(): Promise<number>
  inspect(options?: InspectOptions): Promise<InspectSnapshot>
  getMetrics(): MetricsSnapshot
  remove(id: string): Promise<boolean>
  clear(): Promise<void>
  flush(): Promise<FlushResult>
  destroy(): Promise<void>
  on(type: SyncEventType, listener: SyncEventListener): void
  off(type: SyncEventType, listener: SyncEventListener): void
}

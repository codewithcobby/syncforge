import { createEventEmitter, SyncEventTypes, type SyncEventType } from "./events.js"
import { TransportError } from "./errors.js"
import {
  computeFailureRate,
  computeOldestPendingAgeMs,
  computeStorageBytesEstimate,
  evaluateHealth,
  mergeHealthThresholds,
} from "./health.js"
import { hasHandlers, resolveHandlers, type MergedOptimisticHandlers } from "./optimistic.js"
import { immediateRetryStrategy } from "./retry.js"
import { reviveOperations } from "./serialize.js"
import { createMemoryStorage } from "./storage.js"
import { nanoid } from "nanoid"
import {
  SyncOperationStatuses,
  type FlushResult,
  type HealthOptions,
  type HealthSnapshot,
  type InspectOptions,
  type InspectSnapshot,
  type MetricsSnapshot,
  type MutateOptions,
  type SyncEngine,
  type SyncEngineOptions,
  type SyncOperation,
} from "./types.js"

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function isBrowser(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function"
  )
}

interface InspectCounts {
  pending: number
  failed: number
  completed: number
  syncing: number
  total: number
}

function buildInspectCounts(operations: SyncOperation[]): InspectCounts {
  let pending = 0
  let failed = 0
  let completed = 0
  let syncing = 0

  for (const operation of operations) {
    switch (operation.status) {
      case SyncOperationStatuses.Pending:
        pending += 1
        break
      case SyncOperationStatuses.Failed:
        failed += 1
        break
      case SyncOperationStatuses.Completed:
        completed += 1
        break
      case SyncOperationStatuses.Syncing:
        syncing += 1
        break
    }
  }

  return {
    pending,
    failed,
    completed,
    syncing,
    total: operations.length,
  }
}

export function createSyncEngine<TContext = unknown>(
  options: SyncEngineOptions<TContext> = {},
): SyncEngine {
  const storage = options.storage ?? createMemoryStorage()
  const transport = options.transport
  const retry = options.retry ?? immediateRetryStrategy
  const maxRetries = options.maxRetries ?? 3
  const autoSync = options.autoSync ?? true
  const context = options.context
  const optimisticHandlers = options.optimisticHandlers
  const emitter = createEventEmitter()

  let operations: SyncOperation[] = []
  let hydrated = false
  let activeFlush: Promise<FlushResult> | null = null
  let cachedStorageBytesEstimate = 0
  let storageEstimateDirty = true
  const mergedHandlersMap = new Map<string, MergedOptimisticHandlers<TContext>>()

  const metrics = {
    totalQueued: 0,
    totalSucceeded: 0,
    totalFailed: 0,
    totalRetried: 0,
    lastSuccessfulFlushAt: null as Date | null,
  }

  function markStorageEstimateDirty(): void {
    storageEstimateDirty = true
  }

  function getStorageBytesEstimate(): number {
    if (storageEstimateDirty) {
      cachedStorageBytesEstimate = computeStorageBytesEstimate(operations)
      storageEstimateDirty = false
    }
    return cachedStorageBytesEstimate
  }

  async function hydrate(): Promise<void> {
    if (hydrated) {
      return
    }
    operations = reviveOperations(await storage.loadOperations())
    hydrated = true
    markStorageEstimateDirty()
  }

  async function persist(): Promise<void> {
    await storage.saveOperations(operations)
  }

  function emitLifecycle(
    type: SyncEventType,
    operation: SyncOperation,
    error?: unknown,
  ): void {
    emitter.emit({
      type,
      operation: { ...operation },
      timestamp: new Date(),
      ...(error !== undefined ? { error } : {}),
    })
  }

  function emitQueueChanged(): void {
    emitter.emit({
      type: SyncEventTypes.QueueChanged,
      timestamp: new Date(),
    })
  }

  function getRollbackHandlers(
    operation: SyncOperation,
  ): MergedOptimisticHandlers<TContext> {
    const session = mergedHandlersMap.get(operation.id)
    if (session) {
      return session
    }
    return resolveHandlers(operation.type, optimisticHandlers, undefined)
  }

  async function runFlush(): Promise<FlushResult> {
    await hydrate()

    if (!transport) {
      throw new TransportError("Transport adapter is required to flush operations")
    }

    const result: FlushResult = { successful: 0, failed: 0 }
    const pending = operations.filter(
      (operation) => operation.status === SyncOperationStatuses.Pending,
    )

    for (const operation of pending) {
      operation.status = SyncOperationStatuses.Syncing
      markStorageEstimateDirty()
      await persist()
      emitLifecycle(SyncEventTypes.Syncing, operation)
      emitQueueChanged()

      try {
        await transport.send(operation)
        operation.status = SyncOperationStatuses.Completed
        markStorageEstimateDirty()
        await persist()
        mergedHandlersMap.delete(operation.id)
        emitLifecycle(SyncEventTypes.Succeeded, operation)
        emitQueueChanged()
        metrics.totalSucceeded += 1
        result.successful += 1
      } catch (error) {
        operation.retries += 1

        if (maxRetries > 0) {
          metrics.totalRetried += 1
        }

        if (operation.retries >= maxRetries) {
          operation.status = SyncOperationStatuses.Failed
          operation.lastError = error
          markStorageEstimateDirty()
          await persist()

          const handlers = getRollbackHandlers(operation)
          if (handlers.rollback) {
            await handlers.rollback(operation, error, context as TContext)
            emitLifecycle(SyncEventTypes.Rollback, operation, error)
            mergedHandlersMap.delete(operation.id)
          }

          emitLifecycle(SyncEventTypes.Failed, operation, error)
          emitQueueChanged()
          metrics.totalFailed += 1
          result.failed += 1
        } else {
          operation.status = SyncOperationStatuses.Pending
          markStorageEstimateDirty()
          await persist()
          emitLifecycle(SyncEventTypes.Queued, operation)
          emitQueueChanged()
          await delay(retry.getDelay(operation.retries))
        }
      }
    }

    if (result.successful > 0) {
      metrics.lastSuccessfulFlushAt = new Date()
    }

    return result
  }

  async function flush(): Promise<FlushResult> {
    if (activeFlush) {
      return activeFlush
    }

    activeFlush = runFlush().finally(() => {
      activeFlush = null
    })

    return activeFlush
  }

  let handleOnline: (() => void) | null = null

  if (autoSync && isBrowser()) {
    handleOnline = () => {
      if (transport) {
        void flush().catch(() => {})
      }
    }
    window.addEventListener("online", handleOnline)
  }

  function getMetricsSnapshot(): MetricsSnapshot {
    return {
      totalQueued: metrics.totalQueued,
      totalSucceeded: metrics.totalSucceeded,
      totalFailed: metrics.totalFailed,
      totalRetried: metrics.totalRetried,
      averageRetries:
        metrics.totalSucceeded > 0
          ? metrics.totalRetried / metrics.totalSucceeded
          : 0,
      lastSuccessfulFlushAt: metrics.lastSuccessfulFlushAt,
    }
  }

  async function retryFailedOperation(id: string): Promise<boolean> {
    await hydrate()

    const operation = operations.find((item) => item.id === id)
    if (!operation || operation.status !== SyncOperationStatuses.Failed) {
      return false
    }

    operation.status = SyncOperationStatuses.Pending
    operation.retries = 0
    operation.lastError = undefined
    markStorageEstimateDirty()
    await persist()
    emitLifecycle(SyncEventTypes.Queued, operation)
    emitQueueChanged()

    return true
  }

  return {
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),

    async mutate<TPayload, TOptimisticData>(
      type: string,
      payload: TPayload,
      mutateOptions?: MutateOptions<TContext, TOptimisticData>,
    ): Promise<SyncOperation<TPayload, TOptimisticData>> {
      await hydrate()

      const operation: SyncOperation<TPayload, TOptimisticData> = {
        id: nanoid(),
        type,
        payload,
        status: SyncOperationStatuses.Pending,
        retries: 0,
        createdAt: new Date(),
        ...(mutateOptions?.optimisticData !== undefined
          ? { optimisticData: mutateOptions.optimisticData }
          : {}),
      }

      operations.push(operation as SyncOperation)
      markStorageEstimateDirty()
      await persist()

      const handlers = resolveHandlers(type, optimisticHandlers, mutateOptions)
      if (handlers.apply) {
        await handlers.apply(operation as SyncOperation, context as TContext)
        emitLifecycle(SyncEventTypes.Optimistic, operation as SyncOperation)
      }

      if (hasHandlers(handlers as MergedOptimisticHandlers<unknown>)) {
        mergedHandlersMap.set(operation.id, handlers)
      }

      emitLifecycle(SyncEventTypes.Queued, operation as SyncOperation)
      emitQueueChanged()
      metrics.totalQueued += 1

      return operation
    },

    async getPending<T = unknown>(): Promise<SyncOperation<T>[]> {
      await hydrate()
      return operations.filter(
        (operation) => operation.status === SyncOperationStatuses.Pending,
      ) as SyncOperation<T>[]
    },

    async getFailed<T = unknown>(): Promise<SyncOperation<T>[]> {
      await hydrate()
      return operations.filter(
        (operation) => operation.status === SyncOperationStatuses.Failed,
      ) as SyncOperation<T>[]
    },

    async retry(id: string): Promise<boolean> {
      return retryFailedOperation(id)
    },

    async retryAllFailed(): Promise<number> {
      await hydrate()
      const failed = operations.filter(
        (operation) => operation.status === SyncOperationStatuses.Failed,
      )
      let count = 0
      for (const operation of failed) {
        const retried = await retryFailedOperation(operation.id)
        if (retried) {
          count += 1
        }
      }
      return count
    },

    async compact(): Promise<number> {
      await hydrate()
      if (activeFlush) {
        await activeFlush
      }

      const completedCount = operations.filter(
        (operation) => operation.status === SyncOperationStatuses.Completed,
      ).length

      if (completedCount === 0) {
        return 0
      }

      operations = operations.filter(
        (operation) => operation.status !== SyncOperationStatuses.Completed,
      )
      markStorageEstimateDirty()
      await persist()
      emitQueueChanged()
      return completedCount
    },

    async inspect(options?: InspectOptions): Promise<InspectSnapshot> {
      await hydrate()

      const counts = buildInspectCounts(operations)

      const snapshot: InspectSnapshot = {
        pending: counts.pending,
        failed: counts.failed,
        completed: counts.completed,
        syncing: counts.syncing,
        total: counts.total,
        isSyncing: counts.syncing > 0,
      }

      if (options?.operations?.length) {
        const statuses = new Set(options.operations)
        snapshot.operations = operations
          .filter((operation) => statuses.has(operation.status))
          .map((operation) => ({ ...operation }))
      }

      return snapshot
    },

    getMetrics(): MetricsSnapshot {
      return getMetricsSnapshot()
    },

    async getHealth(options?: HealthOptions): Promise<HealthSnapshot> {
      await hydrate()

      const counts = buildInspectCounts(operations)
      const metricsSnapshot = getMetricsSnapshot()
      const now = options?.now ?? Date.now()
      const thresholds = mergeHealthThresholds(options?.thresholds)

      const oldestPendingAgeMs = computeOldestPendingAgeMs(operations, now)
      const storageBytesEstimate = getStorageBytesEstimate()
      const failureRate = computeFailureRate(metricsSnapshot)

      const { status, breachedSignals } = evaluateHealth(
        {
          queueSize: counts.total,
          pendingCount: counts.pending,
          oldestPendingAgeMs,
          failureRate,
          storageBytesEstimate,
          terminalOutcomes:
            metricsSnapshot.totalSucceeded + metricsSnapshot.totalFailed,
        },
        thresholds,
      )

      return {
        queueSize: counts.total,
        pendingCount: counts.pending,
        failedCount: counts.failed,
        completedCount: counts.completed,
        oldestPendingAgeMs,
        storageBytesEstimate,
        failureRate,
        status,
        breachedSignals,
      }
    },

    async remove(id: string): Promise<boolean> {
      await hydrate()

      const index = operations.findIndex((operation) => operation.id === id)
      if (index === -1) {
        return false
      }

      mergedHandlersMap.delete(id)
      operations.splice(index, 1)
      markStorageEstimateDirty()
      await persist()
      emitQueueChanged()
      return true
    },

    async clear(): Promise<void> {
      await hydrate()
      operations = []
      mergedHandlersMap.clear()
      markStorageEstimateDirty()
      await persist()
      emitQueueChanged()
    },

    flush,

    async destroy(): Promise<void> {
      if (handleOnline && isBrowser()) {
        window.removeEventListener("online", handleOnline)
      }
      await hydrate()
      operations = []
      mergedHandlersMap.clear()
      markStorageEstimateDirty()
      await persist()
      emitQueueChanged()
    },
  }
}

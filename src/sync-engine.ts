import { createEventEmitter, SyncEventTypes, type SyncEventType } from "./events.js"
import { TransportError } from "./errors.js"
import { hasHandlers, resolveHandlers, type MergedOptimisticHandlers } from "./optimistic.js"
import { immediateRetryStrategy } from "./retry.js"
import { reviveOperations } from "./serialize.js"
import { createMemoryStorage } from "./storage.js"
import { nanoid } from "nanoid"
import {
  SyncOperationStatuses,
  type FlushResult,
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
  const mergedHandlersMap = new Map<string, MergedOptimisticHandlers<TContext>>()

  async function hydrate(): Promise<void> {
    if (hydrated) {
      return
    }
    operations = reviveOperations(await storage.loadOperations())
    hydrated = true
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
      await persist()
      emitLifecycle(SyncEventTypes.Syncing, operation)

      try {
        await transport.send(operation)
        operation.status = SyncOperationStatuses.Completed
        await persist()
        mergedHandlersMap.delete(operation.id)
        emitLifecycle(SyncEventTypes.Succeeded, operation)
        result.successful += 1
      } catch (error) {
        operation.retries += 1

        if (operation.retries >= maxRetries) {
          operation.status = SyncOperationStatuses.Failed
          operation.lastError = error
          await persist()

          const handlers = getRollbackHandlers(operation)
          if (handlers.rollback) {
            await handlers.rollback(operation, error, context as TContext)
            emitLifecycle(SyncEventTypes.Rollback, operation, error)
            mergedHandlersMap.delete(operation.id)
          }

          emitLifecycle(SyncEventTypes.Failed, operation, error)
          result.failed += 1
        } else {
          operation.status = SyncOperationStatuses.Pending
          await persist()
          emitLifecycle(SyncEventTypes.Queued, operation)
          await delay(retry.getDelay(operation.retries))
        }
      }
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
      await hydrate()

      const operation = operations.find((item) => item.id === id)
      if (!operation || operation.status !== SyncOperationStatuses.Failed) {
        return false
      }

      operation.status = SyncOperationStatuses.Pending
      operation.retries = 0
      operation.lastError = undefined
      await persist()
      emitLifecycle(SyncEventTypes.Queued, operation)

      return true
    },

    async remove(id: string): Promise<boolean> {
      await hydrate()

      const index = operations.findIndex((operation) => operation.id === id)
      if (index === -1) {
        return false
      }

      mergedHandlersMap.delete(id)
      operations.splice(index, 1)
      await persist()
      return true
    },

    async clear(): Promise<void> {
      await hydrate()
      operations = []
      mergedHandlersMap.clear()
      await persist()
    },

    flush,

    async destroy(): Promise<void> {
      if (handleOnline && isBrowser()) {
        window.removeEventListener("online", handleOnline)
      }
      await hydrate()
      operations = []
      mergedHandlersMap.clear()
      await persist()
    },
  }
}

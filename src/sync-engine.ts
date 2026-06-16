import { createEventEmitter, SyncEventTypes, type SyncEventType } from "./events.js";
import { TransportError } from "./errors.js";
import { immediateRetryStrategy } from "./retry.js";
import { reviveOperations } from "./serialize.js";
import { createMemoryStorage } from "./storage.js";
import { nanoid } from "nanoid";
import {
  SyncOperationStatuses,
  type FlushResult,
  type SyncEngine,
  type SyncEngineOptions,
  type SyncOperation,
} from "./types.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createSyncEngine(options: SyncEngineOptions = {}): SyncEngine {
  const storage = options.storage ?? createMemoryStorage();
  const transport = options.transport;
  const retry = options.retry ?? immediateRetryStrategy;
  const maxRetries = options.maxRetries ?? 3;
  const emitter = createEventEmitter();

  let operations: SyncOperation[] = [];
  let hydrated = false;
  let activeFlush: Promise<FlushResult> | null = null;

  async function hydrate(): Promise<void> {
    if (hydrated) {
      return;
    }
    operations = reviveOperations(await storage.loadOperations());
    hydrated = true;
  }

  async function persist(): Promise<void> {
    await storage.saveOperations(operations);
  }

  function emitLifecycle(type: SyncEventType, operation: SyncOperation): void {
    emitter.emit({
      type,
      operation: { ...operation },
      timestamp: new Date(),
    });
  }

  async function runFlush(): Promise<FlushResult> {
    await hydrate();

    if (!transport) {
      throw new TransportError("Transport adapter is required to flush operations");
    }

    const result: FlushResult = { successful: 0, failed: 0 };
    const pending = operations.filter(
      (operation) => operation.status === SyncOperationStatuses.Pending,
    );

    for (const operation of pending) {
      operation.status = SyncOperationStatuses.Syncing;
      await persist();
      emitLifecycle(SyncEventTypes.Syncing, operation);

      try {
        await transport.send(operation);
        operation.status = SyncOperationStatuses.Completed;
        await persist();
        emitLifecycle(SyncEventTypes.Succeeded, operation);
        result.successful += 1;
      } catch {
        operation.retries += 1;

        if (operation.retries >= maxRetries) {
          operation.status = SyncOperationStatuses.Failed;
          await persist();
          emitLifecycle(SyncEventTypes.Failed, operation);
          result.failed += 1;
        } else {
          operation.status = SyncOperationStatuses.Pending;
          await persist();
          await delay(retry.getDelay(operation.retries));
        }
      }
    }

    return result;
  }

  return {
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),

    async mutate<T>(type: string, payload: T): Promise<SyncOperation<T>> {
      await hydrate();

      const operation: SyncOperation<T> = {
        id: nanoid(),
        type,
        payload,
        status: SyncOperationStatuses.Pending,
        retries: 0,
        createdAt: new Date(),
      };

      operations.push(operation);
      await persist();
      emitLifecycle(SyncEventTypes.Queued, operation);

      return operation;
    },

    async getPending<T = unknown>(): Promise<SyncOperation<T>[]> {
      await hydrate();
      return operations.filter(
        (operation) => operation.status === SyncOperationStatuses.Pending,
      ) as SyncOperation<T>[];
    },

    async remove(id: string): Promise<boolean> {
      await hydrate();

      const index = operations.findIndex((operation) => operation.id === id);
      if (index === -1) {
        return false;
      }

      operations.splice(index, 1);
      await persist();
      return true;
    },

    async clear(): Promise<void> {
      await hydrate();
      operations = [];
      await persist();
    },

    async flush(): Promise<FlushResult> {
      if (activeFlush) {
        return activeFlush;
      }

      activeFlush = runFlush().finally(() => {
        activeFlush = null;
      });

      return activeFlush;
    },

    async destroy(): Promise<void> {
      await hydrate();
      operations = [];
      await persist();
    },
  };
}

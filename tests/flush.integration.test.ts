import { describe, expect, it } from "vitest";
import {
  createMemoryStorage,
  createSyncEngine,
  SyncEventTypes,
  SyncOperationStatuses,
  type StorageAdapter,
  type SyncEvent,
  type SyncOperation,
  type TransportAdapter,
} from "../src/index.js";

class MockTransport implements TransportAdapter {
  sent: SyncOperation[] = [];

  async send(operation: SyncOperation): Promise<void> {
    this.sent.push({ ...operation });
  }
}

class SlowTransport implements TransportAdapter {
  sent: SyncOperation[] = [];

  async send(operation: SyncOperation): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.sent.push({ ...operation });
  }
}

class FailingTransport implements TransportAdapter {
  attempts = 0;

  async send(): Promise<void> {
    this.attempts += 1;
    throw new Error("network error");
  }
}

function createJsonStorage(): StorageAdapter {
  let serialized = "[]";

  return {
    async loadOperations(): Promise<SyncOperation[]> {
      return JSON.parse(serialized) as SyncOperation[];
    },

    async saveOperations(operations: SyncOperation[]): Promise<void> {
      serialized = JSON.stringify(operations);
    },
  };
}

describe("flush integration", () => {
  it("sends pending operations through transport on flush", async () => {
    const transport = new MockTransport();
    const storage = createMemoryStorage();
    const sync = createSyncEngine({ transport, storage });

    await sync.mutate("createOrder", { id: 1 });
    const result = await sync.flush();

    expect(result).toEqual({ successful: 1, failed: 0 });
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.type).toBe("createOrder");
    expect(transport.sent[0]?.payload).toEqual({ id: 1 });
    expect(transport.sent[0]?.status).toBe(SyncOperationStatuses.Syncing);

    const pending = await sync.getPending();
    expect(pending).toHaveLength(0);
  });

  it("emits lifecycle events and marks operations completed", async () => {
    const transport = new MockTransport();
    const sync = createSyncEngine({ transport });

    const events: SyncEvent[] = [];
    sync.on(SyncEventTypes.Queued, (event) => events.push(event));
    sync.on(SyncEventTypes.Syncing, (event) => events.push(event));
    sync.on(SyncEventTypes.Succeeded, (event) => events.push(event));

    const operation = await sync.mutate("createOrder", { total: 100 });
    await sync.flush();

    expect(events.map((event) => event.type)).toEqual([
      SyncEventTypes.Queued,
      SyncEventTypes.Syncing,
      SyncEventTypes.Succeeded,
    ]);
    expect(events[2]?.operation.id).toBe(operation.id);
    expect(events[2]?.operation.status).toBe(SyncOperationStatuses.Completed);
  });

  it("reloads pending operations from storage on restart", async () => {
    const transport = new MockTransport();
    const storage = createMemoryStorage();

    const sync1 = createSyncEngine({ transport, storage });
    await sync1.mutate("createOrder", { id: 1 });

    const sync2 = createSyncEngine({ transport, storage });
    const pending = await sync2.getPending();

    expect(pending).toHaveLength(1);
    expect(pending[0]?.type).toBe("createOrder");

    await sync2.flush();
    expect(transport.sent).toHaveLength(1);
  });

  it("preserves retries, statuses, and dates after restart", async () => {
    const storage = createJsonStorage();
    const sync1 = createSyncEngine({
      storage,
      transport: new FailingTransport(),
      maxRetries: 3,
    });

    await sync1.mutate("createOrder", { id: 1 });
    await sync1.flush();

    const sync2 = createSyncEngine({
      storage,
      transport: new MockTransport(),
      maxRetries: 3,
    });

    const pending = await sync2.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.retries).toBe(1);
    expect(pending[0]?.status).toBe(SyncOperationStatuses.Pending);
    expect(pending[0]?.createdAt).toBeInstanceOf(Date);
  });

  it("marks operations failed after max retries", async () => {
    const transport = new FailingTransport();
    const sync = createSyncEngine({
      transport,
      maxRetries: 2,
    });

    const failedEvents: SyncEvent[] = [];
    sync.on(SyncEventTypes.Failed, (event) => failedEvents.push(event));

    await sync.mutate("createOrder", { id: 1 });
    const firstFlush = await sync.flush();
    const secondFlush = await sync.flush();

    expect(firstFlush).toEqual({ successful: 0, failed: 0 });
    expect(secondFlush).toEqual({ successful: 0, failed: 1 });
    expect(transport.attempts).toBe(2);
    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0]?.operation.status).toBe(SyncOperationStatuses.Failed);
    expect(failedEvents[0]?.operation.retries).toBe(2);
  });

  it("does not send operations multiple times when flush runs concurrently", async () => {
    const transport = new SlowTransport();
    const sync = createSyncEngine({ transport });

    await sync.mutate("createOrder", { id: 1 });

    const results = await Promise.all([
      sync.flush(),
      sync.flush(),
      sync.flush(),
    ]);

    expect(transport.sent).toHaveLength(1);
    expect(results).toEqual([
      { successful: 1, failed: 0 },
      { successful: 1, failed: 0 },
      { successful: 1, failed: 0 },
    ]);
  });

  it("queues mutations made during flush for the next flush", async () => {
    const transport = new SlowTransport();
    const sync = createSyncEngine({ transport });

    await sync.mutate("A", { id: 1 });
    const flushing = sync.flush();
    await sync.mutate("B", { id: 2 });
    const firstResult = await flushing;

    expect(firstResult).toEqual({ successful: 1, failed: 0 });
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.type).toBe("A");

    const secondResult = await sync.flush();
    expect(secondResult).toEqual({ successful: 1, failed: 0 });
    expect(transport.sent).toHaveLength(2);
    expect(transport.sent[1]?.type).toBe("B");
  });

  it("throws when flushing without transport", async () => {
    const sync = createSyncEngine();
    await sync.mutate("createOrder", { id: 1 });

    await expect(sync.flush()).rejects.toThrow(
      "Transport adapter is required to flush operations",
    );
  });
});

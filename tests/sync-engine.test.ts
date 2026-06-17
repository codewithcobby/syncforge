import { describe, expect, it } from "vitest";
import { createSyncEngine, SyncEventTypes, SyncOperationStatuses } from "../src/index.js";

describe("createSyncEngine", () => {
  it("creates a sync engine instance", () => {
    const engine = createSyncEngine();
    expect(engine).toBeDefined();
    expect(typeof engine.mutate).toBe("function");
    expect(typeof engine.getPending).toBe("function");
    expect(typeof engine.remove).toBe("function");
    expect(typeof engine.clear).toBe("function");
    expect(typeof engine.retry).toBe("function");
    expect(typeof engine.retryAllFailed).toBe("function");
    expect(typeof engine.compact).toBe("function");
    expect(typeof engine.inspect).toBe("function");
    expect(typeof engine.destroy).toBe("function");
    expect(typeof engine.on).toBe("function");
    expect(typeof engine.off).toBe("function");
  });

  it("creates operations with lifecycle metadata", async () => {
    const engine = createSyncEngine();
    const operation = await engine.mutate("create", { name: "test" });

    expect(operation.id).toBeTypeOf("string");
    expect(operation.type).toBe("create");
    expect(operation.payload).toEqual({ name: "test" });
    expect(operation.status).toBe(SyncOperationStatuses.Pending);
    expect(operation.retries).toBe(0);
    expect(operation.createdAt).toBeInstanceOf(Date);
  });

  it("lists pending operations and supports removal", async () => {
    const engine = createSyncEngine();
    const first = await engine.mutate("createOrder", { total: 50 });
    await engine.mutate("updateOrder", { total: 60 });

    const pending = await engine.getPending();
    expect(pending).toHaveLength(2);
    expect(pending[0]?.id).toBe(first.id);

    const removed = await engine.remove(first.id);
    expect(removed).toBe(true);
    expect(await engine.getPending()).toHaveLength(1);
  });

  it("emits operation:queued when mutating", async () => {
    const engine = createSyncEngine();
    const events: string[] = [];

    engine.on(SyncEventTypes.Queued, () => {
      events.push(SyncEventTypes.Queued);
    });

    await engine.mutate("createOrder", { total: 50 });
    expect(events).toEqual([SyncEventTypes.Queued]);
  });
});

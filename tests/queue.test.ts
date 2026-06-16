import { describe, expect, it } from "vitest";
import { createQueue } from "../src/queue.js";
import type { SyncOperation } from "../src/types.js";

const sampleOperation = (): SyncOperation => ({
  id: "op-1",
  type: "update",
  payload: { value: 42 },
  createdAt: new Date(),
});

describe("createQueue", () => {
  it("starts empty", async () => {
    const queue = createQueue();
    expect(await queue.size()).toBe(0);
    expect(await queue.peek()).toBeNull();
  });

  it("pushes and shifts operations in FIFO order", async () => {
    const queue = createQueue();
    const first = sampleOperation();
    const second = { ...sampleOperation(), id: "op-2" };

    await queue.push(first);
    await queue.push(second);

    expect(await queue.size()).toBe(2);
    expect(await queue.peek()).toEqual(first);
    expect(await queue.shift()).toEqual(first);
    expect(await queue.shift()).toEqual(second);
    expect(await queue.size()).toBe(0);
  });

  it("clears all operations", async () => {
    const queue = createQueue();
    await queue.push(sampleOperation());
    await queue.clear();
    expect(await queue.size()).toBe(0);
  });
});

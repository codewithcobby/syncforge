import type { SyncOperation } from "./types.js";

export interface Queue<T = unknown> {
  push(operation: SyncOperation<T>): Promise<void>;
  peek(): Promise<SyncOperation<T> | null>;
  shift(): Promise<SyncOperation<T> | null>;
  size(): Promise<number>;
  clear(): Promise<void>;
}

export function createQueue<T = unknown>(): Queue<T> {
  const operations: SyncOperation<T>[] = [];

  return {
    async push(operation) {
      operations.push(operation);
    },

    async peek() {
      return operations[0] ?? null;
    },

    async shift() {
      return operations.shift() ?? null;
    },

    async size() {
      return operations.length;
    },

    async clear() {
      operations.length = 0;
    },
  };
}

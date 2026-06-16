import type { StorageAdapter, SyncOperation } from "./types.js";

export type { StorageAdapter };

export function createMemoryStorage(): StorageAdapter {
  let operations: SyncOperation[] = [];

  return {
    async loadOperations(): Promise<SyncOperation[]> {
      return operations.map((operation) => ({ ...operation }));
    },

    async saveOperations(nextOperations: SyncOperation[]): Promise<void> {
      operations = nextOperations.map((operation) => ({ ...operation }));
    },
  };
}

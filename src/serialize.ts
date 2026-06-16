import type { SyncOperation } from "./types.js";

export function reviveOperation(operation: SyncOperation): SyncOperation {
  return {
    ...operation,
    createdAt:
      operation.createdAt instanceof Date
        ? operation.createdAt
        : new Date(operation.createdAt),
  };
}

export function reviveOperations(operations: SyncOperation[]): SyncOperation[] {
  return operations.map(reviveOperation);
}

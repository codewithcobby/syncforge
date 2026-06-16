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

export interface SyncOperation<T = unknown> {
  id: string
  type: string
  payload: T
  status: SyncOperationStatus
  retries: number
  createdAt: Date
}

export interface StorageAdapter {
  loadOperations(): Promise<SyncOperation[]>
  saveOperations(operations: SyncOperation[]): Promise<void>
}

export interface SyncEngineOptions {
  transport?: TransportAdapter
  storage?: StorageAdapter
  retry?: RetryStrategy
  maxRetries?: number
  autoSync?: boolean
}

export interface FlushResult {
  successful: number
  failed: number
}

export interface SyncEngine {
  mutate<T>(type: string, payload: T): Promise<SyncOperation<T>>
  getPending<T = unknown>(): Promise<SyncOperation<T>[]>
  remove(id: string): Promise<boolean>
  clear(): Promise<void>
  flush(): Promise<FlushResult>
  destroy(): Promise<void>
  on(type: SyncEventType, listener: SyncEventListener): void
  off(type: SyncEventType, listener: SyncEventListener): void
}

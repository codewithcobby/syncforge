import type { SyncOperation } from "./types.js"

/**
 * Lifecycle event ordering (public contract):
 *
 * mutate with handlers: persist → operation:optimistic → operation:queued
 * mutate without handlers: persist → operation:queued
 * flush success: operation:syncing → operation:succeeded
 * retryable failure: operation:syncing → operation:queued
 * terminal failure: operation:syncing → operation:rollback → operation:failed
 * retry(id): status reset → persist → operation:queued
 * retryAllFailed(): per operation, same as retry(id); sequential when multiple ops
 *
 * queue:changed fires after any successful queue mutation (membership, status, or counts).
 * Read-only APIs (inspect(), hydrate()) do not emit. No operation field on this event.
 */
export const SyncEventTypes = {
  Queued: "operation:queued",
  Optimistic: "operation:optimistic",
  Syncing: "operation:syncing",
  Succeeded: "operation:succeeded",
  Rollback: "operation:rollback",
  Failed: "operation:failed",
  QueueChanged: "queue:changed",
} as const

export type SyncEventType = (typeof SyncEventTypes)[keyof typeof SyncEventTypes]

export interface SyncEvent {
  type: SyncEventType
  operation?: SyncOperation
  timestamp: Date
  error?: unknown
}

export type SyncEventListener = (event: SyncEvent) => void

export interface EventEmitter {
  on(type: SyncEventType, listener: SyncEventListener): void
  off(type: SyncEventType, listener: SyncEventListener): void
  emit(event: SyncEvent): void
}

export function createEventEmitter(): EventEmitter {
  const listeners = new Map<SyncEventType, Set<SyncEventListener>>()

  return {
    on(type, listener) {
      if (!listeners.has(type)) {
        listeners.set(type, new Set())
      }
      listeners.get(type)!.add(listener)
    },

    off(type, listener) {
      listeners.get(type)?.delete(listener)
    },

    emit(event) {
      listeners.get(event.type)?.forEach((listener) => listener(event))
    },
  }
}

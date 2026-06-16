import type { SyncOperation } from "./types.js";

export const SyncEventTypes = {
  Queued: "operation:queued",
  Syncing: "operation:syncing",
  Succeeded: "operation:succeeded",
  Failed: "operation:failed",
} as const;

export type SyncEventType = (typeof SyncEventTypes)[keyof typeof SyncEventTypes];

export interface SyncEvent {
  type: SyncEventType;
  operation: SyncOperation;
  timestamp: Date;
}

export type SyncEventListener = (event: SyncEvent) => void;

export interface EventEmitter {
  on(type: SyncEventType, listener: SyncEventListener): void;
  off(type: SyncEventType, listener: SyncEventListener): void;
  emit(event: SyncEvent): void;
}

export function createEventEmitter(): EventEmitter {
  const listeners = new Map<SyncEventType, Set<SyncEventListener>>();

  return {
    on(type, listener) {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type)!.add(listener);
    },

    off(type, listener) {
      listeners.get(type)?.delete(listener);
    },

    emit(event) {
      listeners.get(event.type)?.forEach((listener) => listener(event));
    },
  };
}

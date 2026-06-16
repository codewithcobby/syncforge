import type { SyncOperation } from "./types.js";

export interface TransportAdapter {
  send(operation: SyncOperation): Promise<void>;
}

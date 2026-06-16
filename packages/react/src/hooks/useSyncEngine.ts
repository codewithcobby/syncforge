import { useSyncForgeContext } from "../context.js"
import type { SyncEngine } from "syncforge"

export function useSyncEngine(): SyncEngine {
  return useSyncForgeContext().engine
}

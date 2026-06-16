import { createContext, useContext } from "react"
import type { FlushResult, SyncEngine } from "syncforge"

export interface SyncForgeContextValue {
  engine: SyncEngine
  flush: () => Promise<FlushResult>
  isFlushing: boolean
  syncingIds: ReadonlySet<string>
  statusVersion: number
}

export const SyncForgeContext = createContext<SyncForgeContextValue | null>(null)

export function useSyncForgeContext(): SyncForgeContextValue {
  const value = useContext(SyncForgeContext)

  if (!value) {
    throw new Error("SyncForge hooks must be used within a SyncForgeProvider")
  }

  return value
}

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { SyncEventTypes, type FlushResult, type SyncEngine, type SyncEvent } from "syncforge"
import { SyncForgeContext, type SyncForgeContextValue } from "./context.js"

export interface SyncForgeProviderProps {
  engine: SyncEngine
  children: ReactNode
}

export function SyncForgeProvider({ engine, children }: SyncForgeProviderProps) {
  const [isFlushing, setIsFlushing] = useState(false)
  const [syncingIds, setSyncingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [statusVersion, setStatusVersion] = useState(0)

  const bumpStatus = useCallback(() => {
    setStatusVersion((version) => version + 1)
  }, [])

  const flush = useCallback(async (): Promise<FlushResult> => {
    setIsFlushing(true)
    bumpStatus()

    try {
      return await engine.flush()
    } finally {
      setIsFlushing(false)
      bumpStatus()
    }
  }, [bumpStatus, engine])

  useEffect(() => {
    const addSyncing = (event: SyncEvent) => {
      setSyncingIds((ids) => new Set(ids).add(event.operation.id))
      bumpStatus()
    }

    const removeSyncing = (event: SyncEvent) => {
      setSyncingIds((ids) => {
        if (!ids.has(event.operation.id)) {
          return ids
        }
        const next = new Set(ids)
        next.delete(event.operation.id)
        return next
      })
      bumpStatus()
    }

    engine.on(SyncEventTypes.Syncing, addSyncing)
    engine.on(SyncEventTypes.Queued, removeSyncing)
    engine.on(SyncEventTypes.Succeeded, removeSyncing)
    engine.on(SyncEventTypes.Failed, removeSyncing)

    return () => {
      engine.off(SyncEventTypes.Syncing, addSyncing)
      engine.off(SyncEventTypes.Queued, removeSyncing)
      engine.off(SyncEventTypes.Succeeded, removeSyncing)
      engine.off(SyncEventTypes.Failed, removeSyncing)
    }
  }, [bumpStatus, engine])

  const value = useMemo<SyncForgeContextValue>(
    () => ({
      engine,
      flush,
      isFlushing,
      syncingIds,
      statusVersion,
    }),
    [engine, flush, isFlushing, syncingIds, statusVersion],
  )

  return <SyncForgeContext.Provider value={value}>{children}</SyncForgeContext.Provider>
}

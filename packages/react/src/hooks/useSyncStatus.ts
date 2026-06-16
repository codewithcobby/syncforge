import { useCallback, useEffect, useState } from "react"
import { SyncEventTypes, type SyncEvent, type SyncOperation } from "syncforge"
import { useSyncForgeContext } from "../context.js"

export interface SyncStatusLastError {
  operation: SyncOperation
  timestamp: Date
}

export interface SyncStatus {
  pendingCount: number
  isSyncing: boolean
  lastError: SyncStatusLastError | null
}

export function useSyncStatus(): SyncStatus {
  const { engine, isFlushing, syncingIds, statusVersion } = useSyncForgeContext()
  const [pendingCount, setPendingCount] = useState(0)
  const [lastError, setLastError] = useState<SyncStatusLastError | null>(null)

  const refreshPendingCount = useCallback(async () => {
    const pending = await engine.getPending()
    setPendingCount(pending.length)
  }, [engine])

  useEffect(() => {
    void refreshPendingCount()

    const onLifecycle = () => {
      void refreshPendingCount()
    }

    const onFailed = (event: SyncEvent) => {
      setLastError({
        operation: event.operation,
        timestamp: event.timestamp,
      })
      void refreshPendingCount()
    }

    engine.on(SyncEventTypes.Queued, onLifecycle)
    engine.on(SyncEventTypes.Syncing, onLifecycle)
    engine.on(SyncEventTypes.Succeeded, onLifecycle)
    engine.on(SyncEventTypes.Failed, onFailed)

    return () => {
      engine.off(SyncEventTypes.Queued, onLifecycle)
      engine.off(SyncEventTypes.Syncing, onLifecycle)
      engine.off(SyncEventTypes.Succeeded, onLifecycle)
      engine.off(SyncEventTypes.Failed, onFailed)
    }
  }, [engine, refreshPendingCount])

  useEffect(() => {
    void refreshPendingCount()
  }, [refreshPendingCount, statusVersion])

  return {
    pendingCount,
    isSyncing: isFlushing || syncingIds.size > 0,
    lastError,
  }
}

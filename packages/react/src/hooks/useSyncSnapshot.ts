import { useCallback, useRef, useSyncExternalStore } from "react"
import type { InspectOptions, InspectSnapshot } from "syncforge"
import { useSyncForgeContext } from "../context.js"
import {
  getQueueSnapshot,
  getServerQueueSnapshot,
  subscribeQueueSnapshot,
} from "../subscriptions/queueSnapshotStore.js"

export function useSyncSnapshot(options?: InspectOptions): InspectSnapshot {
  const { engine } = useSyncForgeContext()
  const optionsRef = useRef(options)
  optionsRef.current = options

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      subscribeQueueSnapshot(engine, optionsRef.current, onStoreChange),
    [engine],
  )

  const getSnapshot = useCallback(
    () => getQueueSnapshot(engine, optionsRef.current),
    [engine],
  )

  return useSyncExternalStore(subscribe, getSnapshot, getServerQueueSnapshot)
}

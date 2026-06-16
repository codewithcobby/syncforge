import { useSyncForgeContext } from "../context.js"
import type { SyncEngine } from "syncforge"

export type SyncMutate = SyncEngine["mutate"]

export function useSyncMutate(): SyncMutate {
  const { engine } = useSyncForgeContext()
  return engine.mutate.bind(engine) as SyncMutate
}

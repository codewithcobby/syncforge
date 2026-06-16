import { useSyncForgeContext } from "../context.js"
import type { FlushResult } from "syncforge"

export function useSyncFlush(): () => Promise<FlushResult> {
  return useSyncForgeContext().flush
}

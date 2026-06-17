import { SyncOperationStatuses, type InspectOptions, type SyncOperation } from "syncforge"
import { useSyncSnapshot } from "./useSyncSnapshot.js"

const EMPTY_OPERATIONS: SyncOperation[] = []

const PENDING_OPTIONS = Object.freeze({
  operations: [SyncOperationStatuses.Pending],
}) satisfies InspectOptions

const FAILED_OPTIONS = Object.freeze({
  operations: [SyncOperationStatuses.Failed],
}) satisfies InspectOptions

export function usePendingOperations(): SyncOperation[] {
  return useSyncSnapshot(PENDING_OPTIONS).operations ?? EMPTY_OPERATIONS
}

export function useFailedOperations(): SyncOperation[] {
  return useSyncSnapshot(FAILED_OPTIONS).operations ?? EMPTY_OPERATIONS
}

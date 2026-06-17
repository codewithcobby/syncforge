import { SyncEventTypes, type InspectOptions, type InspectSnapshot, type SyncEngine } from "syncforge"

export const EMPTY_SNAPSHOT: InspectSnapshot = {
  pending: 0,
  failed: 0,
  completed: 0,
  syncing: 0,
  total: 0,
  isSyncing: false,
}

interface QueueSnapshotStore {
  snapshot: InspectSnapshot
  options: InspectOptions | undefined
  subscribers: Set<() => void>
  onQueueChanged: (() => void) | null
  requestId: number
}

const storesByEngine = new WeakMap<SyncEngine, Map<string, QueueSnapshotStore>>()

function getOptionsKey(options?: InspectOptions): string {
  return options?.operations?.length ? [...new Set(options.operations)].sort().join("|") : "all"
}

function snapshotsEqual(a: InspectSnapshot, b: InspectSnapshot): boolean {
  if (
    a.pending !== b.pending ||
    a.failed !== b.failed ||
    a.completed !== b.completed ||
    a.syncing !== b.syncing ||
    a.total !== b.total ||
    a.isSyncing !== b.isSyncing
  ) {
    return false
  }

  const aOps = a.operations
  const bOps = b.operations
  if (!aOps && !bOps) {
    return true
  }
  if (!aOps || !bOps || aOps.length !== bOps.length) {
    return false
  }

  return aOps.every((op, index) => op.id === bOps[index]!.id && op.status === bOps[index]!.status)
}

function getOrCreateStore(engine: SyncEngine, options?: InspectOptions): QueueSnapshotStore {
  const key = getOptionsKey(options)
  let engineStores = storesByEngine.get(engine)

  if (!engineStores) {
    engineStores = new Map()
    storesByEngine.set(engine, engineStores)
  }

  let store = engineStores.get(key)
  if (!store) {
    store = {
      snapshot: EMPTY_SNAPSHOT,
      options,
      subscribers: new Set(),
      onQueueChanged: null,
      requestId: 0,
    }
    engineStores.set(key, store)
  }

  return store
}

function notifySubscribers(store: QueueSnapshotStore): void {
  for (const subscriber of store.subscribers) {
    subscriber()
  }
}

function refreshSnapshot(engine: SyncEngine, store: QueueSnapshotStore): void {
  const current = ++store.requestId

  void engine.inspect(store.options).then((snapshot) => {
    if (current !== store.requestId) {
      return
    }

    if (!snapshotsEqual(store.snapshot, snapshot)) {
      store.snapshot = snapshot
      notifySubscribers(store)
    }
  })
}

function ensureListener(engine: SyncEngine, store: QueueSnapshotStore): void {
  if (store.onQueueChanged) {
    return
  }

  const handler = () => {
    refreshSnapshot(engine, store)
  }

  engine.on(SyncEventTypes.QueueChanged, handler)
  store.onQueueChanged = handler
}

export function subscribeQueueSnapshot(
  engine: SyncEngine,
  options: InspectOptions | undefined,
  onStoreChange: () => void,
): () => void {
  const store = getOrCreateStore(engine, options)
  const wasEmpty = store.subscribers.size === 0

  store.subscribers.add(onStoreChange)

  if (wasEmpty) {
    ensureListener(engine, store)
    refreshSnapshot(engine, store)
  }

  return () => {
    store.subscribers.delete(onStoreChange)

    if (store.subscribers.size === 0 && store.onQueueChanged) {
      engine.off(SyncEventTypes.QueueChanged, store.onQueueChanged)
      store.onQueueChanged = null
      storesByEngine.get(engine)?.delete(getOptionsKey(options))
    }
  }
}

export function getQueueSnapshot(engine: SyncEngine, options?: InspectOptions): InspectSnapshot {
  return getOrCreateStore(engine, options).snapshot
}

export function getServerQueueSnapshot(): InspectSnapshot {
  return EMPTY_SNAPSHOT
}

/** @internal Test-only: count queue:changed listeners attached for an engine+options key. */
export function getQueueChangedListenerCount(engine: SyncEngine, options?: InspectOptions): number {
  const store = storesByEngine.get(engine)?.get(getOptionsKey(options))
  return store?.onQueueChanged ? 1 : 0
}

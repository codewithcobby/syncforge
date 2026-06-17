# Storage adapters

Official guide for choosing, configuring, and migrating between SyncForge storage backends.

**Quick links:** [README adapter summary](../README.md#storage-adapters) · [Examples](../examples/README.md)

---

## Choosing an adapter

| Adapter      | Factory                           | Environment      | Durability | Size limit    | Extra deps                                  | Use when                          |
| ------------ | --------------------------------- | ---------------- | ---------- | ------------- | ------------------------------------------- | --------------------------------- |
| Memory       | `createMemoryStorage()`           | Tests, Node, SSR | None       | RAM           | —                                           | No persistence needed             |
| IndexedDB    | `createIndexedDbStorage()`        | Browser          | Full       | Large         | —                                           | Production PWAs, large queues     |
| LocalStorage | `createLocalStorageStorage()`     | Browser          | Full       | ~5MB / origin | —                                           | Prototypes, widgets, small queues |
| AsyncStorage | `createAsyncStorageAdapter()`     | React Native     | Full       | Platform      | `@react-native-async-storage/async-storage` | RN / Expo apps                    |
| Capacitor    | `createCapacitorStorageAdapter()` | Hybrid mobile    | Full       | Platform      | `@capacitor/preferences`                    | Capacitor iOS / Android           |

All adapters ship in the `syncforge` package. For Capacitor **web** builds in a desktop browser, use IndexedDB or LocalStorage instead.

Relational data, partial updates, or very large datasets may need a custom `StorageAdapter` (e.g. `@capacitor-community/sqlite`) — not built into SyncForge core today.

---

## Shared behavior

### Storage model

Every official adapter persists the **same JSON document** — an array of `SyncOperation` objects. The full queue is rewritten on each mutation. The engine revives `createdAt` on hydrate via `reviveOperations()`.

Run `compact()` periodically to drop completed operations. Monitor growth with `getHealth()`. See [large-queue guidance](./benchmarks/large-queue-methodology.md) for production limits.

### Key and prefix

`createLocalStorageStorage()`, `createAsyncStorageAdapter()`, and `createCapacitorStorageAdapter()` accept optional `key` (default `"syncforge-queue"`) and `prefix` (default `""`). Resolved key: `` `${prefix ?? ""}${key ?? "syncforge-queue"}` `` — include any separator in `prefix` (e.g. `"my-app:"`); SyncForge does not insert one.

### Reconnect and flush

| Environment        | `autoSync` default | Reconnect flush                                                                                                                           |
| ------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Browser            | `true`             | Automatic on network reconnect                                                                                                            |
| React Native       | Set `false`        | Wire `@react-native-community/netinfo`; optional `AppState` foreground flush — [example](../examples/react-native-asyncstorage/README.md) |
| Capacitor (native) | Set `false`        | Wire `@capacitor/network`; optional `@capacitor/app` resume flush — [example](../examples/capacitor-preferences/README.md)                |
| Node / tests       | No-op              | Call `flush()` manually                                                                                                                   |

### Empty queue

When the backing store supports remove (`removeItem` / `remove`), saving an empty queue deletes the storage key instead of persisting `"[]"`.

---

## Per-adapter setup

### Memory

```typescript
import { createMemoryStorage, createSyncEngine } from "syncforge"

const sync = createSyncEngine({
  transport: myTransport,
  storage: createMemoryStorage(),
  autoSync: false,
})
```

No options. Each factory call returns an isolated store — data is lost on reload or process exit. See [README](../README.md#memory-storage).

### IndexedDB

```typescript
import { createIndexedDbStorage, createSyncEngine } from "syncforge"

const sync = createSyncEngine({
  transport: myTransport,
  storage: createIndexedDbStorage({ dbName: "my-app", storeName: "sync-queue" }),
})
```

| Option      | Default        | Description                                       |
| ----------- | -------------- | ------------------------------------------------- |
| `dbName`    | `"syncforge"`  | Database name — unique per app on the same origin |
| `storeName` | `"operations"` | Object store name                                 |

Browser only — not available in Node, SSR, or native runtimes. Runnable demo: [react-offline-orders](../examples/react-offline-orders/README.md).

### LocalStorage

```typescript
import { createLocalStorageStorage, createSyncEngine } from "syncforge"

const sync = createSyncEngine({
  storage: createLocalStorageStorage({ prefix: "my-app:", key: "syncforge-queue" }),
  transport: myTransport,
})
```

Uses [key and prefix](#key-and-prefix). ~5MB per origin; underlying API is synchronous (wrapped in async methods). Quota exceeded throws `StorageError` suggesting `compact()` or a switch to IndexedDB. Snippet: [examples/localstorage](../examples/localstorage/README.md).

### AsyncStorage

```typescript
import AsyncStorage from "@react-native-async-storage/async-storage"
import { createAsyncStorageAdapter, createSyncEngine } from "syncforge"

const sync = createSyncEngine({
  storage: createAsyncStorageAdapter({ asyncStorage: AsyncStorage, key: "syncforge-queue" }),
  transport: myTransport,
  autoSync: false,
})
```

Inject the app's AsyncStorage instance — SyncForge uses only `getItem`, `setItem`, and optionally `removeItem`. Uses [key and prefix](#key-and-prefix). Snippet: [react-native-asyncstorage](../examples/react-native-asyncstorage/README.md).

### Capacitor

```typescript
import { Preferences } from "@capacitor/preferences"
import { createCapacitorStorageAdapter, createSyncEngine } from "syncforge"

const sync = createSyncEngine({
  storage: createCapacitorStorageAdapter({ preferences: Preferences, key: "syncforge-queue" }),
  transport: myTransport,
  autoSync: false,
})
```

Inject the app's Preferences instance — SyncForge uses only `get`, `set`, and optionally `remove`. Uses [key and prefix](#key-and-prefix). **Preferences vs SQLite:** Preferences is the default for queue storage; for relational or very large data, implement a custom `StorageAdapter`. Snippet: [capacitor-preferences](../examples/capacitor-preferences/README.md).

---

## Migrating between adapters

SyncForge does **not** ship automatic cross-adapter migration. Because all official adapters share the same JSON format, migrate manually with `loadOperations()` → `reviveOperations()` → `saveOperations()`:

```typescript
import { createIndexedDbStorage, createLocalStorageStorage, reviveOperations, SyncOperationStatuses } from "syncforge"

async function migrateLocalStorageToIndexedDB() {
  const oldStorage = createLocalStorageStorage({ key: "syncforge-queue" })
  const newStorage = createIndexedDbStorage({ dbName: "my-app", storeName: "sync-queue" })

  const operations = reviveOperations(await oldStorage.loadOperations())
  const toMigrate = operations.filter(
    (op) => op.status === SyncOperationStatuses.Pending || op.status === SyncOperationStatuses.Failed,
  )

  if (toMigrate.length === 0) return

  await newStorage.saveOperations(toMigrate)
  await oldStorage.saveOperations([])
}
```

**Before migrating:** pause `mutate()`, drain or flush in-flight work, verify with `getPending()` / `inspect()` on a new engine, then clear the old adapter.

| From         | To                    | Typical trigger                     |
| ------------ | --------------------- | ----------------------------------- |
| LocalStorage | IndexedDB             | Outgrows ~5MB or queue limits       |
| Memory       | IndexedDB             | Dev → production browser app        |
| LocalStorage | AsyncStorage          | Shipping RN app (usually at deploy) |
| IndexedDB    | Capacitor Preferences | Web PWA → native Capacitor shell    |

Cross-platform moves use the same pattern but are usually done at app upgrade time, not at runtime. On-disk **schema** changes (new fields, renames) are separate — see [v1.1 storage migrations](./issues/v1.1-storage-migrations.md).

---

## Related

- [Large-queue methodology](./benchmarks/large-queue-methodology.md)
- [SyncForge README](../README.md)
- [Examples index](../examples/README.md)

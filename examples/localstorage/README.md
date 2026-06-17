# LocalStorage snippet

Copy-paste reference for `syncforge` + `createLocalStorageStorage()`. Not a runnable app — see [react-offline-orders](../react-offline-orders/) for a full IndexedDB demo.

## Install

```bash
npm install syncforge
```

## Engine setup

```typescript
import { createLocalStorageStorage, createSyncEngine } from "syncforge"

export const sync = createSyncEngine({
  storage: createLocalStorageStorage({
    prefix: "my-app:",
    key: "syncforge-queue",
  }),
  transport: myTransport,
  // autoSync defaults to true in browsers
})
```

## When to use

- Prototypes, embedded widgets, small queues
- Quick browser testing without `fake-indexeddb`

## When not to use

- Large queues or payloads approaching ~5MB — prefer `createIndexedDbStorage()`
- Production offline-first PWAs — see [IndexedDB guide](../../docs/storage-adapters.md#indexeddb)

## With syncforge-react

```typescript
import { SyncForgeProvider } from "syncforge-react"
import { sync } from "./sync"

export function App() {
  return (
    <SyncForgeProvider engine={sync}>
      {/* your screens */}
    </SyncForgeProvider>
  )
}
```

## Further reading

- [LocalStorage adapter guide](../../docs/storage-adapters.md#localstorage)
- [Migrating to IndexedDB](../../docs/storage-adapters.md#migrating-between-adapters)
- [SyncForge README](../../README.md)

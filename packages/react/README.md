# syncforge-react

Official React bindings for [SyncForge](https://github.com/codewithcobby/syncforge) — offline-first mutation sync for web apps.

## What it does

Users on spotty Wi‑Fi, in a basement, or on a train tap **Save** and the request fails. Without a sync layer, that work is lost or they must retry manually.

**SyncForge** gives you **save now, sync later**:

1. **Record** — `engine.mutate("createOrder", payload)` queues a change. The first argument is a label your app defines; SyncForge does not interpret it.
2. **Persist** — operations are stored locally (IndexedDB in the browser) so they survive refresh and reconnect.
3. **Send** — when you call `flush()` or the network returns (`autoSync`), SyncForge calls your `transport.send()` for each pending operation.
4. **Report** — lifecycle events fire when operations are queued, syncing, succeeded, or failed.

You keep your existing API. You define operation labels (`"createOrder"`, `"updateProfile"`, …) and map them to REST, GraphQL, or anything else in your **transport**. SyncForge handles the **queue, persistence, retries, and event flow** — without replacing your backend or adopting a full local database.

**`syncforge-react`** is the React layer on that engine: one shared `SyncEngine` via context, `useSyncStatus()` for queue UI, and optional `useSyncFlush()` for “Sync now” — no manual `useEffect` subscriptions or prop drilling.

| Package                                                | Role                                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| [`syncforge`](https://www.npmjs.com/package/syncforge) | Core engine — `createSyncEngine`, storage, transport, retries ([docs](https://github.com/codewithcobby/syncforge#readme)) |
| `syncforge-react`                                     | Provider + hooks for React apps (this package)                                                                            |

This README is self-contained for React. For architecture diagrams, Node/SSR notes, and framework-agnostic usage, see the [SyncForge repository](https://github.com/codewithcobby/syncforge).

## Install

```bash
pnpm add syncforge-react syncforge
```

Peer dependencies: `react`, `react-dom`, `syncforge`.

## Engine setup

Create the engine **once** (e.g. in `useMemo` or a module singleton) and pass it to `SyncForgeProvider`. The provider does not create or change the engine.

### `createSyncEngine(options?)`

| Option               | Type                                | Default   | Description                                                                          |
| -------------------- | ----------------------------------- | --------- | ------------------------------------------------------------------------------------ |
| `transport`          | `TransportAdapter`                  | —         | Sends each operation to your API. Required for `flush()` to work.                    |
| `storage`            | `StorageAdapter`                    | in-memory | Persists the queue across reloads.                                                   |
| `retry`              | `RetryStrategy`                     | immediate | Delay between retries after a failed `send()`.                                       |
| `maxRetries`         | `number`                            | `3`       | Attempts per operation before status becomes `failed`.                               |
| `autoSync`           | `boolean`                           | `true`    | Browser only: call `flush()` on `window` `"online"`. Set `false` for manual control. |
| `context`            | `TContext`                          | —         | User-owned state passed to optimistic handlers (Zustand, React state, etc.).         |
| `optimisticHandlers` | `Record<string, OptimisticHandler>` | —         | Registry `apply` / `rollback` keyed by `operation.type`. Survives reload.            |

**`TransportAdapter`** — `{ send(operation): Promise<void> }`. Resolve on success; **throw** on failure to trigger a retry (up to `maxRetries`).

**`SyncOperation`** (passed to `send`): `id`, `type`, `payload`, `status`, `retries`, `createdAt`.

### Storage options

| Factory                            | Options                                                                  | When to use                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `createIndexedDbStorage(options?)` | `dbName?` (default `"syncforge"`), `storeName?` (default `"operations"`) | **Production browsers** — queue survives refresh and tab close.                                     |
| `createMemoryStorage()`            | —                                                                        | **Tests, Storybook, SSR** — in-memory only; lost on reload. IndexedDB is not available in Node/SSR. |

Use a **unique `dbName` per app** on the same origin so queues do not collide.

```typescript
import { createIndexedDbStorage, createMemoryStorage } from "syncforge"

// Browser — persisted queue
const storage = createIndexedDbStorage({
  dbName: "my-app",
  storeName: "sync-queue",
})

// Tests / non-browser
const testStorage = createMemoryStorage()
```

### Transport patterns

**Routed endpoints** — map `operation.type` to the right API (most common):

```typescript
import type { TransportAdapter } from "syncforge"

const transport: TransportAdapter = {
  async send(operation) {
    switch (operation.type) {
      case "createOrder": {
        const res = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(operation.payload),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        break
      }
      case "updateProfile": {
        const res = await fetch("/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(operation.payload),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        break
      }
      default:
        throw new Error(`Unknown operation type: ${operation.type}`)
    }
  },
}
```

**Single endpoint** — post the full operation; backend reads `operation.type`:

```typescript
const transport: TransportAdapter = {
  async send(operation) {
    const res = await fetch("/api/mutations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(operation),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  },
}
```

### Retry strategies (optional)

```typescript
import { createSyncEngine, exponentialBackoffRetryStrategy, linearBackoffRetryStrategy } from "syncforge"

createSyncEngine({
  transport,
  storage: createIndexedDbStorage(),
  retry: exponentialBackoffRetryStrategy({
    baseDelayMs: 1_000,
    maxDelayMs: 30_000,
    factor: 2,
    jitter: true,
  }),
  maxRetries: 5,
})

// Or linear: delay grows as baseDelayMs × attempt
createSyncEngine({
  transport,
  retry: linearBackoffRetryStrategy({ baseDelayMs: 1_000, maxDelayMs: 30_000 }),
})
```

Default is `immediateRetryStrategy` (no delay between attempts within one `flush()`).

### Full React wiring

```tsx
import { useMemo } from "react"
import { createIndexedDbStorage, createSyncEngine, type TransportAdapter } from "syncforge"
import { SyncForgeProvider, useSyncEngine, useSyncFlush, useSyncStatus } from "syncforge-react"

const transport: TransportAdapter = {
  async send(operation) {
    if (operation.type !== "createOrder") {
      throw new Error(`Unknown operation: ${operation.type}`)
    }
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(operation.payload),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  },
}

export function App() {
  const engine = useMemo(
    () =>
      createSyncEngine({
        storage: createIndexedDbStorage({ dbName: "my-app", storeName: "sync-queue" }),
        transport,
        autoSync: true,
      }),
    [],
  )

  return (
    <SyncForgeProvider engine={engine}>
      <OrderForm />
      <SyncIndicator />
    </SyncForgeProvider>
  )
}

function SyncIndicator() {
  const status = useSyncStatus()

  return (
    <span>
      {status.pendingCount} pending
      {status.isSyncing ? " (syncing…)" : ""}
      {status.lastError ? ` — last error: ${status.lastError.operation.type}` : ""}
    </span>
  )
}

function OrderForm() {
  const engine = useSyncEngine()
  const flush = useSyncFlush()

  async function handleSubmit() {
    await engine.mutate("createOrder", { id: crypto.randomUUID(), total: 100 })
    await flush() // optional if autoSync handles reconnect; use for "Sync now"
  }

  return (
    <button type="button" onClick={() => void handleSubmit()}>
      Create order
    </button>
  )
}
```

With `autoSync: true` (default), going back online triggers `flush()` automatically — you do not need `useSyncFlush()` for reconnect-only flows.

## Hooks

| Hook              | Returns                      | Use when                                                                            |
| ----------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| `useSyncEngine()` | `SyncEngine`                 | Call `mutate()`, subscribe with `on()` / `off()`, or call `engine.flush()` directly |
| `useSyncMutate()` | `SyncEngine["mutate"]`       | Queue mutations with `optimisticData` and optional inline handler overrides         |
| `useSyncFlush()`  | `() => Promise<FlushResult>` | User clicks “Sync now” and you want `isSyncing` to reflect that manual flush        |
| `useSyncStatus()` | `SyncStatus`                 | Show pending count, sync activity, or last failed operation in the UI               |

All hooks throw if used outside `SyncForgeProvider`.

### `useSyncStatus()` fields

```typescript
const status = useSyncStatus()
```

| Field          | Type                               | Meaning                                                         |
| -------------- | ---------------------------------- | --------------------------------------------------------------- |
| `pendingCount` | `number`                           | Operations waiting to sync (`getPending()`)                     |
| `isSyncing`    | `boolean`                          | `true` during a tracked flush or while operations are in flight |
| `lastError`    | `{ operation, timestamp } \| null` | Most recent `operation:failed` event                            |

`pendingCount` updates on sync lifecycle events: `operation:queued`, `operation:syncing`, `operation:succeeded`, `operation:failed`. It does **not** include a `revision` field — optimistic UI re-renders are driven by your own store or by subscribing to optimistic events (below).

### Optimistic events

SyncForge does not force React re-renders for optimistic changes. Register handlers on the engine and update **your** state (or subscribe to re-render a local list):

```tsx
import { useEffect, useState } from "react"
import { SyncEventTypes } from "syncforge"
import { useSyncEngine, useSyncMutate } from "syncforge-react"

function OrderList({ orderStore }: { orderStore: OrderStore }) {
  const engine = useSyncEngine()
  const mutate = useSyncMutate()
  const [, setRevision] = useState(0)

  useEffect(() => {
    const bump = () => setRevision((n) => n + 1)
    engine.on(SyncEventTypes.Optimistic, bump)
    engine.on(SyncEventTypes.Rollback, bump)
    return () => {
      engine.off(SyncEventTypes.Optimistic, bump)
      engine.off(SyncEventTypes.Rollback, bump)
    }
  }, [engine])

  async function createOrder(order: Order) {
    await mutate("createOrder", order, { optimisticData: { tempId: order.id } })
  }

  return (/* render orderStore.orders */)
}
```

> **Inline `optimisticUpdate` / `rollback` on `mutate()` are session-scoped.** For reload-safe rollback, put recovery logic in `optimisticHandlers` at engine creation. See [SyncForge optimistic updates](https://github.com/codewithcobby/syncforge#optimistic-updates).

Event ordering: `operation:optimistic` → `operation:queued` on mutate; terminal failure: `operation:syncing` → `operation:rollback` → `operation:failed`.

## API reference

### `SyncForgeProvider`

| Prop       | Type         | Description                                    |
| ---------- | ------------ | ---------------------------------------------- |
| `engine`   | `SyncEngine` | Pre-created instance from `createSyncEngine()` |
| `children` | `ReactNode`  | Tree that uses SyncForge hooks                 |

### `useSyncEngine()`

Returns the **same** `SyncEngine` reference passed to the provider.

| Method                                       | Description                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `mutate(type, payload, options?)`            | Queue a mutation; emits `operation:optimistic` (when handlers exist) then `operation:queued` |
| `flush()`                                    | Send pending operations via transport                                                        |
| `getPending()`                               | List operations with status `pending`                                                        |
| `getFailed()`                                | List operations with status `failed`                                                         |
| `retry(id)`                                  | Re-queue a failed operation (clears `lastError`; does not re-run `apply`)                    |
| `on(type, listener)` / `off(type, listener)` | Lifecycle events (advanced)                                                                  |
| `remove(id)` / `clear()` / `destroy()`       | Queue management                                                                             |

### `useSyncMutate()`

Thin wrapper around `engine.mutate` for components that only queue changes:

```tsx
const mutate = useSyncMutate()

await mutate(
  "createOrder",
  { id, label },
  {
    optimisticData: { tempId: id },
    optimisticUpdate(op, ctx) {
      // optional session-scoped apply override
    },
  },
)
```

### `useSyncFlush()`

Optional tracked `flush()` that sets `useSyncStatus().isSyncing` while running. Does not replace or patch `engine.flush()`.

### `useSyncStatus()`

Read-only UI state from lifecycle events + optional tracked flush. Prefer `const status = useSyncStatus()` so new fields can be added without breaking call sites.

### Lifecycle events

| Event                  | When                                   |
| ---------------------- | -------------------------------------- |
| `operation:optimistic` | After optimistic `apply` on `mutate()` |
| `operation:queued`     | After `mutate()` persists              |
| `operation:syncing`    | Before `transport.send()` during flush |
| `operation:succeeded`  | Transport resolved                     |
| `operation:rollback`   | After rollback on terminal failure     |
| `operation:failed`     | `maxRetries` exceeded                  |

Event shape: `{ type, operation, timestamp }`. Import `SyncEventTypes` from `syncforge` for constants.

## Try it

- [StackBlitz demo](https://stackblitz.com/github/codewithcobby/syncforge/tree/main/examples/react-offline-orders) — offline queue + auto sync with IndexedDB
- [SyncForge on GitHub](https://github.com/codewithcobby/syncforge) — core source, issues, and examples

## License

MIT

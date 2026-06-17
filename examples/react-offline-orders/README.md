# React offline orders example

Demo app for `syncforge` + `syncforge-react`.

## Run locally

From the repo root (after `pnpm install` and `pnpm build`):

```bash
pnpm --filter react-offline-orders dev
```

## Try offline sync

1. Open the app in your browser
2. DevTools → Network → **Offline**
3. Click **Create order** — pending count increases
4. Go **Online** — auto sync flushes the queue

## Imports

This example uses workspace package names (not relative paths):

```typescript
import { createSyncEngine, createIndexedDbStorage } from "syncforge"
import { SyncForgeProvider, useSyncStatus } from "syncforge-react"
```

## Adapter guide

- [IndexedDB guide](../../docs/storage-adapters.md#indexeddb)
- [Storage adapters overview](../../docs/storage-adapters.md)
- [Examples index](../README.md)

## Sandbox

Open in StackBlitz (replace with published URL after first release):

https://stackblitz.com/github/codewithcobby/syncforge/tree/main/examples/react-offline-orders

> StackBlitz link targets the in-repo example path. Update after publishing if you fork the demo separately.

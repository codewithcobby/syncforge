# Capacitor Preferences snippet

Copy-paste reference for `syncforge` + `@capacitor/preferences`. Not a runnable app — see [react-offline-orders](../react-offline-orders/) for a full web demo.

## Install

```bash
npm install syncforge @capacitor/preferences
```

Optional for reconnect-driven flush:

```bash
npm install @capacitor/network @capacitor/app
```

## Engine setup

```typescript
import { Preferences } from "@capacitor/preferences"
import { createCapacitorStorageAdapter, createSyncEngine } from "syncforge"

export const sync = createSyncEngine({
  storage: createCapacitorStorageAdapter({
    preferences: Preferences,
    prefix: "my-app:",
    key: "syncforge-queue",
  }),
  transport: myTransport,
  autoSync: false, // native Capacitor has no window "online" — wire Network below
})
```

## Reconnect flush (Network)

SyncForge does not bundle Capacitor Network — your app owns connectivity:

```typescript
import { Network } from "@capacitor/network"
import { sync } from "./sync"

Network.addListener("networkStatusChange", (status) => {
  if (status.connected) {
    void sync.flush().catch(() => {})
  }
})
```

## Optional: flush on foreground

```typescript
import { App } from "@capacitor/app"
import { sync } from "./sync"

App.addListener("appStateChange", ({ isActive }) => {
  if (isActive) {
    void sync.flush().catch(() => {})
  }
})
```

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

- Transport, retry, and optimistic patterns: [SyncForge README](../../README.md)
- Large queues: run `compact()` and monitor `getHealth()` — prefer smaller payloads on Preferences
- SQLite: not included in SyncForge core — see README Capacitor section for trade-offs

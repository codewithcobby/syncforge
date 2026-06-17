# React Native AsyncStorage snippet

Copy-paste reference for `syncforge` + `@react-native-async-storage/async-storage`. Not a runnable app — see [react-offline-orders](../react-offline-orders/) for a full web demo.

## Install

```bash
npm install syncforge @react-native-async-storage/async-storage
```

Optional for reconnect-driven flush:

```bash
npm install @react-native-community/netinfo
```

## Engine setup

```typescript
import AsyncStorage from "@react-native-async-storage/async-storage"
import { createAsyncStorageAdapter, createSyncEngine } from "syncforge"

export const sync = createSyncEngine({
  storage: createAsyncStorageAdapter({
    asyncStorage: AsyncStorage,
    prefix: "my-app:",
    key: "syncforge-queue",
  }),
  transport: myTransport,
  autoSync: false, // RN has no window "online" — wire NetInfo below
})
```

## Reconnect flush (NetInfo)

SyncForge does not bundle NetInfo — your app owns connectivity:

```typescript
import NetInfo from "@react-native-community/netinfo"
import { sync } from "./sync"

NetInfo.addEventListener((state) => {
  if (state.isConnected) {
    void sync.flush().catch(() => {})
  }
})
```

## Optional: flush on foreground

```typescript
import { AppState } from "react-native"
import { sync } from "./sync"

AppState.addEventListener("change", (nextState) => {
  if (nextState === "active") {
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
- Large queues: run `compact()` and monitor `getHealth()` — prefer smaller payloads on AsyncStorage

# SyncForge examples

| Example                                                   | Adapter               | Runnable | Description                              |
| --------------------------------------------------------- | --------------------- | -------- | ---------------------------------------- |
| [react-offline-orders](./react-offline-orders/)           | IndexedDB             | Yes      | Full React demo with offline sync        |
| [localstorage](./localstorage/)                           | LocalStorage          | Snippet  | Copy-paste browser widget setup          |
| [react-native-asyncstorage](./react-native-asyncstorage/) | AsyncStorage          | Snippet  | RN + NetInfo / AppState flush patterns   |
| [capacitor-preferences](./capacitor-preferences/)         | Capacitor Preferences | Snippet  | Capacitor + Network / App flush patterns |

## Adapter guides

- [Storage adapters guide](../docs/storage-adapters.md) — decision matrix, per-adapter setup, migration
- [README adapter summary](../README.md#storage-adapters)

## Run the web demo

From the repo root (after `pnpm install` and `pnpm build`):

```bash
pnpm --filter react-offline-orders dev
```

Then open the app, go offline in DevTools, create an order, and go back online to flush.

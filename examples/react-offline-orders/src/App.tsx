import { useMemo } from "react"
import {
  createIndexedDbStorage,
  createSyncEngine,
  type SyncOperation,
  type TransportAdapter,
} from "syncforge"
import { SyncForgeProvider, useSyncEngine, useSyncFlush, useSyncStatus } from "@syncforge/react"

const orders: Array<{ id: string; label: string }> = []

const transport: TransportAdapter = {
  async send(operation: SyncOperation) {
    if (!navigator.onLine) {
      throw new Error("offline")
    }

    if (operation.type !== "createOrder") {
      throw new Error(`Unknown operation: ${operation.type}`)
    }

    const payload = operation.payload as { label: string }
    orders.push({ id: operation.id, label: payload.label })
    console.info("[demo transport] synced order", payload.label)
  },
}

function SyncIndicator() {
  const status = useSyncStatus()

  return (
    <p className="status">
      <strong>Queue:</strong> {status.pendingCount} pending
      {status.isSyncing ? " · syncing…" : ""}
      {status.lastError ? ` · failed: ${status.lastError.operation.type}` : ""}
      {" · "}
      <strong>Network:</strong> {navigator.onLine ? "online" : "offline"}
    </p>
  )
}

function OrderForm() {
  const engine = useSyncEngine()
  const flush = useSyncFlush()

  async function handleCreate() {
    const label = `Order ${new Date().toLocaleTimeString()}`
    await engine.mutate("createOrder", { label })
    await flush()
  }

  return (
    <button type="button" onClick={() => void handleCreate()}>
      Create order
    </button>
  )
}

function DemoPanel() {
  return (
    <main className="panel">
      <h1>SyncForge offline orders</h1>
      <p>
        Queue mutations while offline, then sync when back online. Auto sync on reconnect is enabled.
      </p>
      <SyncIndicator />
      <OrderForm />
      <ol className="hint">
        <li>Open DevTools → Network → Offline</li>
        <li>Click <em>Create order</em> — pending count increases</li>
        <li>Go online — auto sync flushes the queue</li>
      </ol>
    </main>
  )
}

export function App() {
  const engine = useMemo(
    () =>
      createSyncEngine({
        storage: createIndexedDbStorage({ dbName: "syncforge-demo", storeName: "orders" }),
        transport,
        autoSync: true,
      }),
    [],
  )

  return (
    <SyncForgeProvider engine={engine}>
      <DemoPanel />
    </SyncForgeProvider>
  )
}

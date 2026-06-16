import { useEffect, useMemo, useState } from "react"
import { createIndexedDbStorage, createSyncEngine, SyncEventTypes, type SyncOperation, type TransportAdapter } from "syncforge"
import { SyncForgeProvider, useSyncEngine, useSyncFlush, useSyncMutate, useSyncStatus } from "syncforge-react"

type Order = { id: string; label: string }

function createOrderStore() {
  const orders: Order[] = []

  return {
    orders,
    add(order: Order) {
      orders.push(order)
    },
    remove(id: string) {
      const index = orders.findIndex((order) => order.id === id)
      if (index !== -1) {
        orders.splice(index, 1)
      }
    },
  }
}

const orderStore = createOrderStore()
let failNextSend = false

const transport: TransportAdapter = {
  async send(operation: SyncOperation) {
    if (!navigator.onLine) {
      throw new Error("offline")
    }

    if (failNextSend) {
      failNextSend = false
      throw new Error("simulated server error")
    }

    if (operation.type !== "createOrder") {
      throw new Error(`Unknown operation: ${operation.type}`)
    }

    const payload = operation.payload as { label: string }
    console.info("[demo transport] synced order", payload.label)
  },
}

function useOrderList(): Order[] {
  const engine = useSyncEngine()
  const [, setRevision] = useState(0)

  useEffect(() => {
    const bump = () => setRevision((value) => value + 1)
    engine.on(SyncEventTypes.Optimistic, bump)
    engine.on(SyncEventTypes.Rollback, bump)
    return () => {
      engine.off(SyncEventTypes.Optimistic, bump)
      engine.off(SyncEventTypes.Rollback, bump)
    }
  }, [engine])

  return [...orderStore.orders]
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

function OrderList() {
  const orders = useOrderList()

  return (
    <ul className="orders">
      {orders.length === 0 ? (
        <li className="muted">No orders yet — create one optimistically.</li>
      ) : (
        orders.map((order) => <li key={order.id}>{order.label}</li>)
      )}
    </ul>
  )
}

function OrderForm() {
  const mutate = useSyncMutate()
  const flush = useSyncFlush()
  const engine = useSyncEngine()

  async function handleCreate() {
    const id = crypto.randomUUID()
    const label = `Order ${new Date().toLocaleTimeString()}`
    await mutate("createOrder", { id, label }, { optimisticData: { tempId: id } })
    await flush()
  }

  async function handleCreateFailing() {
    failNextSend = true
    const id = crypto.randomUUID()
    const label = `Failing order ${new Date().toLocaleTimeString()}`
    await mutate("createOrder", { id, label }, { optimisticData: { tempId: id } })
    await flush()
  }

  async function handleRetryFailed() {
    const failed = await engine.getFailed()
    if (failed.length === 0) {
      return
    }
    await engine.retry(failed[0]!.id)
    await flush()
  }

  return (
    <div className="actions">
      <button type="button" onClick={() => void handleCreate()}>
        Create order
      </button>
      <button type="button" onClick={() => void handleCreateFailing()}>
        Create (fail sync)
      </button>
      <button type="button" onClick={() => void handleRetryFailed()}>
        Retry failed
      </button>
    </div>
  )
}

function DemoPanel() {
  return (
    <main className="panel">
      <h1>SyncForge offline orders</h1>
      <p>Orders appear instantly via optimistic handlers. Failed syncs roll back the UI; use retry to re-queue.</p>
      <SyncIndicator />
      <OrderList />
      <OrderForm />
      <ol className="hint">
        <li>Open DevTools → Network → Offline</li>
        <li>
          Click <em>Create order</em> — list updates immediately; pending count increases
        </li>
        <li>Go online — auto sync flushes the queue</li>
        <li>
          Click <em>Create (fail sync)</em> — optimistic add, then rollback on terminal failure
        </li>
        <li>
          Click <em>Retry failed</em> — re-queues without re-running apply
        </li>
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
        maxRetries: 1,
        context: { orderStore },
        optimisticHandlers: {
          createOrder: {
            apply(operation, ctx) {
              const payload = operation.payload as Order
              ctx.orderStore.add(payload)
            },
            rollback(operation, _error, ctx) {
              const tempId = (operation.optimisticData as { tempId: string }).tempId
              ctx.orderStore.remove(tempId)
            },
          },
        },
      }),
    [],
  )

  return (
    <SyncForgeProvider engine={engine}>
      <DemoPanel />
    </SyncForgeProvider>
  )
}

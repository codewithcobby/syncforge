import { StorageError } from "./errors.js"
import type { StorageAdapter, SyncOperation } from "./types.js"

const QUEUE_DOCUMENT_KEY = "__syncforge_queue__"
const DEFAULT_DB_NAME = "syncforge"
const DEFAULT_STORE_NAME = "operations"

export interface IndexedDbStorageOptions {
  dbName?: string
  storeName?: string
}

function assertIndexedDbAvailable(): void {
  if (typeof globalThis.indexedDB === "undefined") {
    throw new StorageError(
      "IndexedDB is not available in this environment. createIndexedDbStorage() requires a browser with IndexedDB support.",
    )
  }
}

function openDatabase(dbName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1)

    request.onerror = () => {
      reject(new StorageError(`Failed to open IndexedDB database "${dbName}": ${request.error?.message ?? "unknown error"}`))
    }

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName)
      }
    }

    request.onsuccess = () => {
      resolve(request.result)
    }
  })
}

function runTransaction<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode)
    const store = transaction.objectStore(storeName)
    const request = operation(store)

    request.onerror = () => {
      reject(new StorageError(`IndexedDB transaction failed: ${request.error?.message ?? "unknown error"}`))
    }

    transaction.onerror = () => {
      reject(new StorageError(`IndexedDB transaction failed: ${transaction.error?.message ?? "unknown error"}`))
    }

    request.onsuccess = () => {
      resolve(request.result)
    }
  })
}

export function createIndexedDbStorage(options: IndexedDbStorageOptions = {}): StorageAdapter {
  assertIndexedDbAvailable()

  const dbName = options.dbName ?? DEFAULT_DB_NAME
  const storeName = options.storeName ?? DEFAULT_STORE_NAME
  let dbPromise: Promise<IDBDatabase> | null = null

  function getDatabase(): Promise<IDBDatabase> {
    if (!dbPromise) {
      dbPromise = openDatabase(dbName, storeName)
    }
    return dbPromise
  }

  return {
    async loadOperations(): Promise<SyncOperation[]> {
      const db = await getDatabase()
      const raw = await runTransaction<string | undefined>(db, storeName, "readonly", (store) => store.get(QUEUE_DOCUMENT_KEY))

      if (raw === undefined) {
        return []
      }

      try {
        return JSON.parse(raw) as SyncOperation[]
      } catch {
        throw new StorageError(`Failed to parse stored operations from IndexedDB database "${dbName}"`)
      }
    },

    async saveOperations(operations: SyncOperation[]): Promise<void> {
      const db = await getDatabase()
      await runTransaction<IDBValidKey>(db, storeName, "readwrite", (store) =>
        store.put(JSON.stringify(operations), QUEUE_DOCUMENT_KEY),
      )
    },
  }
}

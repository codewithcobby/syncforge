export class SyncForgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncForgeError";
  }
}

export class StorageError extends SyncForgeError {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

export class QueueError extends SyncForgeError {
  constructor(message: string) {
    super(message);
    this.name = "QueueError";
  }
}

export class TransportError extends SyncForgeError {
  constructor(message: string) {
    super(message);
    this.name = "TransportError";
  }
}

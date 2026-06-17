import type { SyncOperation, TransportAdapter } from "../../src/index.js"

export class MockTransport implements TransportAdapter {
  sent: SyncOperation[] = []

  async send(operation: SyncOperation): Promise<void> {
    this.sent.push({ ...operation })
  }
}

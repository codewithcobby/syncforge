# Large queue benchmark methodology

How to measure SyncForge queue behavior at scale. Reference numbers below are **sample measurements**, not SLAs or CI gates.

## How to run

```bash
# Default: 1k and 10k tiers, ~1 KB payloads (realistic CRUD)
pnpm benchmark:queue

# Stress test suite (timing + write amplification)
pnpm test:stress

# Single tier (e.g. 100k — manual only; may OOM with large payloads)
STRESS_N=100000 pnpm benchmark:queue

# Vary payload size
pnpm benchmark:queue --payload=minimal    # ~100 B
pnpm benchmark:queue --payload=realistic  # ~1 KB (default)
pnpm benchmark:queue --payload=large      # ~10 KB
pnpm benchmark:queue --payload-bytes=2048

# JSON artifact (manual GitHub workflow — do not commit)
pnpm benchmark:queue --json=benchmark-results.json
```

### Environment variables

| Variable   | Effect                                               |
| ---------- | ---------------------------------------------------- |
| `STRESS=1` | Enables stress-tier benchmarks in `pnpm test:stress` |
| `STRESS_N` | Single tier for benchmark script (e.g. `100000`)     |

### Adapters

| Adapter     | Purpose                                                     |
| ----------- | ----------------------------------------------------------- |
| `json`      | In-memory JSON round-trip; isolates engine + serialize cost |
| `indexeddb` | `fake-indexeddb` in Node; closer to browser IDB semantics   |

Re-run in Chrome DevTools for PWA teams — Node timings are directional, not browser guarantees.

## Scenarios

### Micro-benchmarks (per tier)

| Scenario               | What is measured                                                     |
| ---------------------- | -------------------------------------------------------------------- |
| `hydrate`              | First `inspect()` on cold engine; heap delta (before / after / Δ MB) |
| `mutate`               | Single `mutate()` on hydrated queue                                  |
| `persist`              | Direct `saveOperations()` of N ops                                   |
| `compact`              | `compact()` on N completed ops                                       |
| `post-compact-hydrate` | Reload after compact on empty completed backlog                      |

### Production-realistic shapes

| Scenario                  | Queue shape                                                |
| ------------------------- | ---------------------------------------------------------- |
| **A — completed backlog** | N completed → `compact()` → hydrate                        |
| **B — mixed flush**       | N total, 500 pending (at 100k), rest completed → `flush()` |
| **C — small pending**     | 10k total, 50 pending, rest completed → `flush()`          |

Avoid benchmarking "N pending flush" on an empty queue — real apps accumulate completed ops offline.

## Metrics

1. **Wall time (ms)** — `performance.now()` around each operation
2. **`saveOperations` call count** — flush write amplification (instrumented storage wrapper)
3. **Heap delta (MB)** — `process.memoryUsage().heapUsed` before/after hydrate

### Write amplification

SyncForge persists the **full queue array** on each flush status transition (~2 calls per successful pending op: syncing → completed).

| Pending ops | Expected `saveOperations` calls (approx.) |
| ----------- | ----------------------------------------- |
| 50          | ~100                                      |
| 500         | ~1000                                     |
| 1000        | ~2000                                     |

If call count ≫ 2× pending, investigate; if wall time dominates at small pending counts, the bottleneck is full-array JSON + IDB write size, not transport.

## Known architectural costs

- Single-document storage ([`src/indexeddb-storage.ts`](../src/indexeddb-storage.ts)) — one `JSON.stringify`/`put` per persist
- Per-transition persist during flush ([`src/sync-engine.ts`](../src/sync-engine.ts)) — up to ~3× writes per op on failure/retry paths
- Entire queue held in memory after hydrate

**Mitigation shipped:** `compact()` removes completed ops; `inspect()` is counts-only by default.

## Reference measurements

> **Not guarantees.** Collected on one machine; re-run locally with `pnpm benchmark:queue`.

```
Environment: Node 24.2.0 · darwin arm64 · syncforge 0.8.0
Payload: realistic (~1 KB per operation)
```

### 1k / 10k (json adapter, selected rows)

| Scenario      | Tier                | ms    | saveOps | heap Δ MB |
| ------------- | ------------------- | ----- | ------- | --------- |
| hydrate       | 1,000               | 1.2   | —       | -1.5      |
| hydrate       | 10,000              | 10.3  | —       | 5.0       |
| mutate        | 10,000              | 13.0  | 2       | —         |
| compact       | 10,000              | 11.5  | 1       | —         |
| C-mixed-flush | 10,000 (50 pending) | 1,270 | **100** | —         |

### 1k / 10k (indexeddb adapter, selected rows)

| Scenario      | Tier                | ms    | saveOps | heap Δ MB |
| ------------- | ------------------- | ----- | ------- | --------- |
| hydrate       | 10,000              | 8.3   | —       | 24.9      |
| C-mixed-flush | 10,000 (50 pending) | 1,436 | **100** | —         |

### 100k note

`STRESS_N=100000` with ~1 KB payloads **OOM'd** (~4 GB heap) on the reference machine during hydrate/micro-benchmarks. For 100k manual runs, use `--payload=minimal` or increase Node heap (`NODE_OPTIONS=--max-old-space-size=8192`). Treat 100k as exploratory, not a CI gate.

## Provisional guidance (recommendations, not SLAs)

| Observation                                                       | Recommendation                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 10k hydrate &lt; 15 ms (json) / &lt; 25 ms (IDB) at 1 KB payloads | Acceptable for typical PWAs if `compact()` keeps completed backlog low    |
| 50 pending flush on 10k total ~1.3 s                              | Plan flush UX accordingly; consider compacting before large sync sessions |
| 2× write amplification on flush                                   | Expected today; coalescing is a future optimization if needed             |
| 100k @ 1 KB OOM in Node                                           | Stay under ~50k completed without compact, or compact aggressively        |

## Valid outcomes

- **Outcome A (this release):** Benchmarks acceptable → ship methodology + README guidance only
- **Outcome B:** Unacceptable flush/hydrate cost → separate PR for scoped optimizations (e.g. flush persist coalescing)
- **Outcome C:** Sharded IDB / Worker flush → future issue only if docs cannot mitigate

## CI integration

- **Default CI:** `large-queue.stress.test.ts` Layer A smoke (1k, functional, 30s ceiling)
- **Stress workflow (manual):** `workflow_dispatch` runs `pnpm test:stress` + `pnpm benchmark:queue --json=benchmark-results.json` (artifact only)

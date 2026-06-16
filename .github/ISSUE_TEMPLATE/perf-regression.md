---
name: Performance Regression
about: Report slow flushes, memory growth, or queue scaling issues
title: "[perf] "
labels: "performance, needs-triage"
assignees: ""
---

## Summary

What feels slow or resource-heavy?

## Scenario

|                        | Details                              |
| ---------------------- | ------------------------------------ |
| **syncforge version**  |                                      |
| **Runtime**            | <!-- Browser / Node.js + version --> |
| **Pending operations** | <!-- e.g. 500 queued mutations -->   |
| **Storage adapter**    |                                      |
| **Transport adapter**  | <!-- real network or mock -->        |

## What you measured

- **Operation** (`mutate`, `flush`, `getPending`, hydration on startup):
- **Duration**: <!-- e.g. flush took ~8s for 200 ops -->
- **Memory** (if known): <!-- e.g. heap grew 120MB after 10k ops -->
- **Frequency**: <!-- once, every flush, after reload -->

## Reproduction

```typescript
// Minimal benchmark or loop that shows the regression
```

1.
2.
3.

## Baseline (if known)

<!-- Previous version, expected threshold, or "first time measuring" -->

## Impact

- [ ] Blocks production use
- [ ] Noticeable in dev only
- [ ] Theoretical / optimization idea

## Profiling data (optional)

```
Paste benchmark output, heap snapshot notes, or perf traces
```

## Before submitting

- [ ] I included queue size and which API call is slow
- [ ] I provided a reproducible snippet or steps
- [ ] I searched [existing issues](https://github.com/codewithcobby/syncforge/issues)

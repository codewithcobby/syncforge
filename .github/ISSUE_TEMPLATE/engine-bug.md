---
name: Engine Bug
about: Report incorrect behavior in SyncForge core (mutate, flush, queue, retries, events)
title: "[engine] "
labels: "bug, engine, needs-triage"
assignees: ""
---

## What went wrong?

Describe the unexpected behavior in plain language.

## SyncForge setup

- **syncforge version**: <!-- e.g. 0.1.0 -->
- **Runtime**: <!-- Browser / Node.js / Bun + version -->
- **Framework** (if any): <!-- React, Vue, Next.js, vanilla, etc. -->
- **Storage adapter**: <!-- createMemoryStorage, custom, none -->
- **Transport adapter**: <!-- custom REST, fetch wrapper, mock, etc. -->

## Minimal reproduction

```typescript
// Paste the smallest code sample that reproduces the issue.
import { createSyncEngine } from "syncforge"

// ...
```

Steps:

1.
2.
3.

## Expected vs actual

|              | Result |
| ------------ | ------ |
| **Expected** |        |
| **Actual**   |        |

## Operation details (if relevant)

- **Operation type** (`mutate` first arg):
- **Payload shape**:
- **Operation status after issue** (`pending`, `syncing`, `completed`, `failed`):
- **Flush result** (`{ successful, failed }`):

## Logs / errors

```
Paste stack traces or console output here
```

## Extra context

Screenshots, network tab details, or a link to a reproduction repo.

## Before submitting

- [ ] I searched [existing issues](https://github.com/codewithcobby/syncforge/issues)
- [ ] I can reproduce this on the latest version
- [ ] I included version, runtime, and a minimal example

---
name: Enhancement Proposal
about: Propose a new capability for SyncForge core or official adapters
title: "[proposal] "
labels: "enhancement, needs-triage"
assignees: ""
---

## Proposal in one line

<!-- e.g. "Add autoSync when navigator.onLine becomes true" -->

## Problem

What pain does this solve for offline-first apps using SyncForge?

## Proposed API (sketch)

```typescript
// Rough API shape — does not need to be final
```

## Scope

Which area does this touch?

- [ ] Core engine (`mutate`, `flush`, lifecycle)
- [ ] Transport adapter contract
- [ ] Storage adapter contract
- [ ] Retry strategies
- [ ] Events / observability
- [ ] Framework integration (React, etc.)
- [ ] New official adapter (IndexedDB, etc.)

## Alternatives considered

<!-- Other ways to solve the same problem, with or without SyncForge -->

## Alignment with roadmap

Does this relate to an existing roadmap item?

- [ ] Automatic sync on reconnect
- [ ] IndexedDB storage
- [ ] Exponential / linear retry strategies
- [ ] Optimistic updates
- [ ] React integration
- [ ] Not on roadmap — explain why it still belongs in core

## Acceptance criteria

- [ ]
- [ ]

## Before submitting

- [ ] I searched [existing issues](https://github.com/codewithcobby/syncforge/issues)
- [ ] I explained the problem, not just the solution
- [ ] I kept the proposal scoped to SyncForge's core mission (mutation queue + sync)

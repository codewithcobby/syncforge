---
name: Security Advisory
about: Report a vulnerability in SyncForge or unsafe patterns in adapters
title: "[security] "
labels: "security, needs-triage"
assignees: ""
---

## Report type

- [ ] Vulnerability in SyncForge core
- [ ] Unsafe default in an official adapter
- [ ] Dependency vulnerability affecting SyncForge
- [ ] Security hardening suggestion
- [ ] Question about secure usage

## Severity (your assessment)

- [ ] Critical — exploitable with serious impact
- [ ] High
- [ ] Medium
- [ ] Low

## Affected surface

- [ ] Persisted operation data (storage adapter)
- [ ] Data sent via transport adapter
- [ ] Operation payload handling / serialization
- [ ] Retry / flush concurrency
- [ ] Dependency supply chain
- [ ] Documentation encouraging unsafe patterns
- [ ] Other: <!-- specify -->

## Description

Clear explanation of the concern. **Do not include live exploit payloads in public issues.**

## Reproduction (if applicable)

1.
2.
3.

## Impact

Who is affected and what could happen? (data leak, duplicate sends, denial of service, etc.)

## Environment

- **syncforge version**:
- **Runtime**:
- **Custom storage or transport**: yes / no

## Suggested mitigation (optional)

## Responsible disclosure

- [ ] I have **not** posted exploit details publicly elsewhere
- [ ] For critical issues, I am open to coordinating privately before public disclosure

> **Critical vulnerabilities:** prefer private disclosure first (GitHub private security advisory or maintainer contact) rather than a public issue with full exploit details.

## Before submitting

- [ ] I described impact without unnecessary exploit detail
- [ ] I included the affected version and component

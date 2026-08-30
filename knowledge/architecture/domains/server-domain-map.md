---
title: Server & Live Portal — Domain Context Map
type: domain-context-map
domain: server
parent_map: ../context-map.md
description: Deep-dive context map for the Express web server, SSE event bridge, and live web portal dashboard.
tags:
  - domain-map
  - server
  - portal
---

# Server & Live Portal — Domain Context Map

[← Back to Root Context Map](../context-map.md)

## Domain Purpose & Responsibilities

The **Server & Live Portal** domain provides an interactive dashboard and real-time visualization layer for the codebase. It spins up an Express server serving a single-page portal, connects to a file system watcher (`chokidar`), and streams Server-Sent Events (SSE) to connected clients when specifications or code change.

---

## Key Files & Sidecars

| File / Sidecar                                                                                             | Purpose & Exported Symbols                                          | Depends On                                 |
| :--------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------ | :----------------------------------------- |
| [`src/server/portal.ts`](../../src/server/portal.ts) / [`portal.ts.md`](../../src/server/portal.ts.md)     | `PortalServer` serving static portal assets and handling API routes | `watcher.ts`, `graph/engine.ts`, `express` |
| [`src/server/watcher.ts`](../../src/server/watcher.ts) / [`watcher.ts.md`](../../src/server/watcher.ts.md) | File watcher broadcasting changes across the SSE event bridge       | `chokidar`                                 |

---

## Domain Invariants

- The server defaults to port 3000 but can be configured via CLI `--port` flags.
- SSE streams push graph mutations, reconciliation events, and file status changes in real time.

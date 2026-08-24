---
title: Graph Engine — Domain Context Map
type: domain-context-map
domain: graph
parent_map: ../context-map.md
description: Deep-dive context map for the SQLite-backed GraphEngine, schema definitions, and node persistence.
tags:
  - domain-map
  - graph
  - sqlite
---

# Graph Engine — Domain Context Map

[← Back to Root Context Map](../context-map.md)

## Domain Purpose & Responsibilities
The **Graph Engine** manages repository-wide dependency relationships, node states, frontmatter metadata, and OKF structural entities. It stores all graph topology in SQLite (`.stubs/graph.sqlite`), allowing fast querying of module statuses, dependencies, and bi-directional edges without rescanning the filesystem on every operation.

---

## Key Files & Sidecars

| File / Sidecar | Purpose & Exported Symbols | Depends On |
| :--- | :--- | :--- |
| [`src/graph/engine.ts`](file:///Users/lappier/code/projects/stubs/src/graph/engine.ts) / [`engine.ts.md`](file:///Users/lappier/code/projects/stubs/src/graph/engine.ts.md) | Central `GraphEngine` class managing SQLite queries, transactions, and state updates | `schema.ts`, `better-sqlite3` |
| [`src/graph/schema.ts`](file:///Users/lappier/code/projects/stubs/src/graph/schema.ts) / [`schema.ts.md`](file:///Users/lappier/code/projects/stubs/src/graph/schema.ts.md) | Table schemas (`nodes`, `edges`, `proposals`), indexes, and migrations | `better-sqlite3` |
| [`src/graph/index.ts`](file:///Users/lappier/code/projects/stubs/src/graph/index.ts) / [`index.ts.md`](file:///Users/lappier/code/projects/stubs/src/graph/index.ts.md) | Domain barrel exports for `GraphEngine` and types | `engine.ts`, `schema.ts` |

---

## Domain Invariants
- SQLite databases are opened with WAL (Write-Ahead Logging) mode enabled for concurrent read/write support.
- All node paths stored in the graph must be relative to the repository root for portability.

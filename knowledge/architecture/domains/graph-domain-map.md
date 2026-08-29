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

| File / Sidecar                                                                                                                                                              | Purpose & Exported Symbols                                                                                                         | Depends On                 |
| :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- | :------------------------- |
| [`src/graph/engine.ts`](file:///Users/lappier/code/projects/stubs/src/graph/engine.ts) / [`engine.ts.md`](file:///Users/lappier/code/projects/stubs/src/graph/engine.ts.md) | Central `GraphEngine` class managing SQLite queries, schema tables (`graph_nodes`, `graph_edges`), transactions, and state updates | `sql.js`, `better-sqlite3` |
| [`src/graph/extractor.ts`](file:///Users/lappier/code/projects/stubs/src/graph/extractor.ts)                                                                                | AST & multi-language symbol, call, import, and OKF link extraction for TS, JS, Python, Rust, Go                                    | `typescript`, `parser/okf` |
| [`src/graph/topology.ts`](file:///Users/lappier/code/projects/stubs/src/graph/topology.ts)                                                                                  | `TopologyEngine` managing blast radius traversal, BFS shortest path, Tarjan SCC cycle detection, and God Node centrality           | `extractor.ts`             |

---

## Domain Invariants

- SQLite databases are opened with WAL (Write-Ahead Logging) mode enabled for concurrent read/write support.
- All node paths stored in the graph must be relative to the repository root for portability.

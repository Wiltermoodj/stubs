---
title: Stubs Framework — Architecture Context Map
type: context-map
description: Master architectural context map for the stubs specification framework, indexing core domains and linking to domain-specific context maps.
tags:
  - architecture
  - context-map
  - stubs
---

# Stubs Framework — Architecture Context Map

`stubs` is an AI agent skill and specification-first software engineering framework. It bridges natural language architecture intent with executable multi-language codebases using **Open Knowledge Format (OKF)** Markdown sidecars (`*.ts.md`, `*.py.md`, `*.go.md`).

---

## High-Level Subsystem Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                   CLI / Developer Entry Point                    │
│           src/cli.ts  →  src/cli/router.ts ('stubs ...')         │
└───────────────────────┬──────────────────────────────────────────┘
                        │ routes to
     ┌──────────────────┼─────────────────────────┬────────────────┐
     ▼                  ▼                         ▼                ▼
┌──────────────┐ ┌──────────────┐          ┌──────────────┐ ┌──────────────┐
│ GrillEngine  │ │ Materializer │          │SandingEngine │ │ PortalServer │
│ src/grill/   │ │ src/         │          │ src/sanding/ │ │ src/server/  │
│              │ │ materializer/│          │              │ │              │
└──────┬───────┘ └──────┬───────┘          └──────┬───────┘ └──────┬───────┘
       │                │                         │                │
       └────────────────┼─────────────────────────┴────────────────┘
                        │ all query/persist through
                        ▼
                 ┌──────────────┐
                 │ GraphEngine  │ ◄─── Autonomy Protocol (src/autonomy/)
                 │  src/graph/  │ ◄─── Template Engine (src/templates/)
                 │(SQLite State)│
                 └──────────────┘
```

---

## Core Domains & Domain Map Index

Each domain in the `stubs` framework has a dedicated deep-dive context map located in [`knowledge/architecture/domains/`](domains/).

| Domain | Subsystem Responsibility | Context Map Link |
| :--- | :--- | :--- |
| **Graph Engine** | SQLite-backed dependency graphs, node states, and OKF entity queries | [Graph Domain Map](domains/graph-domain-map.md) |
| **Sanding & Sync Engine** | AST-based bi-directional synchronization and drift reconciliation | [Sanding Domain Map](domains/sanding-domain-map.md) |
| **Materializer Engine** | Multi-language code extraction, compilation checks, and disk writing | [Materializer Domain Map](domains/materializer-domain-map.md) |
| **Interactive Grill Engine**| Dynamic spec interrogation, frontier-based Q&A, and design recording | [Grill Domain Map](domains/grill-domain-map.md) |
| **Server & Live Portal** | Local Express/SSE background daemon, file watcher, and dashboard UI | [Server Domain Map](domains/server-domain-map.md) |
| **Autonomy Protocol** | Permission gates, human-in-the-loop policies, and action proposals | [Autonomy Domain Map](domains/autonomy-domain-map.md) |
| **CLI & Router** | Argument parsing, sub-command dispatching, and skill installer | [CLI Domain Map](domains/cli-domain-map.md) |

---

## Architectural Principles

1. **Deep Modules:** Large, simple interface contracts hiding dense implementation details.
2. **Pulling Complexity Downward:** Consumers should not have to manage low-level details (e.g. `CliRouter` handles CLI parsing cleanly, `SandingEngine` isolates AST hashing).
3. **Specification as Single Source of Truth:** Code is a derivative artifact materialized from or sanded into sidecar specs (`*.<ext>.md`).

---
title: stubs — Subsystem Index
type: subsystem-index
description: >-
  Top-level Open Knowledge Format context map for the stubs codebase. Provides
  the authoritative dependency graph, module status matrix, and architectural
  overview for the specification-first AI development framework.
tags:
  - index
  - okf
  - architecture
  - context-map
status: spec
version: 1
target_code_file: ./index.ts
status_flag: clean
exports:
  - GraphEngine
  - CliRouter
  - PortalServer
  - TemplateEngine
  - AutonomyProtocol
  - SandingEngine
  - MaterializerEngine
  - parseOkfSpec
  - loadConfig
---

# stubs — Subsystem Index

`stubs` is a specification-first AI software development framework. It enforces an **Open Knowledge Format (OKF)** intermediate layer between natural language intent and executable TypeScript code. Every source file has a paired `*.ts.md` sidecar specification that lives alongside it, forming the canonical source of truth for the module's design, decisions, and implementation contract.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        CLI Entry Point                           │
│                     src/cli.ts → cli/router.ts                   │
└───────────────────────┬──────────────────────────────────────────┘
                        │ routes to
          ┌─────────────┼──────────────────────────┐
          │             │                          │
    ┌─────▼──────┐  ┌───▼──────────┐  ┌───────────▼──────────┐
    │ GrillEngine│  │Materializer  │  │  SandingEngine        │
    │ src/grill/ │  │ src/         │  │  src/sanding/         │
    │            │  │ materializer/│  │                       │
    └─────┬──────┘  └───┬──────────┘  └───────────┬──────────┘
          │             │                          │
          └─────────────┼──────────────────────────┘
                        │ all depend on
          ┌─────────────┴─────────────────────────┐
          │                                       │
    ┌─────▼──────┐                     ┌──────────▼──────────┐
    │ GraphEngine│◄────────────────────│  AutonomyProtocol   │
    │ src/graph/ │                     │  src/autonomy/      │
    └─────┬──────┘                     └─────────────────────┘
          │ uses
    ┌─────▼──────────────────────────────────────┐
    │                Storage Layer               │
    │    NodeFileSystem / BetterSqliteDriver     │
    │    WasmSqliteDriver  (src/storage/)        │
    └─────┬──────────────────────────────────────┘
          │
    ┌─────▼──────────────────────────────────────┐
    │        Parser Layer (src/parser/)          │
    │  parseOkfSpec · extractImplementationCode  │
    │  getAstStructuralHash (src/parser/ast.ts)  │
    └────────────────────────────────────────────┘
```

---

## Module Status Matrix

| Module Sidecar                                             | Target File               | Status | Status Flag |
| ---------------------------------------------------------- | ------------------------- | ------ | ----------- |
| [config/schema.ts.md](./config/schema.ts.md)               | `config/schema.ts`        | `spec` | `clean`     |
| [parser/okf.ts.md](./parser/okf.ts.md)                     | `parser/okf.ts`           | `spec` | `clean`     |
| [parser/markdown.ts.md](./parser/markdown.ts.md)           | `parser/markdown.ts`      | `spec` | `clean`     |
| [parser/ast.ts.md](./parser/ast.ts.md)                     | `parser/ast.ts`           | `spec` | `clean`     |
| [storage/index.ts.md](./storage/index.ts.md)               | `storage/index.ts`        | `spec` | `clean`     |
| [storage/containment.ts.md](./storage/containment.ts.md)   | `storage/containment.ts`  | `spec` | `clean`     |
| [storage/credentials.ts.md](./storage/credentials.ts.md)   | `storage/credentials.ts`  | `spec` | `clean`     |
| [graph/engine.ts.md](./graph/engine.ts.md)                 | `graph/engine.ts`         | `spec` | `clean`     |
| [grill/engine.ts.md](./grill/engine.ts.md)                 | `grill/engine.ts`         | `spec` | `clean`     |
| [materializer/engine.ts.md](./materializer/engine.ts.md)   | `materializer/engine.ts`  | `spec` | `clean`     |
| [sanding/engine.ts.md](./sanding/engine.ts.md)             | `sanding/engine.ts`       | `spec` | `clean`     |
| [sanding/ast.ts.md](./sanding/ast.ts.md)                   | `sanding/ast.ts`          | `spec` | `clean`     |
| [autonomy/protocol.ts.md](./autonomy/protocol.ts.md)       | `autonomy/protocol.ts`    | `spec` | `clean`     |
| [compiler/typechecker.ts.md](./compiler/typechecker.ts.md) | `compiler/typechecker.ts` | `spec` | `clean`     |
| [templates/engine.ts.md](./templates/engine.ts.md)         | `templates/engine.ts`     | `spec` | `clean`     |
| [cli/router.ts.md](./cli/router.ts.md)                     | `cli/router.ts`           | `spec` | `clean`     |
| [server/portal.ts.md](./server/portal.ts.md)               | `server/portal.ts`        | `spec` | `clean`     |
| [server/github.ts.md](./server/github.ts.md)               | `server/github.ts`        | `spec` | `clean`     |
| [web/index.ts.md](./web/index.ts.md)                       | `web/index.ts`            | `spec` | `clean`     |

---

## Dependency Layers (Bottom-Up)

### Layer 0 — Foundation

- **`config/schema.ts`** — `StubsConfig` interface and `loadConfig()`. All engines depend on this.

### Layer 1 — Storage Abstraction

- **`storage/index.ts`** — `FileStorageDriver`, `DatabaseDriver`, `NodeFileSystem`, `BetterSqliteDriver`, `WasmSqliteDriver`. Enables dual Node.js/WASM execution.
- **`storage/containment.ts`** — Path containment safety guard.
- **`storage/credentials.ts`** — GitHub PAT secure storage; global console masking for secret suppression.

### Layer 2 — Parsing

- **`parser/okf.ts`** — OKF sidecar parser. Validates YAML frontmatter and returns `ParsedOkfSpec`.
- **`parser/markdown.ts`** — Extracts and replaces `## Implementation` TypeScript code blocks.
- **`parser/ast.ts`** — Markdown → AST tokenizer (used by materializer).

### Layer 3 — Graph & Database

- **`graph/engine.ts`** — `GraphEngine` manages the SQLite adjacency graph + FTS5 index. Stores all sidecar metadata, dependency edges, and search indices.

### Layer 4 — Engines

- **`grill/engine.ts`** — `GrillEngine` state machine: INIT → PARSING → GENERATING_QUESTIONS → GRILLING → SAVING → DONE.
- **`materializer/engine.ts`** — `MaterializerEngine`: reads sidecar, extracts code, type-checks, writes atomically, updates graph.
- **`sanding/engine.ts`** — `SandingEngine`: bi-directional AST hash reconciliation between `*.ts` and `*.ts.md`.
- **`sanding/ast.ts`** — AST structural hash computation using TypeScript compiler API.
- **`autonomy/protocol.ts`** — `AutonomyProtocol`: 3-tier autonomy gate, 5-phase reconciliation engine, drift detection.
- **`compiler/typechecker.ts`** — In-memory `tsc` type-check runner.
- **`templates/engine.ts`** — `TemplateEngine`: renders Handlebars → EJS template molds for sidecar scaffolding.

### Layer 5 — Interface

- **`cli/router.ts`** — `CliRouter`: routes CLI commands to engines.
- **`server/portal.ts`** — `PortalServer`: Express HTTP + SSE server, ego-graph API, Web Portal UI bundle.
- **`server/github.ts`** — GitHub API integration (PAT auth, branch/file read/write).
- **`web/index.ts`** — Client-side PWA bundle (WASM SQLite, ego-graph visualization).

---

## Core Concepts

### Dual-File Paradigm

Every `.ts` production file is paired 1:1 with a `.ts.md` sidecar specification in the same directory. The sidecar is the specification source of truth; the code file is the materialized output.

### OKF Frontmatter

YAML frontmatter with required fields: `title`, `type`, `description`, `tags`, `status`, `version`, `target_code_file`, `status_flag`. Optional: `depends_on`, `used_by`, `exports`, `decisions`, `user_notes`, `sync_state`.

### 3-Tier Autonomy Matrix

- `strict_gate` — Agent may draft proposals; all writes require explicit human approval.
- `guided_execution` — Agent may scaffold sidecars; code materialization still requires approval.
- `autonomous` — Agent may materialize code without human approval gates.

### Grill Depth Levels

- `light_probe` — 3 surface questions.
- `standard_drill` — 5–7 design-focused questions.
- `deep_interrogation` — 10+ edge-case and failure-mode questions.

### Code Sanding

Bi-directional synchronization using SHA-256 content hashes and AST structural hashes. When a `*.ts` file is newer than the sidecar, code is sanded back into the spec; when the sidecar is newer, it is materialized into code.

### Status Lifecycle

`skeleton` → `spec` → `grilling` → `partially-materialized` → `materialized` → `implemented`

### Status Flags

`clean` | `dependency-stale` | `template-outdated` | `template-realign-required` | `needs-human-review-resolution` | `typecheck-failed`

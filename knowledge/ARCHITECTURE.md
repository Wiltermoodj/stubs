# stubs — Architecture Context Map

> **Purpose:** Fast-load context for AI agents. Read this first. Follow links for deeper detail.

---

## What stubs Is

`stubs` is a **specification-first AI software development framework**. It enforces an Open Knowledge Format (OKF) intermediate layer between natural language intent and executable TypeScript code.

Every `.ts` production file is paired 1:1 with a `.ts.md` **sidecar specification** in the same directory. The sidecar is the source of truth; the `.ts` file is the materialized output.

**Key workflow:** `Prompt → Sidecar Spec (.ts.md) → Grill → Materialize → Sand → Code (.ts)`

---

## Repository Layout

```
stubs/
├── src/                          ← All application source code
│   ├── INDEX.md                  ← OKF subsystem index (full module map)
│   ├── cli.ts                    ← CLI entry point (thin bootstrap)
│   ├── index.ts                  ← Library exports
│   ├── autonomy/                 ← 3-tier gate + 5-phase reconciliation engine
│   ├── cli/                      ← Command router (all commands dispatched here)
│   ├── compiler/                 ← In-memory TypeScript typechecker
│   ├── config/                   ← StubsConfig interface + loadConfig()
│   ├── graph/                    ← SQLite adjacency graph + FTS5 search
│   ├── grill/                    ← Interactive spec interrogation state machine
│   ├── materializer/             ← Sidecar → executable .ts code
│   ├── parser/                   ← OKF frontmatter + Markdown + AST parsers
│   ├── sanding/                  ← Bi-directional spec/code sync + AST hash
│   ├── server/                   ← Express HTTP portal + SSE + GitHub API
│   ├── storage/                  ← FileSystem + SQLite driver abstractions
│   ├── templates/                ← Handlebars/EJS template rendering
│   └── web/                      ← Browser PWA bundle + WASM SQLite client
├── .agents/skills/stubs/         ← Compiled CLI skill bundle
│   ├── dist/cli.cjs              ← ← CLI binary — invoke via: node .agents/skills/stubs/dist/cli.cjs
│   └── sub-skills/               ← Grilling, Sanding, Materialization, Auditing skill docs
├── .stubs/                       ← Runtime workspace state (gitignored contents)
│   ├── config.json               ← Active workspace configuration
│   ├── graph.sqlite              ← SQLite sidecar dependency graph + FTS5 index
│   └── templates/                ← Local template molds (.ts.md.tpl)
├── knowledge/
│   ├── ARCHITECTURE.md           ← ← You are here
│   └── design/                   ← UI/UX ADR corpus (ADR 0015–0045)
├── tests/                        ← Jest test suite
├── scripts/                      ← Build and deploy scripts
├── public/                       ← Static web assets
├── AGENTS.md                     ← Agent conventions + toolchain rules
├── README.md                     ← Human-facing project overview
├── RULES.md                      ← Design system routing matrix
└── package.json                  ← npm scripts: build, test, lint, format, start
```

---

## Dependency Layer Map

Read bottom-up — each layer depends only on layers below it.

| Layer              | Modules                                                                                                                                                                                                                                                                                     | Key Exports                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **0 — Foundation** | [`src/config/schema.ts`](../src/config/schema.ts)                                                                                                                                                                                                                                           | `StubsConfig`, `loadConfig()`                                                        |
| **1 — Storage**    | [`src/storage/index.ts`](../src/storage/index.ts) · [`containment.ts`](../src/storage/containment.ts) · [`credentials.ts`](../src/storage/credentials.ts)                                                                                                                                   | `NodeFileSystem`, `BetterSqliteDriver`, `WasmSqliteDriver`, `resolveContainedPath()` |
| **2 — Parser**     | [`src/parser/okf.ts`](../src/parser/okf.ts) · [`markdown.ts`](../src/parser/markdown.ts) · [`ast.ts`](../src/parser/ast.ts)                                                                                                                                                                 | `parseOkfSpec()`, `extractImplementationCode()`                                      |
| **3 — Compiler**   | [`src/compiler/typechecker.ts`](../src/compiler/typechecker.ts)                                                                                                                                                                                                                             | `typeCheckVirtualFile()`                                                             |
| **4 — Graph**      | [`src/graph/engine.ts`](../src/graph/engine.ts)                                                                                                                                                                                                                                             | `GraphEngine` (SQLite + FTS5)                                                        |
| **5 — Engines**    | [`src/grill/engine.ts`](../src/grill/engine.ts) · [`src/materializer/engine.ts`](../src/materializer/engine.ts) · [`src/sanding/engine.ts`](../src/sanding/engine.ts) · [`src/autonomy/protocol.ts`](../src/autonomy/protocol.ts) · [`src/templates/engine.ts`](../src/templates/engine.ts) | `GrillEngine`, `MaterializerEngine`, `SandingEngine`, `AutonomyProtocol`             |
| **6 — Interface**  | [`src/cli/router.ts`](../src/cli/router.ts) · [`src/server/portal.ts`](../src/server/portal.ts) · [`src/server/github.ts`](../src/server/github.ts) · [`src/web/index.ts`](../src/web/index.ts)                                                                                             | `CliRouter`, `PortalServer`                                                          |

---

## Core Concepts

### OKF Sidecar Spec (`*.ts.md`)

A Markdown file with YAML frontmatter that documents a TypeScript module. Required frontmatter fields: `title`, `type`, `description`, `tags`, `status`, `version`, `target_code_file`, `status_flag`. Optional: `depends_on`, `used_by`, `exports`, `decisions`, `user_notes`, `sync_state`.

- **`type`**: `subsystem-index` | `sidecar-spec` | `module-stub`
- **`status`**: `skeleton → spec → grilling → partially-materialized → materialized → implemented`
- **`status_flag`**: `clean` | `dependency-stale` | `template-outdated` | `typecheck-failed` | `needs-human-review-resolution`

### 3-Tier Autonomy Matrix

Configured via `autonomy_level` in `.stubs/config.json`. Controls what an AI agent may do without human approval:

| Level              | Can scaffold sidecar? | Can write `.ts` code? |
| ------------------ | --------------------- | --------------------- |
| `strict_gate`      | ❌                    | ❌                    |
| `guided_execution` | ✅                    | ❌                    |
| `autonomous`       | ✅                    | ✅                    |

### GraphEngine (`graph/engine.ts`)

SQLite database at `.stubs/graph.sqlite`. Tables: `sidecars` (all frontmatter fields), `dependencies` (adjacency edges), `sidecars_fts` (FTS5 full-text). All file paths are POSIX-normalized.

### Code Sanding (`sanding/engine.ts`)

Bi-directional sync using SHA-256 content hashes + TypeScript AST structural hashes. Timestamp vectors determine direction when both files have changed. AST hash equality means cosmetic reformats are no-ops.

### Grill Depth Levels

`light_probe` (3 questions) → `standard_drill` (5–7) → `deep_interrogation` (10+)

---

## CLI Commands Quick Reference

```bash
# All commands via the compiled binary:
node .agents/skills/stubs/dist/cli.cjs <command> [options]

stubs init                          # Write .stubs/config.json
stubs validate src/parser/okf.ts.md # Validate OKF frontmatter
stubs grill src/foo.ts.md           # Interactive spec interrogation
stubs materialize src/foo.ts.md     # Extract code → write foo.ts
stubs sand [src/foo.ts.md]          # Bi-directional sync (whole workspace if no file)
stubs audit src/foo.ts.md           # 5-phase retroactive reconciliation
stubs serve [--port 3000]           # Start Web Portal + SSE server
stubs template list                 # List template molds in .stubs/templates/
```

---

## Full Module Sidecar Index

Each module has a paired `*.ts.md` sidecar with interface contracts, design decisions, and dependency links. See [`src/INDEX.md`](../src/INDEX.md) for the complete module status matrix.

Individual sidecars:

| Module                        | Sidecar Spec                                                    |
| ----------------------------- | --------------------------------------------------------------- |
| `src/config/schema.ts`        | [`schema.ts.md`](../src/config/schema.ts.md)                    |
| `src/storage/index.ts`        | [`storage/index.ts.md`](../src/storage/index.ts.md)             |
| `src/storage/containment.ts`  | [`containment.ts.md`](../src/storage/containment.ts.md)         |
| `src/storage/credentials.ts`  | [`credentials.ts.md`](../src/storage/credentials.ts.md)         |
| `src/parser/okf.ts`           | [`okf.ts.md`](../src/parser/okf.ts.md)                          |
| `src/parser/markdown.ts`      | [`markdown.ts.md`](../src/parser/markdown.ts.md)                |
| `src/parser/ast.ts`           | [`parser/ast.ts.md`](../src/parser/ast.ts.md)                   |
| `src/compiler/typechecker.ts` | [`typechecker.ts.md`](../src/compiler/typechecker.ts.md)        |
| `src/graph/engine.ts`         | [`graph/engine.ts.md`](../src/graph/engine.ts.md)               |
| `src/grill/engine.ts`         | [`grill/engine.ts.md`](../src/grill/engine.ts.md)               |
| `src/materializer/engine.ts`  | [`materializer/engine.ts.md`](../src/materializer/engine.ts.md) |
| `src/sanding/engine.ts`       | [`sanding/engine.ts.md`](../src/sanding/engine.ts.md)           |
| `src/sanding/ast.ts`          | [`sanding/ast.ts.md`](../src/sanding/ast.ts.md)                 |
| `src/autonomy/protocol.ts`    | [`autonomy/protocol.ts.md`](../src/autonomy/protocol.ts.md)     |
| `src/templates/engine.ts`     | [`templates/engine.ts.md`](../src/templates/engine.ts.md)       |
| `src/cli/router.ts`           | [`cli/router.ts.md`](../src/cli/router.ts.md)                   |
| `src/server/portal.ts`        | [`server/portal.ts.md`](../src/server/portal.ts.md)             |
| `src/server/github.ts`        | [`server/github.ts.md`](../src/server/github.ts.md)             |
| `src/web/index.ts`            | [`web/index.ts.md`](../src/web/index.ts.md)                     |

---

## Key Design Principles

From [`RULES.md`](../RULES.md) and the codebase philosophy:

- **Deep Modules:** Simple public interfaces that conceal rich internal logic.
- **Pull Complexity Downward:** Engines absorb parsing, validation, and error handling — callers get clean results or typed errors, never raw exceptions.
- **Define Errors Out of Existence:** Prefer explicit `Result<T, E>` returns and idempotent APIs. `loadConfig()`, `parseOkfSpec()`, and all engine constructors never throw.
- **Context Objects:** Group session/environment state into unified parameters (`StubsConfig`, `GrillEngineOptions`, `CliContext`) to prevent parameter pass-through clutter.
- **Self-Healing Frontmatter:** `healCorruptedFrontmatter()` in `sanding/engine.ts` recovers from YAML parse failures — the sanding engine never aborts on a corrupted sidecar.

---

## Build & Runtime Notes

- **Build target:** Node.js 18+. Bundled as a single `cli.cjs` CommonJS file via `esbuild`.
- **Native dep:** `sqlite3` (native addon). Falls back to `sql.js` WASM if unavailable.
- **Web bundle:** `npm run build:web` → `dist/web/` (static HTML+JS+CSS for PWA/GitHub Pages).
- **TypeScript:** `strict: true`, `ESNext` target, compiled with `tsc` for type-checking, bundled with `esbuild`.
- **Tests:** Jest + `ts-jest`. Run with `npm test`.

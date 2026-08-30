# `stubs` — Specification-First AI Software Development

AI has changed how we write code, but it shouldn't change the way we engineer it. `stubs` is an architectural framework, local execution engine, and AI agent protocol for building, maintaining, and evolving complex codebases.

Standard agent prompting often leads to architectural drift, broken types, and token-heavy refactoring loops. `stubs` offers an intermediate **sidecar specification & architecture planning phase**.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CORE DUAL-FILE PARADIGM                           │
├──────────────────────────────────────┬──────────────────────────────────────┤
│    Specification Layer (*.<ext>.md)  │     Executable Source Layer (*.<ext>)│
├──────────────────────────────────────┼──────────────────────────────────────┤
│ • Open Knowledge Format (OKF) sidecar│ • Production-ready executable code   │
│ • YAML frontmatter & graph links     │ • Generated/materialized from spec   │
│ • Defines interfaces, ADRs, & types  │ • Header-linked via @sidecar comment │
│ • Holds human notes & directives     │ • Kept in sync via Code Sanding      │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

---

## Installation & Updating

### 1. Install via `npx` / `npm` (Recommended)

Install `stubs` into your project workspace or global environment:

```bash
# Add as a dev dependency (recommended)
npm install -D github:Wiltermoodj/stubs

# Or initialize directly without local installation
npx github:Wiltermoodj/stubs install
```

### 2. Standalone Install (curl)

For standalone CI/CD environments or quick setup without npm packages:

```bash
curl -fsSL https://raw.githubusercontent.com/Wiltermoodj/stubs/main/bin/stubs.js -o /usr/local/bin/stubs && chmod +x /usr/local/bin/stubs
```

### Updating `stubs`

Run `update` inside any initialized workspace to refresh CLI binaries, agent skills, template molds, and database schemas:

```bash
stubs update
# Or with npx:
npx stubs update
```

---

## Quickstart Guide

Get your repository initialized, mapped, and indexed in four simple steps:

```bash
# 1. Initialize stubs configuration, agent skills, and templates
npx stubs init

# 2. Scaffold root architecture context map and domain hierarchy
npx stubs map --scaffold

# 3. Scan physical codebase, extract AST symbols, and build dependency graph
npx stubs scan

# 4. View visual file tree with architectural status and centrality markers
npx stubs tree --status
```

### Standard Development Workflow

```bash
# 1. Draft a new concept blueprint or sidecar specification
stubs concept new "User Authentication"
stubs template apply spec --name=auth --target=src/auth.ts

# 2. Stress-test and grill design invariants before writing code
stubs grill src/auth.ts.md

# 3. Materialize and typecheck production code directly from spec
stubs materialize src/auth.ts.md

# 4. Reconcile AST drift automatically whenever code or spec edits occur
stubs sand

# 5. Audit workspace health, cycles, and God-node hotspots
stubs audit --hotspots --cycles
```

---

## Interactive Web Portal & PWA

Launch the local interactive dashboard to visually explore dependencies, inspect architecture health, and collaborate with agents:

```bash
stubs serve --port=3000
```

- **Interactive 1-Hop Ego Graph:** Visual graph explorer powered by SQLite and WebAssembly.
- **Real-Time Synchronization:** Live Server-Sent Events (SSE) stream workspace edits as they occur.
- **Human Directive Channel:** Submit real-time agent directives and steering constraints directly from the browser.
- **Offline PWA Support:** Touch-friendly Progressive Web App installable on desktop and mobile.

_(Note: `stubs serve` runs directly out-of-the-box in any project. Static web bundle compilation via `npm run build:web` and GitHub Pages deployment via `npm run deploy:pages` are internal development actions for `stubs` source contributors.)_

---

## CLI Command Reference

| Command                               | Description                                                                                    |
| :------------------------------------ | :--------------------------------------------------------------------------------------------- |
| **`init`**                            | Initializes `.stubs/config.json`, template molds, and agent skill configurations.              |
| **`scan`**, **`index`** `[dir]`       | Scans source code, extracts AST symbols/imports, and populates the SQLite graph.               |
| **`map`** `[--scaffold]`              | Scaffolds or validates architectural context maps (`knowledge/architecture/context-map.md`).   |
| **`tree`** `[--status\|--graph]`      | Visualizes ASCII/Unicode file tree annotated with lifecycle phase and node degree centrality.  |
| **`concept`** `<action>`              | Manages concept blueprints (`new <title>`, `scaffold <doc>`, `list`).                          |
| **`phase`** `<action>`                | Manages 5-phase lifecycle (`status [file]`, `check <file>`, `advance <file> [phase]`).         |
| **`grill`** `<file>`                  | Runs interactive or automated (`--non-interactive`) design stress-testing on specifications.   |
| **`materialize`** `<file>`            | Extracts, typechecks, and generates executable source code from sidecar specs.                 |
| **`sand`**, **`sync`** `[file]`       | Bi-directionally synchronizes AST hashes and frontmatter between code and specs.               |
| **`context`** `<file>`                | Generates token-optimized, tiered agent context briefing slices (`--depth`, `--json`).         |
| **`impact`** / **`blast`** `<target>` | Analyzes upstream and downstream dependency blast radius and risk scoring.                     |
| **`lint-arch`**                       | Lints architecture rules against layer hierarchy, cyclic dependency bans, and manifest parity. |
| **`mock`** `<file>`                   | Generates spec-driven test suites and mock scaffolding (`--framework`, `--output`).            |
| **`diagram`** `[target]`              | Generates Mermaid architecture and sequence diagrams (`--type`, `--sync`).                     |
| **`prune`** `[--fix\|--zombies]`      | Identifies and prunes phantom specs, untracked source code, and zombie exports.                |
| **`changelog`** `[--since]`           | Generates semantic architectural changelogs from git history and spec changes.                 |
| **`path`** `<src>` `<dest>`           | Finds the shortest dependency or call chain between two files or symbols.                      |
| **`audit`** `[--hotspots\|--cycles]`  | Audits workspace health, circular dependencies, unlinked files, and God nodes.                 |
| **`template`** `<action>`             | Manages template molds (`list`, `render <name> <data>`).                                       |
| **`serve`** `[--port=3000]`           | Starts the local Web Portal and Event Bridge server for real-time visual exploration.          |
| **`auth login`**                      | Authenticates GitHub credentials and stores Personal Access Tokens (PATs).                     |
| **`update`**, **`upgrade`**           | Updates installed agent skills, template molds, dependencies, and SQLite schemas.              |

---

## Sub-Skills Reference

For agent orchestration, specialized sub-skills live under `.agents/skills/stubs/sub-skills/`:

| Sub-Skill                                                                       | Purpose                                                                                    |
| :------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------- |
| **[auditing](.agents/skills/stubs/sub-skills/auditing/SKILL.md)**               | Workspace health checks, cycle detection, and God-node hotspot analysis.                   |
| **[changelog](.agents/skills/stubs/sub-skills/changelog/SKILL.md)**             | Semantic architectural changelog generation and spec diff tracking.                        |
| **[conceptualizing](.agents/skills/stubs/sub-skills/conceptualizing/SKILL.md)** | Problem framing, requirements gathering, and blueprint generation.                         |
| **[context](.agents/skills/stubs/sub-skills/context/SKILL.md)**                 | Token-optimized tiered context slices and LLM briefing generation.                         |
| **[context-mapping](.agents/skills/stubs/sub-skills/context-mapping/SKILL.md)** | Hierarchical context maps (`context-map.md`) & domain index management.                    |
| **[diagram](.agents/skills/stubs/sub-skills/diagram/SKILL.md)**                 | Mermaid diagram generation for dependency flows and sequence interactions.                 |
| **[grilling](.agents/skills/stubs/sub-skills/grilling/SKILL.md)**               | Interactive and automated spec stress-testing and architectural inquiry.                   |
| **[lint](.agents/skills/stubs/sub-skills/lint/SKILL.md)**                       | Architecture invariant verification, layer hierarchy checking, and drift linting.          |
| **[materialization](.agents/skills/stubs/sub-skills/materialization/SKILL.md)** | Sidecar code extraction, in-memory TypeScript typechecking, and code generation.           |
| **[mock](.agents/skills/stubs/sub-skills/mock/SKILL.md)**                       | Spec-driven test suite generation and typed mock harness generation.                       |
| **[pruning](.agents/skills/stubs/sub-skills/pruning/SKILL.md)**                 | Detection and cleanup of orphaned specs, untracked source files, and zombie exports.       |
| **[sanding](.agents/skills/stubs/sub-skills/sanding/SKILL.md)**                 | AST structural hashing, frontmatter auto-healing, and bi-directional drift reconciliation. |

---

## Architectural Principles

- **Deep Modules:** Simple public interfaces that conceal rich internal logic.
- **Context Objects:** Group session, environment, and user state into unified parameters (`AuthContext`, `CliContext`) to prevent parameter explosion.
- **Define Errors Out of Existence:** Prefer explicit `Result<T, E>` returns and idempotent APIs over disruptive runtime exceptions.
- **Self-Healing Frontmatter:** Guarantees that manual edit collisions or missing YAML fields never crash the parser; auto-reconciles on write.
- **Zero-Model Local Core:** Deterministic parsing, graph indexing, AST hashing, and typechecking execute locally with zero API keys and 0 token overhead.

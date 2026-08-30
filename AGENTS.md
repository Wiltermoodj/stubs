# stubs — Agent Instructions

This document outlines the conventions and tooling rules AI agents must follow when operating in the `stubs` repository.

## Planning Hub & 5-Phase Lifecycle

All repository initiatives, conceptual blueprints, and multi-agent task trackers live under **[`knowledge/planning/`](knowledge/planning/)**:

- **[`knowledge/planning/planning-map.md`](knowledge/planning/planning-map.md)** — Master Planning Hub index and active initiative map.
- **5-Phase Lifecycle:**
  1. `Conceptualize` (Problem framing, file tree blueprint: `stubs concept`)
  2. `Grill` (Stress-testing decisions & ADRs: `stubs grill`)
  3. `Spec / Scaffold` (OKF sidecar definitions & types: `stubs concept scaffold`)
  4. `Materialize` (Executable code extraction: `stubs materialize`)
  5. `Sand & Audit` (AST drift sync & health check: `stubs sand`, `stubs phase check`)

## Context Map — Read First

Before making any code changes, read the architecture context map to understand the module structure, dependency layers, and core concepts:

- **[`knowledge/architecture/context-map.md`](knowledge/architecture/context-map.md)** — Master application context map linking to all domain-specific maps under `knowledge/architecture/domains/`.
- **[`knowledge/ARCHITECTURE.md`](knowledge/ARCHITECTURE.md)** — Repository layout, dependency layer map, core concepts, CLI quick reference, and module sidecar index.

### Domain Context Maps

Domain-specific context maps live under [`knowledge/architecture/domains/`](knowledge/architecture/domains/). Each domain map deep-dives into that domain's purpose, design invariants, and lists all key source files and sidecar specs:

- **Graph Engine:** [`knowledge/architecture/domains/graph-domain-map.md`](knowledge/architecture/domains/graph-domain-map.md)
- **Sanding & Sync Engine:** [`knowledge/architecture/domains/sanding-domain-map.md`](knowledge/architecture/domains/sanding-domain-map.md)
- **Materializer Engine:** [`knowledge/architecture/domains/materializer-domain-map.md`](knowledge/architecture/domains/materializer-domain-map.md)
- **Interactive Grill Engine:** [`knowledge/architecture/domains/grill-domain-map.md`](knowledge/architecture/domains/grill-domain-map.md)
- **Server & Live Portal:** [`knowledge/architecture/domains/server-domain-map.md`](knowledge/architecture/domains/server-domain-map.md)
- **Autonomy Protocol:** [`knowledge/architecture/domains/autonomy-domain-map.md`](knowledge/architecture/domains/autonomy-domain-map.md)
- **CLI & Router:** [`knowledge/architecture/domains/cli-domain-map.md`](knowledge/architecture/domains/cli-domain-map.md)

For a detailed module status matrix and full OKF subsystem index, see [`src/INDEX.md`](src/INDEX.md).

For individual module sidecar specs (interface contracts, design decisions, dependency graphs), find the `*.ts.md` file co-located with each `*.ts` source file in `src/`.

---

## Toolchain & Conventions

- **Package Manager:** `npm` (or `npx` for executing binaries).
- **Testing Framework:** `jest`.
- **Linter:** `eslint`.
- **Formatter:** `prettier`.
- **Design Principles:** All code changes must adhere strictly to the rules outlined in `DESIGN_PHILOSOPHY.md` (e.g., Deep Modules, Pulling Complexity Downward, Code Cohesion).

## Architecture Graph & Automatic Re-Scanning

The repository maintains an AST-extracted dependency graph in `.stubs/graph.sqlite`.

- **Reading Architecture:** Before proposing structural changes, agents should query graph topology via `npx stubs blast <target>`, `npx stubs path <src> <dest>`, or `npx stubs diagram`.
- **Automatic Graph Maintenance:** Whenever files (source code or markdown sidecars) are created, deleted, or structurally modified, agents **MUST automatically run `npx stubs scan`** to refresh `.stubs/graph.sqlite` and keep AST symbols, call chains, and module imports synchronized.

## CLI Commands

Agents should use the following commands to execute repository tasks:

- **Scan & Index Code Graph:** `npx stubs scan` (or `node .agents/skills/stubs/dist/cli.cjs scan`)
- **Install Dependencies:** `npm install`
- **Build Project:** `npm run build`
- **Run Tests:** `npm test`
- **Lint Code:** `npm run lint`
- **Format Code:** `npm run format`
- **Start Local Server:** `npm start`

## stubs CLI

The `stubs` CLI binary is at `.agents/skills/stubs/dist/cli.cjs`. Invoke via `npx stubs <command>` or `node .agents/skills/stubs/dist/cli.cjs <command>`.

Known CLI bugs (see STUBS_CLI_ASSESSMENT.md): B1 sand path, B2 non-interactive grind, B3 materialize parser, B4 audit flags, B5 grind command missing. Phase 1 work targets B1/B2/B3.

## Hermes contextloop integration

This repo uses the contextloop skill for phase-bounded task orchestration. The board lives in `.kanban/kanban.db`. The orchestrator wrapper is at `scripts/run-loop.sh`. Workers are spawned as detached OS processes (not delegate_task). Submit scripts are at `.hermes/skills/contextloop/bin/`.

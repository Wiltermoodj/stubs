# stubs — Agent Instructions

This document outlines the conventions and tooling rules AI agents must follow when operating in the `stubs` repository.

## Context Map — Read First

Before making any code changes, read the architecture context map to understand the module structure, dependency layers, and core concepts:

**[`knowledge/ARCHITECTURE.md`](knowledge/ARCHITECTURE.md)** — Repository layout, dependency layer map, core concepts, CLI quick reference, and links to all module sidecar specs.

For a detailed module status matrix and full OKF subsystem index, see [`src/INDEX.md`](src/INDEX.md).

For individual module sidecar specs (interface contracts, design decisions, dependency graphs), find the `*.ts.md` file co-located with each `*.ts` source file in `src/`.

---

## Toolchain & Conventions

- **Package Manager:** `npm` (or `npx` for executing binaries).
- **Testing Framework:** `jest`.
- **Linter:** `eslint`.
- **Formatter:** `prettier`.
- **Design Principles:** All code changes must adhere strictly to the rules outlined in `DESIGN_PHILOSOPHY.md` (e.g., Deep Modules, Pulling Complexity Downward, Code Cohesion).

## CLI Commands

Agents should use the following commands to execute repository tasks:

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

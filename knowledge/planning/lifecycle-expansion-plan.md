---
title: Stubs Lifecycle, Conceptual File Trees, and Planning Hub Expansion Plan
type: initiative-plan
description: Implementation plan and multi-agent task tracker for expanding stubs with a 5-phase lifecycle, cross-repo conceptual file trees, knowledge/planning hub, CLI commands, and portal integration.
tags:
  - planning
  - lifecycle
  - concept-trees
  - task-tracker
  - cli
  - stubs
phase: sand
status: spec
version: 1
status_flag: clean
initiative: framework-lifecycle-expansion
---

# Stubs Lifecycle, Conceptual File Trees, and Planning Hub Expansion Plan

## Executive Summary

This document tracks the technical implementation of the **5-Phase Lifecycle & Conceptual Planning Hub** expansion for `stubs`. It provides an executable roadmap, planned file tree blueprints, and interactive task checklists organized by phase for human developers and autonomous AI agents.

---

## Planned Architecture & File Tree Blueprint

```filetree
knowledge/
  planning/
    planning-map.md             # [NEW] Master Planning Hub index
    lifecycle-expansion-plan.md # [NEW] This initiative plan & task tracker
.agents/
  skills/
    stubs/
      SKILL.md                  # [MODIFY] Document 5-phase lifecycle & new CLI commands
      sub-skills/
        conceptualizing/
          SKILL.md              # [NEW] Sub-skill guide for conceptualizing & planning
src/
  parser/
    okf.ts                      # [MODIFY] Add OKF types, phase fields, and filetree parser
    okf.ts.md                   # [MODIFY] Spec sidecar for OKF parser
  graph/
    engine.ts                   # [MODIFY] Store phases, initiatives, tasks, and planned trees
    engine.ts.md                # [MODIFY] Spec sidecar for GraphEngine
  concept/
    engine.ts                   # [NEW] Conceptualizing engine (scaffolding, listing)
    engine.ts.md                # [NEW] Spec sidecar
    tree.ts                     # [NEW] Cross-repo file tree generator & visualizer
    tree.ts.md                  # [NEW] Spec sidecar
  phase/
    engine.ts                   # [NEW] Phase tracking and transition verification engine
    engine.ts.md                # [NEW] Spec sidecar
  cli/
    router.ts                   # [MODIFY] Add stubs concept, stubs tree, stubs phase
    router.ts.md                # [MODIFY] Spec sidecar
  templates/
    molds/
      concept-doc.md.tpl        # [NEW] Concept document template mold
      initiative-plan.md.tpl    # [NEW] Initiative plan template mold
      planning-map.md.tpl       # [NEW] Planning map index template mold
  server/
    portal.ts                   # [MODIFY] API endpoints for planning hub, phases, and tree
    portal.ts.md                # [MODIFY] Spec sidecar
AGENTS.md                       # [MODIFY] Updated repo instructions with 5-phase protocol
tests/
  concept.test.ts               # [NEW] Unit tests for filetree parsing & concept scaffolding
  tree.test.ts                  # [NEW] Tests for tree generation
  phase.test.ts                 # [NEW] Tests for phase gating & transitions
  planning-portal.test.ts       # [NEW] Tests for portal planning REST endpoints
```

---

## Phase-by-Phase Execution & Task Tracker

### Phase 1: Conceptualize & Specification Scaffolding

- [x] Conduct interactive alignment interview (`/grill-me`) to define requirements and lifecycle stages.
- [x] Create centralized Planning Hub (`knowledge/planning/planning-map.md`).
- [x] Create this initiative execution and task tracker document (`knowledge/planning/lifecycle-expansion-plan.md`).
- [x] Define OKF parser schema updates for `planning-map`, `initiative-plan`, and `phase` fields.
- [x] Define template molds for concept docs, initiative plans, and planning maps in `src/templates/molds/`.

### Phase 2: Grill & Stress-Testing

- [x] Stress-test document placement strategy (hybrid model: global in `knowledge/planning/` & `docs/`, co-located in `src/<subsystem>/`).
- [x] Stress-test file tree declaration syntax (standardized `filetree` markdown code block + frontmatter manifest).
- [x] Stress-test phase gating criteria (validation rules preventing ungrilled/uncompiled progression).
- [x] Stress-test multi-agent concurrent checklist updates on initiative plans.

### Phase 3: Spec & Sidecar Definition

- [x] Update `src/parser/okf.ts.md` with new `OkfFrontmatter` types, `extractFileTreeBlocks`, `parseFileTreeEntries`, and checklist extractors.
- [x] Create `src/concept/engine.ts.md` sidecar specifying `createConcept`, `scaffoldFileTreeFromDoc`, and `listConcepts`.
- [x] Create `src/concept/tree.ts.md` sidecar specifying ASCII/Unicode tree generation and planned vs existing file annotations.
- [x] Create `src/phase/engine.ts.md` sidecar specifying `checkPhase`, `advancePhase`, and `getWorkspacePhaseMatrix`.
- [x] Update `src/graph/engine.ts.md` sidecar with planning queries, task indexing, and phase tables.
- [x] Update `src/cli/router.ts.md` sidecar specifying CLI routing for `concept`, `tree`, and `phase` commands.
- [x] Update `src/server/portal.ts.md` sidecar specifying REST API routes for `/api/v1/planning`, `/api/v1/phases`, and `/api/v1/tree`.

### Phase 4: Materialization & Core Implementation

- [x] **Parser Enhancements (`src/parser/okf.ts`):**
  - [x] Add `planning-map` and `initiative-plan` to valid `type` values.
  - [x] Add optional `phase`, `initiative`, `planned_files`, and `tasks` frontmatter fields.
  - [x] Implement `extractFileTreeBlocks(markdown: string): string[]`.
  - [x] Implement `parseFileTreeEntries(treeText: string): Array<{ path: string; type: 'file' | 'dir' | 'spec'; description?: string }>`.
  - [x] Implement `extractMarkdownChecklists(markdown: string): Array<{ text: string; completed: boolean; line: number }>`.
- [x] **Graph Engine Extension (`src/graph/engine.ts`):**
  - [x] Add `phase` and `initiative` columns to `sidecars` table in SQLite schema.
  - [x] Add `tasks` and `planned_files` tables and synchronization logic.
  - [x] Implement `getPlanningHub()`, `getPhaseStatus()`, and `getProjectFileTree()`.
- [x] **Concept & Tree Engines (`src/concept/engine.ts` & `src/concept/tree.ts`):**
  - [x] Implement `ConceptEngine` for concept creation, blueprint scanning, and skeleton scaffolding.
  - [x] Implement `TreeEngine` for visual tree rendering with phase indicators.
- [x] **Phase Engine (`src/phase/engine.ts`):**
  - [x] Implement phase validation checks (unresolved questions, missing sidecars, broken links).
  - [x] Implement `advancePhase()` to safely update OKF frontmatter and SQLite graph.
- [x] **CLI Router Integration (`src/cli/router.ts`):**
  - [x] Implement `handleConcept(ctx: CliContext)` (`new`, `scaffold`, `list`).
  - [x] Implement `handleTree(ctx: CliContext)` (`--planned`, `--status`).
  - [x] Implement `handlePhase(ctx: CliContext)` (`status`, `check`, `advance`).
  - [x] Update CLI help and version messaging.
- [x] **Template Molds:**
  - [x] Create `concept-doc.md.tpl`.
  - [x] Create `initiative-plan.md.tpl`.
  - [x] Create `planning-map.md.tpl`.
- [x] **Web Portal & Server (`src/server/portal.ts` & UI):**
  - [x] Implement `GET /api/v1/planning`, `GET /api/v1/phases`, and `GET /api/v1/tree`.
  - [x] Add Planning Hub tab and Phase Lifecycle board to Web Portal frontend.
- [x] **Agent Skills & Documentation:**
  - [x] Create `.agents/skills/stubs/sub-skills/conceptualizing/SKILL.md`.
  - [x] Update `.agents/skills/stubs/SKILL.md`.
  - [x] Update repository `AGENTS.md` and `README.md`.

### Phase 5: Sanding, Testing & Verification

- [x] Author unit tests in `tests/concept.test.ts`.
- [x] Author tests in `tests/tree.test.ts`.
- [x] Author tests in `tests/phase.test.ts`.
- [x] Author integration tests in `tests/planning-portal.test.ts`.
- [x] Run full test suite (`npm test`) and ensure 100% pass rate.
- [x] Run `npm run lint` and `npm run build`.
- [x] Execute `stubs sand` across workspace to verify zero AST drift.

---

## Dynamic Notes & Decision Log

| Date       | Agent / User | Note / Decision                                                                                                                      |
| :--------- | :----------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-26 | Agent & User | Finalized 5-phase lifecycle model (Conceptualize, Grill, Spec, Materialize, Sand & Audit).                                           |
| 2026-08-26 | Agent & User | Agreed on hybrid concept placement + centralized `knowledge/planning/` hub with markdown task tracking.                              |
| 2026-08-26 | Agent & User | Adopted standardized `filetree` markdown code block syntax for conceptual tree declaration.                                          |
| 2026-08-26 | Agent & User | Completed full implementation across OKF parser, GraphEngine, ConceptEngine, TreeEngine, PhaseEngine, CLI router, and Portal server. |

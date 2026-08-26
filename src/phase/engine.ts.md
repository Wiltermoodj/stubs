---
title: Phase Engine — 5-Phase Lifecycle Verification & State Machine
type: sidecar-spec
description: >-
  Verifies phase transition gating rules across the 5 deterministic lifecycle phases:
  Conceptualize, Grill, Spec/Scaffold, Materialize, and Sand & Audit. Enforces
  quality gates and safely updates OKF specification frontmatter.
tags:
  - phase
  - lifecycle
  - state-machine
  - gating
  - verification
module_depth: deep
context_object: PhaseEngine
status: spec
version: 1
target_code_file: ./engine.ts
status_flag: clean
exports:
  - PhaseEngine
  - LifecyclePhase
  - LIFECYCLE_PHASES
  - PhaseRequirement
  - PhaseCheckResult
  - AdvancePhaseResult
  - WorkspacePhaseMatrix
depends_on:
  - src/parser/okf.ts
  - src/graph/engine.ts
  - src/materializer/engine.ts
  - src/storage/index.ts
used_by:
  - src/cli/router.ts
  - src/server/portal.ts
---

# Phase Engine — 5-Phase Lifecycle Verification & State Machine

Manages lifecycle gating rules:

1. `conceptualize` → `grill`
2. `grill` → `spec`
3. `spec` → `materialize`
4. `materialize` → `sand`
5. `sand` (Clean state)

## Key Operations

- `checkPhase(filePath)`: Evaluates gating rules and returns `canAdvance` + requirement details.
- `advancePhase(filePath, targetPhase?, options?)`: Safely writes updated `phase` in YAML frontmatter and re-indexes SQLite graph.
- `getWorkspacePhaseMatrix()`: Returns workspace lifecycle matrix and phase counts.

---
title: Architectural Lint Engine — Guardrails & Layer Invariant Enforcement
type: sidecar-spec
description: >-
  Enforces zero-dependency architectural guardrails across the repository:
  downward layer hierarchy (Layer 0 Foundation -> Layer 6 Interface),
  circular dependency cycle bans, sidecar manifest parity (code imports vs
  depends_on frontmatter), and domain encapsulation.
tags:
  - lint
  - architecture
  - guardrails
  - layers
  - cycles
  - invariants
module_depth: deep
context_object: ArchLintEngine
status: spec
version: 1
target_code_file: ./engine.ts
status_flag: clean
exports:
  - ArchLintEngine
  - ArchLintOptions
  - ArchLintResult
  - ArchLintSummary
  - ArchViolation
  - ArchRuleType
  - LAYER_DEFINITIONS
  - getModuleLayer
depends_on:
  - src/config/schema.ts
  - src/graph/engine.ts
  - src/graph/topology.ts
  - src/parser/okf.ts
  - src/storage/index.ts
used_by:
  - src/cli/router.ts
---

# Architectural Lint Engine — Guardrails & Layer Invariant Enforcement

The `ArchLintEngine` provides fast, deterministic architectural linting for CI/pre-commit hooks and developer workflows.

## Invariant Rules

1. **Layer Hierarchy:** Modules in Layer $N$ may only import modules from Layer $\le N$. Inversions are flagged as `LAYER_VIOLATION`.
2. **Cycle Prevention:** Detects closed loops using Tarjan SCC, flagged as `CIRCULAR_DEPENDENCY`.
3. **Manifest Parity:** Verifies that code imports match `depends_on` frontmatter, flagged as `UNMANIFESTED_DEPENDENCY`.
4. **Domain Encapsulation:** Flags external cross-domain calls targeting internal private symbols as `DOMAIN_LEAK`.

---
title: Context Engine — Agent Context Packaging & Subgraph Slicing
type: sidecar-spec
description: >-
  Generates token-optimized, topologically bounded context packages for AI agents
  and developer workflows. Uses tiered depth slicing (Target Full + Direct
  Dependencies Distilled Signatures/ADRs + 2-Hop Boundary Symbols) to minimize
  prompt bloat without losing interface clarity.
tags:
  - context
  - agent-briefing
  - subgraph-slicing
  - token-optimization
  - intelligence
module_depth: deep
context_object: ContextEngine
status: spec
version: 1
target_code_file: ./engine.ts
status_flag: clean
exports:
  - ContextEngine
  - ContextPackage
  - ContextOptions
  - Tier0TargetContext
  - Tier1DependencyContext
  - Tier1DependentContext
  - Tier2BoundaryContext
depends_on:
  - src/config/schema.ts
  - src/graph/engine.ts
  - src/parser/okf.ts
  - src/parser/ast.ts
  - src/storage/index.ts
used_by:
  - src/cli/router.ts
---

# Context Engine — Agent Context Packaging & Subgraph Slicing

The `ContextEngine` assembles multi-tier architectural context packages for any specified target module. It solves the "context window explosion" problem by providing exact, distilled contracts rather than dumping raw full source files across the repository.

## Tiered Slicing Invariants

1. **Tier 0 (Target Module):** Complete sidecar specification markdown (`.ts.md`) and complete implementation code (`.ts`).
2. **Tier 1 (Direct 1-Hop Dependencies):** Architectural Decisions (ADRs), interface contract tables, and distilled TypeScript signatures (public types, interfaces, enums, and functions with implementation bodies stripped).
3. **Tier 1 (Direct 1-Hop Dependents):** Table of upstream callers, their lifecycle phase, and status flags.
4. **Tier 2 (Transitive 2-Hop Boundary):** Concise symbol index and module descriptions.

## Output Modes

- **Markdown (`renderMarkdown`):** Formatted hierarchical Markdown ready for stdout display, clipboard copy, or feeding into LLMs.
- **JSON:** Complete structured object for programmatic consumption by IDE plugins and autonomous task dispatchers.

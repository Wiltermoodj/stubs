---
title: Impact Engine — Blast-Radius & Regression Risk Analysis
type: sidecar-spec
description: >-
  Analyzes upstream and downstream blast-radius using the SQLite dependency
  graph and AST topology. Computes risk levels (LOW/MEDIUM/HIGH/CRITICAL),
  detects impacted architectural domains, and identifies stale sidecars
  in the cascade path.
tags:
  - impact
  - blast-radius
  - risk-assessment
  - topology
  - intelligence
module_depth: deep
context_object: ImpactEngine
status: spec
version: 1
target_code_file: ./engine.ts
status_flag: clean
exports:
  - ImpactEngine
  - ImpactOptions
  - ImpactAnalysisResult
  - AffectedModuleInfo
depends_on:
  - src/config/schema.ts
  - src/graph/engine.ts
  - src/graph/topology.ts
  - src/storage/index.ts
used_by:
  - src/cli/router.ts
---

# Impact Engine — Blast-Radius & Regression Risk Analysis

The `ImpactEngine` calculates the blast-radius of modifying any file or sidecar in the repository.

## Capabilities

- **Dependency & Dependent Traversal:** Traces inbound callers (who breaks if I change this) and outbound dependencies.
- **Domain Spill Detection:** Identifies how many distinct architectural domains are breached.
- **Risk Scoring:** Assigns categorical risk levels (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`) based on affected degree and cross-domain propagation.
- **Sidecar Health Check:** Flags whether affected dependents have pending AST drift (`typecheck-failed`, `needs-human-review-resolution`).

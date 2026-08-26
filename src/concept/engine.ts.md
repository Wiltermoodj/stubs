---
title: Concept Engine — Conceptual Documentation & Filetree Scaffolder
type: sidecar-spec
description: >-
  Scaffolds conceptual documents, initiative plans, and planning maps from template
  molds. Extracts planned file tree blueprints from concept markdown specifications
  and automatically generates initial directories, code stubs, and OKF sidecar specs.
tags:
  - concept
  - scaffolding
  - filetree
  - planning
  - templates
module_depth: deep
context_object: ConceptEngine
status: spec
version: 1
target_code_file: ./engine.ts
status_flag: clean
exports:
  - ConceptEngine
  - CreateConceptOptions
  - CreateConceptResult
  - ScaffoldResult
  - ConceptInfo
depends_on:
  - src/parser/okf.ts
  - src/graph/engine.ts
  - src/templates/engine.ts
  - src/storage/index.ts
used_by:
  - src/cli/router.ts
  - src/server/portal.ts
---

# Concept Engine — Conceptual Documentation & Filetree Scaffolder

Handles Phase 1 of the Stubs 5-Phase Lifecycle.

## Key Capabilities

1. **`createConcept(options)`:** Generates new concept documents (`type: concept-doc`), initiative plans (`type: initiative-plan`), or planning maps (`type: planning-map`) from structured templates.
2. **`scaffoldFileTreeFromDoc(docPath, options)`:** Reads `filetree` code blocks and frontmatter `planned_files` in a specification, creates directories on disk, creates source code stubs, and generates skeleton OKF sidecars (`*.ts.md`) with valid frontmatter.
3. **`listConcepts(dir)`:** Lists all conceptual blueprints and initiative plans in the workspace.

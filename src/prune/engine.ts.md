---
title: Prune Engine — Phantom Spec & Dead Code Garbage Collection
type: sidecar-spec
description: >-
  Audits workspace for architectural drift, phantom sidecars referencing deleted
  files, untracked code files missing sidecars, zombie exported symbols, and stale
  graph database records. Supports auto-healing and pruning via the CLI.
tags:
  - prune
  - orphan
  - dead-code
  - garbage-collection
  - audit
module_depth: deep
context_object: PruneEngine
status: spec
version: 1
target_code_file: ./engine.ts
status_flag: clean
exports:
  - PruneEngine
  - PruneOptions
  - PruneAuditResult
  - PruneIssue
  - PruneIssueType
  - PruneFixResult
depends_on:
  - src/config/schema.ts
  - src/parser/okf.ts
  - src/parser/ast.ts
  - src/graph/engine.ts
  - src/storage/index.ts
used_by:
  - src/cli/router.ts
---

# Prune Engine — Phantom Spec & Dead Code Garbage Collection

The `PruneEngine` audits physical workspace files against the SQLite graph database to prevent architectural drift and orphaned files.

## Audit Checks

1. **Phantom Sidecars (`PHANTOM_SIDECAR`):** Finds `*.ts.md` files where `target_code_file` does not exist on disk.
2. **Untracked Code Files (`UNTRACKED_CODE`):** Finds `.ts` files under `src/` that have no paired `*.ts.md` sidecar spec.
3. **Zombie Exports (`ZOMBIE_EXPORT`):** Finds exported functions/classes with zero in-degree call or import edges across the workspace.
4. **Stale Database Nodes (`STALE_DB_NODE`):** Identifies nodes in `.stubs/graph.sqlite` pointing to deleted files.

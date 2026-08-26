---
title: Tree Engine — Visual Cross-Repository File Tree Generator
type: sidecar-spec
description: >-
  Generates ASCII and Unicode visual file tree structures merging physical workspace
  files with planned blueprint entries from OKF concept docs. Annotates nodes with
  5-phase lifecycle states, drift status flags, and planned markers.
tags:
  - tree
  - visualization
  - filetree
  - concept
  - status
module_depth: deep
context_object: TreeEngine
status: spec
version: 1
target_code_file: ./tree.ts
status_flag: clean
exports:
  - TreeEngine
  - VisualTreeOptions
depends_on:
  - src/graph/engine.ts
  - src/parser/okf.ts
  - src/storage/index.ts
used_by:
  - src/cli/router.ts
  - src/server/portal.ts
---

# Tree Engine — Visual Cross-Repository File Tree Generator

Visualizes repository file trees combining real disk files and conceptual blueprint targets.

## Key Capabilities

1. **`generateVisualTree(options)`:** Generates a unified ASCII/Unicode tree.
2. **Planned Files Overlay:** Scans `filetree` code blocks and planned_files in concept docs and displays `[PLANNED]` badges for files yet to be created.
3. **Phase & Status Badging:** Annotates active specifications with their current phase (`[SPEC]`, `[GRILL]`, `[MATERIALIZE]`, `[SAND]`) and status flags (`clean`, `dependency-stale`, etc.).

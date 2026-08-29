---
title: Graph Engine — SQLite Adjacency Graph & FTS5
type: sidecar-spec
description: >-
  Core dependency graph and full-text search engine. Manages a SQLite database
  of sidecar specs, initiatives, planned filetrees, tasks, their dependency edges,
  and an FTS5 virtual table for full-text search. Provides CRUD operations, graph
  traversal, 5-phase lifecycle tracking, and planning hub metrics.
tags:
  - graph
  - sqlite
  - fts5
  - index
  - search
  - dependency-graph
  - planning
  - lifecycle
module_depth: deep
context_object: GraphEngine
status: spec
version: 2
target_code_file: ./engine.ts
status_flag: clean
exports:
  - GraphEngine
  - IndexSummary
  - SidecarInput
  - SearchOptions
  - SearchResult
  - TaskRow
  - PlannedFileRow
  - PlanningHubSummary
  - PhaseStatusReport
  - TieredNeighborhood
  - normalizePosixPath
  - resolvePosixPath
depends_on:
  - src/config/schema.ts
  - src/parser/okf.ts
  - src/storage/index.ts
used_by:
  - src/grill/engine.ts
  - src/concept/engine.ts
  - src/concept/tree.ts
  - src/phase/engine.ts
  - src/materializer/engine.ts
  - src/sanding/engine.ts
  - src/autonomy/protocol.ts
  - src/context/engine.ts
  - src/cli/router.ts
  - src/server/portal.ts
---

# Graph Engine — SQLite Adjacency Graph & FTS5

The central data store of the stubs framework. Every sidecar spec and planning document is indexed here; all dependency links, tasks, planned blueprints, and lifecycle phase states are tracked.

## Database Schema

### `sidecars` table

Primary record store. Columns map 1:1 to `OkfFrontmatter` fields plus metadata: `file_path`, `title`, `type`, `description`, `module_depth`, `context_object`, `template_source`, `template_version`, `status`, `version`, `phase`, `initiative`, `target_code_file`, `status_flag`, `stale_details`, `last_sync_timestamp`, `sidecar_hash`, `code_hash`, `interfaces_text`, `decisions_text`, `raw_content`, `tags`, `exports`, `file_hash`, `created_at`, `updated_at`.

### `tasks` table

Tracks markdown checklist items extracted from initiative plans and sidecars: `id`, `sidecar_path`, `text`, `completed`, `line_number`, `initiative`.

### `planned_files` table

Tracks file tree blueprint items extracted from `filetree` code blocks and OKF manifests: `id`, `source_doc`, `path`, `type`, `description`, `status`.

### `dependencies` table

Adjacency list: `source_file_path` → `target_file_path` with `type`.

### `sidecar_fts` (FTS5 virtual table)

Full-text search index over: `file_path`, `title`, `description`, `tags`, `exports`, `interfaces_text`, `decisions_text`.

## Key Operations

| Method                        | Description                                                 |
| ----------------------------- | ----------------------------------------------------------- |
| `initialize()`                | Opens DB, creates schema and tables                         |
| `indexFile(sidecarPath)`      | Parses, validates, and upserts a sidecar/doc into the graph |
| `indexWorkspace(specsDir)`    | Globs for `*.md` files and batch-indexes them               |
| `getPlanningHub()`            | Aggregates initiatives, concepts, tasks, and completion %   |
| `getPhaseStatus()`            | Generates 5-phase lifecycle status matrix and counts        |
| `getTasks(filter)`            | Queries structured tasks with optional filters              |
| `getPlannedFiles(filter)`     | Queries planned files from blueprints                       |
| `getProjectFileTree(options)` | Merges physical and planned file trees                      |
| `search(query, options)`      | FTS5 BM25-ranked full-text search with tag/bounds filtering |
| `getSidecar(filePath)`        | Returns full sidecar record by path                         |
| `deleteSidecar(filePath)`     | Removes sidecar, tasks, planned files, and dependency edges |

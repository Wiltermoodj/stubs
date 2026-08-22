---
title: Graph Engine — SQLite Adjacency Graph & FTS5
type: sidecar-spec
description: >-
  Core dependency graph and full-text search engine. Manages a SQLite database
  of sidecar specs, their dependency edges, and an FTS5 virtual table for
  full-text search. Provides CRUD operations, graph traversal (1-hop ego graph),
  workspace indexing, and FTS5-powered spec search. Supports both native sqlite3
  and WASM sql.js drivers for dual Node.js/browser operation.
tags:
  - graph
  - sqlite
  - fts5
  - index
  - search
  - dependency-graph
module_depth: deep
context_object: GraphEngine
status: spec
version: 1
target_code_file: ./engine.ts
status_flag: clean
exports:
  - GraphEngine
  - IndexSummary
  - SidecarInput
  - SearchOptions
  - SearchResult
  - normalizePosixPath
  - resolvePosixPath
depends_on:
  - src/config/schema.ts
  - src/parser/okf.ts
  - src/storage/index.ts
used_by:
  - src/grill/engine.ts
  - src/materializer/engine.ts
  - src/sanding/engine.ts
  - src/autonomy/protocol.ts
  - src/cli/router.ts
  - src/server/portal.ts
---

# Graph Engine — SQLite Adjacency Graph & FTS5

The central data store of the stubs framework. Every sidecar spec is indexed here; all dependency links are edges in the adjacency graph.

## Database Schema

### `sidecars` table
Primary record store. Columns map 1:1 to `OkfFrontmatter` fields plus metadata: `file_path`, `title`, `type`, `description`, `module_depth`, `context_object`, `template_source`, `template_version`, `status`, `version`, `target_code_file`, `status_flag`, `stale_details`, `last_sync_timestamp`, `sidecar_hash`, `code_hash`, `interfaces_text`, `decisions_text`, `raw_content`, `tags`, `exports`, `file_hash`, `created_at`, `updated_at`.

### `dependencies` table
Adjacency list: `sidecar_id` → `depends_on_path` (TEXT). Represents `depends_on` frontmatter links.

### `sidecars_fts` (FTS5 virtual table)
Full-text search index over: `file_path`, `title`, `description`, `tags`, `interfaces_text`, `decisions_text`, `raw_content`.

## Key Operations

| Method | Description |
|---|---|
| `initialize()` | Opens DB, creates schema and FTS triggers |
| `indexFile(sidecarPath)` | Parses, validates, and upserts a sidecar into the graph |
| `indexWorkspace(specsDir)` | Globs for `*.ts.md` files and batch-indexes them |
| `getEgoGraph(filePath, depth)` | Returns 1-hop or N-hop subgraph centered on a sidecar |
| `search(query, options)` | FTS5 BM25-ranked full-text search with tag/bounds filtering |
| `getSidecar(filePath)` | Returns full sidecar record by path |
| `deleteSidecar(filePath)` | Removes sidecar and its dependency edges |
| `pruneOrphans()` | Removes records for files that no longer exist |

## Path Normalization

`normalizePosixPath()` and `resolvePosixPath()` normalize Windows backslashes, collapse `..` segments, and handle drive letter prefixes. All paths stored in the DB are POSIX-normalized.

## Key Design Decisions

- FTS5 triggers (`AFTER INSERT`, `AFTER UPDATE`, `AFTER DELETE` on `sidecars`) keep the FTS index automatically synchronized.
- `indexFile` is idempotent — re-indexing an unchanged file is a no-op (content hash comparison).
- `fallbackGlob()` provides a pure `FileStorageDriver`-based glob when `NodeFileSystem.glob()` is unavailable (WASM/browser).
- `foreign_keys = ON` is set at initialization to enforce referential integrity on dependency edges.

---
title: Sanding Engine — Bi-Directional Spec/Code Sync
type: sidecar-spec
description: >-
  Reconciles structural drift between OKF sidecar specifications (*.ts.md) and
  their paired implementation files (*.ts) using SHA-256 content hashes and
  TypeScript AST structural hashes. Determines sync direction (sidecar→code or
  code→sidecar) from timestamp vectors, resolves non-structural conflicts
  automatically, and escalates true structural conflicts for human review.
tags:
  - sanding
  - sync
  - drift-detection
  - bi-directional
  - ast-hash
module_depth: deep
context_object: SyncResult
status: spec
version: 1
target_code_file: ./engine.ts
status_flag: needs-human-review-resolution
exports:
  - SyncResult
  - SandingEngine
  - stripSyncStateFromYaml
  - stripSyncStateFromContent
  - healCorruptedFrontmatter
depends_on:
  - src/parser/okf.ts
  - src/parser/markdown.ts
  - src/sanding/ast.ts
  - src/storage/containment.ts
used_by:
  - src/cli/router.ts
  - src/autonomy/protocol.ts
stale_details: >-
  Conflict detected: Both sidecar and code files have been modified with
  structural AST differences.
---

# Sanding Engine — Bi-Directional Spec/Code Sync

The Sanding Engine is the runtime integrity guardian. It continuously reconciles the source of truth (sidecar spec) with the runtime artifact (TypeScript code) and vice versa.

## SyncResult

```typescript
interface SyncResult {
  filePath: string;
  targetCodeFile: string;
  status: 'synced' | 'no_change' | 'conflict' | 'healed' | 'error';
  direction?: 'materialized' | 'sanded' | 'sidecar_to_code' | 'code_to_sidecar' | 'none';
  error?: string;
  conflict_resolved?: boolean;
  resolution?: string;
}
```

## Sync Decision Matrix

| Condition                                         | Action                                                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Sidecar newer, AST hashes differ                  | Materialize sidecar code → target file                                           |
| Code newer, AST hashes differ                     | Sand code → sidecar `## Implementation` block                                    |
| AST hashes match                                  | `no_change` — no file writes                                                     |
| Structural conflict (both changed, hashes differ) | Escalate: `status='conflict'`, set `status_flag='needs-human-review-resolution'` |
| Non-structural conflict (timestamp tie, same AST) | Auto-resolve: newer file wins                                                    |

## Frontmatter Healing

`healCorruptedFrontmatter(yamlText)` provides a line-by-line regex fallback to recover valid `OkfFrontmatter` from malformed YAML. Used when `js-yaml.load()` fails — ensuring the sanding engine never aborts on a corrupted sidecar.

## `sync_state` Tracking

After every successful sync, the sidecar's `sync_state` block is updated:

```yaml
sync_state:
  last_sync_timestamp: '2026-08-21T21:00:00Z'
  sidecar_hash: 'sha256...'
  code_hash: 'sha256...'
```

`stripSyncStateFromYaml()` and `stripSyncStateFromContent()` strip this block before computing content hashes to prevent false drift detection caused by the hash update itself.

## Key Design Decisions

- **Timestamp vector** determines direction when both files have changed; the newer file is the authoritative version.
- **AST structural hash** (`getAstStructuralHash`) distinguishes cosmetic reformats (no-op) from genuine structural changes (trigger sync).
- **`healCorruptedFrontmatter()`** is a last-resort recovery path — it never silently loses data, only fills in defaults for truly missing fields.
- Sanding is idempotent: running `stubs sand` on an already-synced workspace produces only `no_change` results.

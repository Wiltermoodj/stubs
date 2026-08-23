---
title: Storage — Path Containment Guard
type: sidecar-spec
description: >-
  Fail-closed path containment safety layer. Resolves target_code_file paths
  from untrusted OKF frontmatter into safe absolute paths, rejecting any path
  that escapes the workspace root. Single source of truth for target code file
  path resolution across the materializer and sanding engine.
tags:
  - storage
  - security
  - path-containment
  - foundation
module_depth: shallow
status: spec
version: 1
target_code_file: ./containment.ts
status_flag: clean
exports:
  - resolveContainedPath
  - isSafeRelativePath
  - validateTargetCodeFile
used_by:
  - src/materializer/engine.ts
  - src/sanding/engine.ts
---

# Storage — Path Containment Guard

Security primitive. Prevents directory traversal attacks via malicious `target_code_file` values in sidecar frontmatter. All path resolution in engines goes through `resolveContainedPath`.

## Functions

### `resolveContainedPath(baseDir, relativePath): string`

- Resolves `relativePath` against `baseDir` using `path.resolve`.
- Computes `path.relative(normalizedBase, normalizedTarget)`.
- **Throws** if the relative path starts with `..` or is absolute — this is the only function in the codebase that intentionally throws on a security violation.

### `isSafeRelativePath(relativePath): boolean`

- Rejects absolute paths.
- Rejects paths starting with `..` or containing `/../`.
- Rejects paths whose `path.normalize()` result escapes the base.

### `validateTargetCodeFile(targetCodeFile): string | null`

- Convenience validator for frontmatter values.
- Returns `null` if valid, or a human-readable error string if invalid.
- Enforces `.ts` extension convention.

## Key Design Decisions

- `resolveContainedPath` throws by design — path escapes are security violations, not recoverable errors.
- All other storage and parser functions avoid throwing; containment is the deliberate exception.
- Validation is separate from resolution (`isSafeRelativePath` vs `resolveContainedPath`) to allow pre-validation before attempting resolution.

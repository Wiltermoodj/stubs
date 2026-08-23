---
title: Sanding AST — Structural Hash & Code Type-Check
type: sidecar-spec
description: >-
  Provides two TypeScript compiler API utilities used exclusively by the Sanding
  Engine: getAstStructuralHash() which computes a formatting-agnostic structural
  hash of TypeScript code by traversing the AST node kinds and identifiers, and
  typeCheckCode() which performs an in-memory semantic type-check against the
  full workspace type graph.
tags:
  - sanding
  - ast
  - hash
  - typecheck
  - typescript-compiler
module_depth: deep
status: spec
version: 1
target_code_file: ./ast.ts
status_flag: clean
exports:
  - TypeCheckResult
  - getAstStructuralHash
  - typeCheckCode
depends_on:
  - src/compiler/typechecker.ts
used_by:
  - src/sanding/engine.ts
---

# Sanding AST — Structural Hash & Code Type-Check

Low-level TypeScript AST utilities that give the Sanding Engine the ability to determine whether code and spec have diverged structurally, and whether the diverged code is type-safe.

## `getAstStructuralHash(code: string): string`

Produces a SHA-256 hash that is **invariant to formatting, whitespace, and comments** but **sensitive to structural changes** (renamed identifiers, added/removed nodes).

### Algorithm

1. `ts.createSourceFile()` to parse code into the TypeScript AST.
2. `ts.forEachChild()` recursive traversal, collecting each node as `{kind}:{identifierText}`.
3. Serialize the collected node array to a comma-delimited string.
4. SHA-256 hash the serialized string.

**Purpose:** Two code versions with the same structural hash are considered equivalent for sanding purposes — cosmetic reformatting does not trigger a sync.

## `typeCheckCode(filePath: string, code: string): TypeCheckResult`

In-memory type-checker used by the Sanding Engine (distinct from `compiler/typechecker.ts` which is used by the Materializer). Uses a raw `ts.CompilerHost` without the overlay-file indirection pattern. Reads actual workspace files from disk for accurate cross-file resolution.

### Key Differences from `compiler/typechecker.ts`

- Simpler host implementation (no `originalReadFile` delegation chain).
- Includes both `getPreEmitDiagnostics` and `emit` diagnostics (Materializer uses only `getPreEmitDiagnostics`).
- Module-level config cache (`astConfigCache`) is a singleton rather than a `Map` — adequate since sanding always operates in the same workspace.

## Key Design Decisions

- Identifier text is included in node serialization to detect renames — otherwise `rename(a, b)` would produce the same hash as `rename(a, c)`.
- Literal values (string/number literals) are intentionally **excluded** from the hash — changing a string constant is not a structural change.
- `getAstCompilerOptions()` falls back to safe defaults if `tsconfig.json` is missing, ensuring the hash never crashes on a bare-bones project.

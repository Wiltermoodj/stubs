---
title: Sanding & Sync Engine — Domain Context Map
type: domain-context-map
domain: sanding
parent_map: ../context-map.md
description: Deep-dive context map for the AST hashing, bi-directional spec/code synchronization, and drift healing engine.
tags:
  - domain-map
  - sanding
  - ast
---

# Sanding & Sync Engine — Domain Context Map

[← Back to Root Context Map](../context-map.md)

## Domain Purpose & Responsibilities

The **Sanding Engine** is responsible for bi-directional synchronization between sidecar specs (`*.<ext>.md`) and actual source code files (`*.ts`, `*.py`, `*.go`, etc.). It uses AST structural hashing (ignoring trivial whitespace/comment changes) to detect changes, heal frontmatter hashes, and cleanly synchronize code edits back into sidecar specs or vice versa.

---

## Key Files & Sidecars

| File / Sidecar                                                                                            | Purpose & Exported Symbols                                            | Depends On                                       |
| :-------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------- | :----------------------------------------------- |
| [`src/sanding/engine.ts`](../../src/sanding/engine.ts) / [`engine.ts.md`](../../src/sanding/engine.ts.md) | `SandingEngine` executing 5-phase retroactive reconciliation and sync | `ast.ts`, `parser/okf.ts`                        |
| [`src/sanding/ast.ts`](../../src/sanding/ast.ts) / [`ast.ts.md`](../../src/sanding/ast.ts.md)             | AST parsing, structural normalization, and SHA-256 hashing functions  | `@typescript-eslint/typescript-estree`, `crypto` |

---

## Domain Invariants

- Two files with differing whitespace/comments but identical AST structures produce identical AST structural hashes (`ast_hash`).
- Conflicts are raised only when both the sidecar and the code file have changed with conflicting structural AST differences.

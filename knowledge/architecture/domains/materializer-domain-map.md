---
title: Materializer Engine — Domain Context Map
type: domain-context-map
domain: materializer
parent_map: ../context-map.md
description: Deep-dive context map for extracting executable code blocks from sidecars and materializing them to disk.
tags:
  - domain-map
  - materializer
---

# Materializer Engine — Domain Context Map

[← Back to Root Context Map](../context-map.md)

## Domain Purpose & Responsibilities

The **Materializer Engine** parses sidecar markdown specs, extracts tagged executable code blocks, and writes clean, compilable code files to disk. It handles multi-language support (TypeScript, Python, Go, Rust, Ruby, Shell), executes syntax/type checks, and calculates initial AST hashes.

---

## Key Files & Sidecars

| File / Sidecar                                                                                                           | Purpose & Exported Symbols                                            | Depends On                        |
| :----------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------- | :-------------------------------- |
| [`src/materializer/engine.ts`](../../src/materializer/engine.ts) / [`engine.ts.md`](../../src/materializer/engine.ts.md) | `MaterializerEngine` extracting code blocks and materializing to disk | `parser/okf.ts`, `sanding/ast.ts` |

---

## Domain Invariants

- Materialization will fail gracefully if no valid target code block is present in the sidecar specification.
- Materializer updates or verifies `target_code_file` frontmatter before writing to disk.

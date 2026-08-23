---
title: Markdown Parser — Code Block Extraction
type: sidecar-spec
description: >-
  Extracts and replaces TypeScript implementation code blocks from OKF Markdown
  body text. Locates code under "## Implementation" sections with fallback to
  the first TypeScript block in the document. Used by both the Materializer and
  the Sanding Engine.
tags:
  - parser
  - markdown
  - code-extraction
module_depth: shallow
status: spec
version: 1
target_code_file: ./markdown.ts
status_flag: clean
exports:
  - extractImplementationCode
  - replaceImplementationCode
depends_on:
  - src/parser/okf.ts
used_by:
  - src/materializer/engine.ts
  - src/sanding/engine.ts
---

# Markdown Parser — Code Block Extraction

Provides two pure string-transform functions used throughout the materialization and sanding pipelines.

## Functions

### `extractImplementationCode(body: string): string | null`

Scans the markdown body for a `## Implementation` heading, then extracts the first ` ```typescript ` code block within that section.

**Fallback:** If no `## Implementation` section exists, returns the first ` ```typescript ` block anywhere in the document.

Returns `null` if no TypeScript block is found.

### `replaceImplementationCode(body: string, newCode: string): string`

Replaces the TypeScript block under `## Implementation` with `newCode`.

**Fallbacks (in order):**

1. Replace the first ` ```typescript ` block in the document.
2. Append a new `## Implementation` section with the code block.

## Key Design Decisions

- Both functions normalize `\r\n` → `\n` at entry.
- Section detection is regex-based (`/^#+\s*(?:\d+\.\s*)?Implementation/i`) to handle numbered headings like `## 5. Implementation`.
- No AST parsing — deliberate line-by-line scan for predictability and zero external dependencies.
- `replaceImplementationCode` preserves the surrounding body text and only surgically replaces the code block content, not the fences.

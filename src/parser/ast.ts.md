---
title: Markdown AST — Block Tokenizer
type: sidecar-spec
description: >-
  Tokenizes raw Markdown body text into a structured array of MarkdownBlock
  objects (headings, code blocks, text). Provides a higher-level
  extractImplementationCode function that locates typescript code blocks within
  Implementation sections using the parsed block AST. Used by the
  MaterializerEngine.
tags:
  - parser
  - ast
  - markdown
  - tokenizer
module_depth: shallow
status: spec
version: 1
target_code_file: ./ast.ts
status_flag: clean
exports:
  - MarkdownBlock
  - parseMarkdown
  - extractImplementationCode
depends_on:
  - src/parser/okf.ts
used_by:
  - src/materializer/engine.ts
---

# Markdown AST — Block Tokenizer

Provides a minimal, self-contained Markdown tokenizer that produces a flat array of typed blocks. No external Markdown parsing library is required.

## Types

```typescript
type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'code'; lang: string; content: string }
  | { type: 'text'; content: string };
```

## Functions

### `parseMarkdown(content: string): MarkdownBlock[]`

Single-pass line scanner that produces a flat array of `MarkdownBlock` items. Handles code fence state with `inCodeBlock` flag.

### `extractImplementationCode(blocks: MarkdownBlock[]): { code: string | null; error: string | null }`

Searches parsed blocks for `Implementation` headings (with optional numbering prefix). When multiple Implementation sections exist, **prefers the last one** (iterating `implHeadingIndices` in reverse) to handle the common case of `## Current Implementation` preceding `## Implementation`.

Returns the joined content of all `typescript` / `ts` code blocks within the selected section.

## Key Design Decisions

- Operates on pre-parsed `MarkdownBlock[]` rather than raw strings — separation from `markdown.ts` which operates on raw strings directly.
- "Last wins" Implementation section selection — anticipates real-world sidecar structure where historical implementations precede the canonical one.
- Returns `{ code: null, error: string }` rather than throwing — callers can surface the error message to the user.
- Heading level boundary detection: stops collecting code blocks when it hits a heading at `level <= headingLevel` of the Implementation heading.

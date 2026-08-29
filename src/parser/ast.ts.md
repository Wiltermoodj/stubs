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
status_flag: needs-human-review-resolution
exports:
  - MarkdownBlock
  - parseMarkdown
  - extractImplementationCode
  - extractDistilledSignatures
  - extractExportedSymbolNames
depends_on:
  - src/parser/okf.ts
used_by:
  - src/materializer/engine.ts
  - src/context/engine.ts
stale_details: >-
  Conflict detected: Both sidecar and code files have been modified with
  structural AST differences.
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

### `extractDistilledSignatures(sourceCode: string, fileName?: string): string`

Parses TypeScript source code and strips implementation bodies from exported functions, methods, and classes, while preserving exported interfaces, type aliases, enums, and signatures. Used to create token-efficient context packages for AI agents.

### `extractExportedSymbolNames(sourceCode: string, fileName?: string): string[]`

Inspects the source code's AST statements to extract all exported identifier names (functions, classes, interfaces, types, enums, constants).

## Key Design Decisions

- Operates on pre-parsed `MarkdownBlock[]` rather than raw strings — separation from `markdown.ts` which operates on raw strings directly.
- "Last wins" Implementation section selection — anticipates real-world sidecar structure where historical implementations precede the canonical one.
- Returns `{ code: null, error: string }` rather than throwing — callers can surface the error message to the user.
- Heading level boundary detection: stops collecting code blocks when it hits a heading at `level <= headingLevel` of the Implementation heading.

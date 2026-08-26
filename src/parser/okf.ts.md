---
title: OKF Sidecar Parser
type: sidecar-spec
description: >-
  Parses and validates Open Knowledge Format (OKF) sidecar specification files,
  planning maps, concept documents, and initiative plans. Splits YAML frontmatter
  from Markdown body, validates schemas, extracts conceptual file trees and
  markdown checklists.
tags:
  - parser
  - okf
  - yaml
  - frontmatter
  - filetree
  - checklist
  - foundation
module_depth: deep
status: spec
version: 2
target_code_file: ./okf.ts
status_flag: clean
exports:
  - OkfFrontmatter
  - ParsedOkfSpec
  - FileTreeEntry
  - isCodeSidecar
  - extractFileTreeBlocks
  - parseFileTreeEntries
  - extractMarkdownChecklists
  - parseOkfSpec
used_by:
  - src/graph/engine.ts
  - src/grill/engine.ts
  - src/concept/engine.ts
  - src/concept/tree.ts
  - src/phase/engine.ts
  - src/materializer/engine.ts
  - src/sanding/engine.ts
  - src/autonomy/protocol.ts
  - src/cli/router.ts
---

# OKF Sidecar Parser

Core parsing primitive. Takes raw file content and returns a `ParsedOkfSpec` with either a validated `OkfFrontmatter` + body, or a list of validation errors. Never throws; all errors are accumulated in `result.errors`. Also provides helper parsers for markdown file tree blocks and interactive task checklists.

## OkfFrontmatter Fields

### Required

| Field         | Type       | Values                                                                                                                                                        |
| ------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`       | `string`   | Display name of the module                                                                                                                                    |
| `type`        | enum       | `subsystem-index` \| `sidecar-spec` \| `module-stub` \| `concept-doc` \| `architecture-decision` \| `architecture-doc` \| `planning-map` \| `initiative-plan` |
| `description` | `string`   | Module purpose summary                                                                                                                                        |
| `tags`        | `string[]` | Search/filter tags                                                                                                                                            |
| `status`      | enum       | `skeleton` \| `spec` \| `implemented` \| `materialized` \| `grilling` \| `partially-materialized` \| `active` \| `clean` \| `draft`                           |
| `version`     | `number`   | Monotonic integer                                                                                                                                             |
| `status_flag` | enum       | `clean` \| `dependency-stale` \| `template-outdated` \| `template-realign-required` \| `needs-human-review-resolution` \| `typecheck-failed`                  |

### Optional

| Field              | Type                                   | Purpose                                                                                        |
| ------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `target_code_file` | `string`                               | Relative path to the paired `.ts` file                                                         |
| `phase`            | `string`                               | Current 5-phase lifecycle stage (e.g. `conceptualize`, `grill`, `spec`, `materialize`, `sand`) |
| `initiative`       | `string`                               | Associated initiative key or name                                                              |
| `planned_files`    | `Array<string \| FileTreeEntry>`       | Explicit list of planned file targets                                                          |
| `tasks`            | `Array<{text, completed, line}>`       | Structured tasks tracker list                                                                  |
| `module_depth`     | `'deep' \| 'shallow'`                  | Signals interface complexity                                                                   |
| `context_object`   | `string`                               | Name of the context parameter object                                                           |
| `template_source`  | `string`                               | Template mold origin                                                                           |
| `template_version` | `number \| string`                     | Template version for drift detection                                                           |
| `exports`          | `string[]`                             | Public symbols exported by the target file                                                     |
| `depends_on`       | `string[]`                             | Sidecar file paths this module imports                                                         |
| `used_by`          | `string[]`                             | Sidecar file paths that import this module                                                     |
| `stale_details`    | `string \| null`                       | Human-readable staleness reason                                                                |
| `sync_state`       | object                                 | `last_sync_timestamp`, `sidecar_hash`, `code_hash`                                             |
| `decisions`        | `Array<{id, summary, date}>`           | Architecture Decision Records                                                                  |
| `user_notes`       | `Array<{id, timestamp, text, status}>` | Human directives and grill Q&A                                                                 |

## File Tree and Checklist Extraction

- `extractFileTreeBlocks(markdown: string): string[]`: Extracts content between ````filetree` code blocks.
- `parseFileTreeEntries(treeText: string): FileTreeEntry[]`: Parses hierarchy, paths, types (`file`, `dir`, `spec`), and inline `#` or `//` annotations.
- `extractMarkdownChecklists(markdown: string): Array<{ text, completed, line }>`: Parses `- [ ]` and `- [x]` items with 1-indexed line numbers.

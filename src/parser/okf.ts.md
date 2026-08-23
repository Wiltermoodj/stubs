---
title: OKF Sidecar Parser
type: sidecar-spec
description: >-
  Parses and validates Open Knowledge Format (OKF) sidecar specification files.
  Splits YAML frontmatter from the Markdown body, validates all required and
  optional fields, and returns a structured ParsedOkfSpec result. Used by every
  engine that reads sidecar files.
tags:
  - parser
  - okf
  - yaml
  - frontmatter
  - foundation
module_depth: deep
status: spec
version: 1
target_code_file: ./okf.ts
status_flag: clean
exports:
  - OkfFrontmatter
  - ParsedOkfSpec
  - parseOkfSpec
used_by:
  - src/graph/engine.ts
  - src/grill/engine.ts
  - src/materializer/engine.ts
  - src/sanding/engine.ts
  - src/autonomy/protocol.ts
  - src/cli/router.ts
---

# OKF Sidecar Parser

Core parsing primitive. Takes raw file content and returns a `ParsedOkfSpec` with either a validated `OkfFrontmatter` + body, or a list of validation errors. Never throws; all errors are accumulated in `result.errors`.

## OkfFrontmatter Fields

### Required

| Field              | Type       | Values                                                                                                                                       |
| ------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`            | `string`   | Display name of the module                                                                                                                   |
| `type`             | enum       | `subsystem-index` \| `sidecar-spec` \| `module-stub`                                                                                         |
| `description`      | `string`   | Module purpose summary                                                                                                                       |
| `tags`             | `string[]` | Search/filter tags                                                                                                                           |
| `status`           | enum       | `skeleton` \| `spec` \| `implemented` \| `materialized` \| `grilling` \| `partially-materialized`                                            |
| `version`          | `number`   | Monotonic integer                                                                                                                            |
| `target_code_file` | `string`   | Relative path to the paired `.ts` file                                                                                                       |
| `status_flag`      | enum       | `clean` \| `dependency-stale` \| `template-outdated` \| `template-realign-required` \| `needs-human-review-resolution` \| `typecheck-failed` |

### Optional

| Field              | Type                                   | Purpose                                            |
| ------------------ | -------------------------------------- | -------------------------------------------------- |
| `module_depth`     | `'deep' \| 'shallow'`                  | Signals interface complexity                       |
| `context_object`   | `string`                               | Name of the context parameter object               |
| `template_source`  | `string`                               | Template mold origin                               |
| `template_version` | `number \| string`                     | Template version for drift detection               |
| `exports`          | `string[]`                             | Public symbols exported by the target file         |
| `depends_on`       | `string[]`                             | Sidecar file paths this module imports             |
| `used_by`          | `string[]`                             | Sidecar file paths that import this module         |
| `stale_details`    | `string \| null`                       | Human-readable staleness reason                    |
| `sync_state`       | object                                 | `last_sync_timestamp`, `sidecar_hash`, `code_hash` |
| `decisions`        | `Array<{id, summary, date}>`           | Architecture Decision Records                      |
| `user_notes`       | `Array<{id, timestamp, text, status}>` | Human directives and grill Q&A                     |

## Parse Flow

1. Normalize line endings (`\r\n` → `\n`).
2. Match `^---\n([\s\S]*?)\n---\n([\s\S]*)$` to extract YAML and body.
3. `js-yaml.load()` the YAML text.
4. `validateFrontmatter()` checks each field; errors are pushed to `result.errors`.
5. If `errors.length === 0`, set `isValid = true` and cast frontmatter.

## Key Design Decisions

- Returns `ParsedOkfSpec` with `isValid: false` and populated `errors[]` on any failure — never throws.
- `body` is always populated even when frontmatter is invalid, allowing partial recovery.
- `validateFrontmatter` accumulates all errors in a single pass so callers see every problem at once.

---
title: Changelog Engine — Semantic Architectural Release Notes
type: sidecar-spec
description: >-
  Synthesizes semantic architectural changelogs from git history and sidecar
  specifications, tracking ADR decisions, public interface contract drift,
  and 5-phase lifecycle transitions.
tags:
  - changelog
  - adr
  - semantic-release
  - contract-drift
  - diff
module_depth: deep
context_object: ChangelogEngine
status: spec
version: 1
target_code_file: ./engine.ts
status_flag: clean
exports:
  - ChangelogEngine
  - ChangelogOptions
  - ArchitecturalChangelog
  - ChangelogSummary
  - SpecDiff
  - AdrChange
  - ExportChange
  - PhaseTransition
depends_on:
  - src/config/schema.ts
  - src/parser/okf.ts
  - src/graph/engine.ts
  - src/storage/index.ts
used_by:
  - src/cli/router.ts
---

# Changelog Engine — Semantic Architectural Release Notes

The `ChangelogEngine` extracts architectural evolution from git revisions and OKF sidecar specifications.

## Key Methods

- `diffSpecs(oldContent, newContent, filePath)`: Performs structural diff of ADRs, exported contracts, and lifecycle status between two spec states.
- `generateChangelog(options)`: Analyzes a git revision range (`--since`, `--from`, `--to`) or uncommitted working tree.
- `renderMarkdown(changelog)`: Renders executive summaries, ADR change logs, and contract drift tables.

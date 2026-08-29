---
title: Mock Engine — Spec-Driven Test & Mock Scaffolding
type: sidecar-spec
description: >-
  Synthesizes complete unit test suites and typed mock implementations directly
  from OKF sidecar interface contracts, ADR decisions, and distilled AST signatures.
  Supports Jest, Vitest, and Node test runners to enforce TDD before and during
  code materialization.
tags:
  - mock
  - test-scaffold
  - tdd
  - specification
  - synthesis
module_depth: deep
context_object: MockEngine
status: spec
version: 1
target_code_file: ./engine.ts
status_flag: clean
exports:
  - MockEngine
  - MockOptions
  - MockScaffoldResult
  - MockedTestCase
  - MockedSymbolSuite
  - TestFramework
depends_on:
  - src/config/schema.ts
  - src/parser/okf.ts
  - src/parser/ast.ts
  - src/graph/engine.ts
  - src/storage/index.ts
used_by:
  - src/cli/router.ts
---

# Mock Engine — Spec-Driven Test & Mock Scaffolding

The `MockEngine` parses sidecar specifications and TypeScript source files to automatically generate test scaffolds.

## Features

- **ADR Assertion Synthesis:** Generates test cases verifying each Architectural Decision in the sidecar's frontmatter.
- **Contract-Matching Skeletons:** Creates `describe()` and `it()` blocks for each exported function, class, and interface.
- **Framework Support:** Supports Jest (default) and Vitest.
- **Relative Path Resolution:** Automatically computes relative import paths from `tests/` to `src/`.

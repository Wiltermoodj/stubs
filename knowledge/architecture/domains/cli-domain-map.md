---
title: CLI & Router — Domain Context Map
type: domain-context-map
domain: cli
parent_map: ../context-map.md
description: Deep-dive context map for the CliRouter, command dispatching, argument parsing, and skill installation.
tags:
  - domain-map
  - cli
---

# CLI & Router — Domain Context Map

[← Back to Root Context Map](../context-map.md)

## Domain Purpose & Responsibilities

The **CLI & Router** domain serves as the primary command-line interface for humans and AI agents. It handles all argument parsing, config loading, and routes commands (`init`, `grill`, `materialize`, `sand`, `audit`, `map`, `serve`, `auth`, `install`) downward to their respective subsystem engines.

---

## Key Files & Sidecars

| File / Sidecar                                                                                | Purpose & Exported Symbols                                                           | Depends On                                                            |
| :-------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------- | :-------------------------------------------------------------------- |
| [`src/cli/router.ts`](../../src/cli/router.ts) / [`router.ts.md`](../../src/cli/router.ts.md) | `CliRouter` class handling command parsing, execution, and exit codes                | Subsystem engines (`graph`, `grill`, `sanding`, `materializer`, etc.) |
| [`src/cli.ts`](../../src/cli.ts) / [`cli.ts.md`](../../src/cli.ts.md)                         | Executable entry point instantiating `CliRouter` and invoking `.route(process.argv)` | `cli/router.ts`                                                       |

---

## Domain Invariants

- `CliRouter` pulls all CLI argument complexity downward and returns exit code integers (`0` for success, `1` for error).
- All paths are resolved dynamically relative to `process.cwd()`.

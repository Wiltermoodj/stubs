---
title: CLI Router — Command Dispatcher
type: sidecar-spec
description: >-
  The main CLI command dispatcher. Parses argv, applies global console secret
  masking, routes commands to the appropriate engine handlers, and returns Unix
  exit codes. Provides the CliContext interface and CliRouter class that wraps
  all stubs operations: init, grill, materialize, audit/reconcile, sand/sync,
  validate, template, evaluate, auth, install, update, upgrade, serve, help, version.
tags:
  - cli
  - router
  - commands
  - dispatcher
module_depth: deep
context_object: CliContext
status: spec
version: 1
target_code_file: ./router.ts
status_flag: clean
exports:
  - CliContext
  - CliRouter
depends_on:
  - src/config/schema.ts
  - src/parser/okf.ts
  - src/graph/engine.ts
  - src/templates/engine.ts
  - src/autonomy/protocol.ts
  - src/server/portal.ts
  - src/sanding/engine.ts
  - src/materializer/engine.ts
  - src/storage/credentials.ts
  - src/grill/engine.ts
used_by:
  - src/cli.ts
---

# CLI Router — Command Dispatcher

The outermost layer of the stubs application. Parses raw `process.argv`, routes each command to the correct engine, and returns an integer exit code (0 = success, 1 = failure).

## CliContext

```typescript
interface CliContext {
  configPath?: string; // -c / --config override
  command?: string; // First positional argument
  args: string[]; // Remaining positional and flag arguments
}
```

## Command Routing Table

| Command                             | Handler             | Engine Delegate                       |
| ----------------------------------- | ------------------- | ------------------------------------- |
| `init`                              | `handleInit`        | Direct file write of `DEFAULT_CONFIG` |
| `grill <file>`                      | `handleGrill`       | `GrillEngine.grill()`                 |
| `materialize <file>`                | `handleMaterialize` | `MaterializerEngine.materialize()`    |
| `audit <file>` / `reconcile <file>` | `handleReconcile`   | `AutonomyProtocol.reconcile()`        |
| `sand [file]` / `sync [file]`       | `handleSync`        | `SandingEngine.sync()` or `syncAll()` |
| `validate <file>`                   | `handleValidate`    | `parseOkfSpec()` direct               |
| `template list`                     | `handleTemplate`    | `TemplateEngine.listTemplates()`      |
| `template render <name> <data>`     | `handleTemplate`    | `TemplateEngine.renderTemplate()`     |
| `evaluate <action>`                 | `handleEvaluate`    | `AutonomyProtocol.evaluateAction()`   |
| `auth login`                        | `handleAuth`        | `saveCredentials()`                   |
| `install`                           | `handleInstall`     | GitHub API fetch + file write         |
| `update` / `upgrade`                | `handleUpdate`      | GitHub API refresh + file write       |
| `serve`                             | `handleServe`       | `PortalServer.start()`                |

## Startup Sequence

1. `applyGlobalConsoleMasking()` — patches stdout/stderr to redact stored PAT.
2. `parseArgs(argv)` — extracts command, configPath, and remaining args.
3. Help/version short-circuit checks.
4. `switch(context.command)` dispatch.

## Key Design Decisions

- All handlers return `Promise<number>` (exit code) — never throw to the caller; errors are caught and logged, returning exit code 1.
- `parseArgs` accumulates unknown flags into `context.args[]` rather than erroring — each handler parses its own flags from `ctx.args`, keeping the router thin.
- `--non-interactive` and `--depth` flags are parsed inside `handleGrill`, not in `parseArgs`, since they are command-specific.
- `handleInstall` fetches the stubs skill bundle from `github.com/Wiltermoodj/stubs` using raw GitHub API URLs — does not require `git` to be installed.

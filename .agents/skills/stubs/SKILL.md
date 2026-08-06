---
name: stubs
description: Deterministic AI Agent Sidecar Specification & Autonomy Framework. Manages sidecar specs (*.ts.md), interactive grill engine interrogation, executable code materialization, retroactive reconciliation auditing, AST sanding synchronization, and live web portal dashboard.
---

# stubs — AI Agent Sidecar Specification Skill

`stubs` is an AI agent skill that enables deterministic software development through Markdown-based sidecar specifications (`*.ts.md`). It provides interactive spec grilling, code materialization, 5-phase retroactive reconciliation, AST-based bi-directional code sanding, and a live web portal.

## Invocation Rules & CLI Entry Point

When operating within a project that includes `stubs`, host agents invoke the CLI binary via node using the pre-compiled distribution bundle:

```bash
node .agents/skills/stubs/dist/cli.js <command> [options]
```

Or via `npx stubs` / `stubs` if installed globally or linked in package binaries:

```bash
stubs <command> [options]
```

### Dynamic Workspace Root Rules
- All runtime state (database `.stubs/graph.sqlite`, workspace configuration `.stubs/config.json`, and template molds `.stubs/templates`) resolves relative to the host project's **current working directory (`process.cwd()`)**.
- Never resolve runtime state relative to the `.agents/skills/stubs/dist/` bundle directory.

---

## Core Commands Reference

### 1. `stubs init`
Initializes standard workspace configuration `.stubs/config.json` in the current project directory.
```bash
node .agents/skills/stubs/dist/cli.js init
```

### 2. `stubs grill <file.ts.md>`
Runs the Interactive Grill Engine to interrogate underspecified areas, resolve ambiguities, and record design decisions in sidecar specs.
```bash
node .agents/skills/stubs/dist/cli.js grill src/service.ts.md --depth standard_drill
node .agents/skills/stubs/dist/cli.js grill src/service.ts.md --non-interactive
```
- `--depth <light_probe | standard_drill | deep_interrogation>`: Sets question matrix depth.
- `--non-interactive`: Automates response generation for non-interactive agent execution.

### 3. `stubs materialize <file.ts.md>`
Parses the sidecar specification, extracts embedded TypeScript code blocks, type-checks code against workspace imports, and writes executable code to the target code file.
```bash
node .agents/skills/stubs/dist/cli.js materialize src/service.ts.md
```

### 4. `stubs audit <file.ts.md>` / `stubs reconcile <file.ts.md>`
Audits sidecar specs and executes the 5-phase retroactive reconciliation engine (parsing, target checks, AST structural hashing, frontmatter healing, and conflict resolution).
```bash
node .agents/skills/stubs/dist/cli.js audit src/service.ts.md
```

### 5. `stubs sand [file.ts.md]` / `stubs sync [file.ts.md]`
Executes AST-based bi-directional synchronization between sidecar specs and implementation code files across the workspace.
```bash
node .agents/skills/stubs/dist/cli.js sand
node .agents/skills/stubs/dist/cli.js sand src/service.ts.md
```

### 6. `stubs serve`
Starts the local background Web Portal server and OS filesystem event bridge for live sidecar visualization and real-time SSE broadcasts.
```bash
node .agents/skills/stubs/dist/cli.js serve --port 3000
```

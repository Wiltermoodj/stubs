---
name: stubs
description: Architecture-as-code planning & multi-language sidecar framework. Scaffolds concept/architecture markdown documentation (*.md) and opt-in executable code sidecars (*.<ext>.md), with interactive spec grilling, code materialization, 5-phase retroactive reconciliation, AST sanding sync, and live web portal dashboard.
---

# stubs — Architecture Planning & Multi-Language Sidecar Skill

`stubs` is an AI agent skill for repository architecture planning and deterministic software engineering. It enables agents to create rich **concept/architecture markdown documents** (`*.md`) as the primary artifact format for domain models, decisions, and system designs, with opt-in **code sidecars** (`*.<ext>.md`, e.g. `service.py.md`, `handler.go.md`, `schema.ts.md`) for modules that will be materialized into executable code.

## Primary Workflows

1. **Architecture & Concept Planning (Default):**
   Create standard Markdown files (`*.md`) with OKF frontmatter (`type: concept-doc` or `architecture-doc`) without `target_code_file`. These capture requirements, ADRs, interface contracts, and systems architecture without ever generating code.

2. **Code Sidecars & Materialization (Opt-in):**
   When specifying a module to be implemented in code, name the sidecar with the target extension followed by `.md` (e.g. `auth.ts.md`, `crawler.py.md`, `server.go.md`) and define `target_code_file: ./crawler.py`. The materializer and sanding engine extract code blocks and synchronize bi-directional changes.

---

## Invocation Rules & CLI Entry Point

When operating within a project that includes `stubs`, host agents invoke the CLI binary via node using the pre-compiled distribution bundle:

```bash
node .agents/skills/stubs/dist/cli.cjs <command> [options]
```

Or via `npx stubs` / `stubs` if installed globally or linked in package binaries:

```bash
stubs <command> [options]
```

### Dynamic Workspace Root Rules
- All runtime state (database `.stubs/graph.sqlite`, workspace configuration `.stubs/config.json`, and template molds `.stubs/templates`) resolves relative to the host project's **current working directory (`process.cwd()`)**.
- Never resolve runtime state relative to the `.agents/skills/stubs/dist/` bundle directory.

---

## Sub-Skills Directory

The `stubs` skill delegates to modular sub-skills located under `.agents/skills/stubs/sub-skills/`:

1. **[Grilling](./sub-skills/grilling/SKILL.md):** Stress-test software designs using frontier-based dependency tree rounds.
2. **[Sanding](./sub-skills/sanding/SKILL.md):** Reconcile code-to-spec or spec-to-code drift using AST structural hashes and bi-directional synchronization.
3. **[Materialization](./sub-skills/materialization/SKILL.md):** Extract implementation blocks from sidecar specs into runnable code files (.ts, .py, .go, etc.).
4. **[Auditing](./sub-skills/auditing/SKILL.md):** Perform static analysis, health checks, and graph validation across the workspace.

---

## Core Commands Reference

### 1. `stubs init`
Initializes standard workspace configuration `.stubs/config.json` in the current project directory.
```bash
node .agents/skills/stubs/dist/cli.cjs init
```

### 2. `stubs grill <file.md>`
Runs the Interactive Grill Engine to interrogate underspecified areas, resolve ambiguities, and record design decisions in concept or sidecar specs.
```bash
node .agents/skills/stubs/dist/cli.cjs grill src/service.md --depth standard_drill
node .agents/skills/stubs/dist/cli.cjs grill src/service.md --non-interactive
```
- `--depth <light_probe | standard_drill | deep_interrogation>`: Sets question matrix depth.
- `--non-interactive`: Automates response generation for non-interactive agent execution.

### 3. `stubs materialize <file.md>`
Parses an executable sidecar specification, extracts embedded code blocks (TS, Python, Go, Rust, etc.), and writes executable code to the target code file.
```bash
node .agents/skills/stubs/dist/cli.cjs materialize src/service.py.md
```

### 4. `stubs audit <file.md>` / `stubs reconcile <file.md>`
Audits sidecar specs and executes the 5-phase retroactive reconciliation engine (parsing, target checks, AST structural hashing, frontmatter healing, and conflict resolution).
```bash
node .agents/skills/stubs/dist/cli.cjs audit src/service.ts.md
```

### 5. `stubs sand [file.md]` / `stubs sync [file.md]`
Executes AST-based bi-directional synchronization between sidecar specs and implementation code files across the workspace.
```bash
node .agents/skills/stubs/dist/cli.cjs sand
node .agents/skills/stubs/dist/cli.cjs sand src/service.ts.md
```

### 6. `stubs serve`
Starts the local background Web Portal server and OS filesystem event bridge for live visualization and real-time SSE broadcasts.
```bash
node .agents/skills/stubs/dist/cli.cjs serve --port 3000
```


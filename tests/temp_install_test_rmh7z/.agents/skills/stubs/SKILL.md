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

When operating within a project, invoke the `stubs` CLI directly via:

```bash
npx stubs <command> [options]
# Or globally / via npm script:
stubs <command> [options]
# Or via pre-compiled distribution bundle directly:
node .agents/skills/stubs/dist/cli.cjs <command> [options]
```

### Dynamic Workspace Root Rules
- All runtime state (database `.stubs/graph.sqlite`, workspace configuration `.stubs/config.json`, and template molds `.stubs/templates`) resolves relative to the host project's **current working directory (`process.cwd()`)**.
- Never resolve runtime state relative to the `.agents/skills/stubs/dist/` bundle directory.

---

## Sub-Skills Directory

The `stubs` skill delegates to modular sub-skills located under `.agents/skills/stubs/sub-skills/`:

1. **[Conceptualizing](./sub-skills/conceptualizing/SKILL.md):** Conceptualize domain models, problem framing, initiative task trackers, and planned filetree blueprints.
2. **[Context Mapping](./sub-skills/context-mapping/SKILL.md):** Build, maintain, and audit hierarchical architectural context maps (`knowledge/architecture/context-map.md` and domain maps).
3. **[Grilling](./sub-skills/grilling/SKILL.md):** Stress-test software designs using frontier-based dependency tree rounds.
4. **[Sanding](./sub-skills/sanding/SKILL.md):** Reconcile code-to-spec or spec-to-code drift using AST structural hashes and bi-directional synchronization.
5. **[Materialization](./sub-skills/materialization/SKILL.md):** Extract implementation blocks from sidecar specs into runnable code files (.ts, .py, .go, etc.).
6. **[Auditing](./sub-skills/auditing/SKILL.md):** Perform static analysis, health checks, and graph validation across the workspace.

---

## Core Commands Reference

### 1. `stubs init`
Initializes standard workspace configuration `.stubs/config.json` in the current project directory.
```bash
npx stubs init
```

### 2. `stubs update` / `stubs upgrade`
Refreshes and updates the installed stubs agent skill and assets to the latest version.
```bash
npx stubs update
```

### 3. `stubs map`
Scaffolds or audits the architectural context map hierarchy (`knowledge/architecture/context-map.md` and domain maps).
```bash
npx stubs map --scaffold
npx stubs map
```

### 4. `stubs concept`
Manage concept documents, initiative plans, and automated blueprint scaffolding.
```bash
npx stubs concept new "Payment Processing" --type initiative-plan
npx stubs concept scaffold knowledge/planning/payment-processing-plan.md
npx stubs concept list
```

### 5. `stubs tree`
Visualizes physical disk files combined with planned conceptual blueprint targets and lifecycle status markers.
```bash
npx stubs tree --planned --status
```

### 6. `stubs phase`
Inspects, checks quality gates, and advances specifications through the 5-phase lifecycle state machine.
```bash
npx stubs phase status
npx stubs phase check src/service.ts.md
npx stubs phase advance src/service.ts.md
```

### 7. `stubs grill <file.md>`
Runs the Interactive Grill Engine to interrogate underspecified areas, resolve ambiguities, and record design decisions in concept or sidecar specs.
```bash
npx stubs grill src/service.md --depth standard_drill
npx stubs grill src/service.md --non-interactive
```
- `--depth <light_probe | standard_drill | deep_interrogation>`: Sets question matrix depth.
- `--non-interactive`: Automates response generation for non-interactive agent execution.

### 8. `stubs materialize <file.md>`
Parses an executable sidecar specification, extracts embedded code blocks (TS, Python, Go, Rust, etc.), and writes executable code to the target code file.
```bash
npx stubs materialize src/service.py.md
```

### 9. `stubs audit <file.md>` / `stubs reconcile <file.md>`
Audits sidecar specs and executes the 5-phase retroactive reconciliation engine (parsing, target checks, AST structural hashing, frontmatter healing, and conflict resolution).
```bash
npx stubs audit src/service.ts.md
```

### 10. `stubs sand [file.md]` / `stubs sync [file.md]`
Executes AST-based bi-directional synchronization between sidecar specs and implementation code files across the workspace.
```bash
npx stubs sand
npx stubs sand src/service.ts.md
```

### 11. `stubs serve`
Starts the local background Web Portal server and OS filesystem event bridge for live visualization and real-time SSE broadcasts.
```bash
npx stubs serve --port 3000
```



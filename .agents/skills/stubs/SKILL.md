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

### Dynamic Workspace Root & Graph State Rules
- All runtime state (database `.stubs/graph.sqlite`, workspace configuration `.stubs/config.json`, and template molds `.stubs/templates`) resolves relative to the host project's **current working directory (`process.cwd()`)**.
- **Automated Graph Synchronization:** Agents should run `npx stubs scan` (or `npx stubs scan <dir>`) after creating, refactoring, or deleting code files and sidecar specs to keep `.stubs/graph.sqlite` up to date.
- Never resolve runtime state relative to the `.agents/skills/stubs/dist/` bundle directory.

---

## Sub-Skills Directory

The `stubs` skill delegates to modular sub-skills located under `.agents/skills/stubs/sub-skills/`:

1. **[Conceptualizing](./sub-skills/conceptualizing/SKILL.md):** Conceptualize domain models, problem framing, initiative task trackers, and planned filetree blueprints.
2. **[Context Mapping](./sub-skills/context-mapping/SKILL.md):** Build, maintain, and audit hierarchical architectural context maps (`knowledge/architecture/context-map.md` and domain maps).
3. **[Context & Intelligence](./sub-skills/context/SKILL.md):** Extract token-optimized, tiered context briefings and blast-radius impact analysis for AI agents.
4. **[Grilling](./sub-skills/grilling/SKILL.md):** Stress-test software designs using frontier-based dependency tree rounds.
5. **[Sanding](./sub-skills/sanding/SKILL.md):** Reconcile code-to-spec or spec-to-code drift using AST structural hashes and bi-directional synchronization.
6. **[Materialization](./sub-skills/materialization/SKILL.md):** Extract implementation blocks from sidecar specs into runnable code files (.ts, .py, .go, etc.).
7. **[Auditing](./sub-skills/auditing/SKILL.md):** Perform static analysis, health checks, and graph validation across the workspace.
8. **[Architectural Linting](./sub-skills/lint/SKILL.md):** Validate downward layer hierarchy, cycle bans, and manifest parity in CI.
9. **[Test & Mock Scaffolding](./sub-skills/mock/SKILL.md):** Synthesize unit test suites and typed mocks directly from sidecar specs and AST signatures.
10. **[Mermaid Diagrams & Visualization](./sub-skills/diagram/SKILL.md):** Generate living Mermaid architecture and sequence diagrams directly from the dependency graph.
11. **[Dead Code & Orphan Pruning](./sub-skills/pruning/SKILL.md):** Audit and clean up phantom specs, untracked code files, and stale database records.
12. **[Semantic Architectural Changelog](./sub-skills/changelog/SKILL.md):** Synthesize semantic architectural changelogs, ADR evolution logs, and contract drift reports from git history.

---

## Core Commands Reference

### 1. `stubs init`
Initializes standard workspace configuration `.stubs/config.json` in the current project directory.
```bash
npx stubs init
```

### 2. `stubs scan` / `stubs index`
Scans physical source code files across the codebase, extracts AST declarations and relationships, and populates the SQLite graph database (`.stubs/graph.sqlite`).
```bash
npx stubs scan
npx stubs scan src --json
```

### 3. `stubs update` / `stubs upgrade`
Refreshes and updates the installed stubs agent skill and assets to the latest version.
```bash
npx stubs update
```

### 4. `stubs map`
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

### 11. `stubs context <file.md>`
Generates a token-optimized, topologically sliced context package for AI agent briefings (Target Full + Direct Dependencies Signatures/ADRs + Transitive Symbol Index).
```bash
npx stubs context src/service.ts.md
npx stubs context src/service.ts.md --json
npx stubs context src/service.ts.md --output .stubs/agent-briefing.md
```

### 12. `stubs impact <file.ts>`
Calculates upstream/downstream blast radius, risk scoring (LOW/MEDIUM/HIGH/CRITICAL), domain boundaries, and stale sidecar risks before making code or interface changes.
```bash
npx stubs impact src/storage/index.ts
npx stubs impact src/storage/index.ts --transitive --json
```

### 13. `stubs lint-arch`
Runs zero-dependency architectural guardrails, checking downward layer hierarchy, circular dependency loops, and sidecar manifest parity.
```bash
npx stubs lint-arch
npx stubs lint-arch --strict --json
```

### 14. `stubs mock <file.md>`
Synthesizes Jest/Vitest unit test suites and typed mocks directly from sidecar interface contracts, ADR decisions, and AST signatures.
```bash
npx stubs mock src/service.ts.md
npx stubs mock src/service.ts.md --framework vitest --output tests/unit/service.test.ts
npx stubs mock src/service.ts.md --dry-run
```

### 15. `stubs diagram [target]`
Generates Mermaid architecture flowcharts, sequence diagrams, or neighborhood slices from the dependency graph. Supports automated sync into `context-map.md`.
```bash
npx stubs diagram
npx stubs diagram --group-by domain
npx stubs diagram src/cli/router.ts --type sequence
npx stubs diagram --sync knowledge/architecture/context-map.md
```

### 16. `stubs prune`
Audits the workspace for phantom sidecars, untracked code files, zombie exports, and stale database records.
```bash
npx stubs prune
npx stubs prune --zombies --json
npx stubs prune --fix
```

### 17. `stubs changelog`
Synthesizes semantic architectural changelogs from git history and sidecar specifications, tracking ADR decisions, public interface contract drift, and 5-phase lifecycle transitions.
```bash
npx stubs changelog
npx stubs changelog --since v1.0.0
npx stubs changelog --from main --to HEAD --json
npx stubs changelog --output CHANGELOG.md
```

### 18. `stubs serve`
Starts the local background Web Portal server and OS filesystem event bridge for live visualization and real-time SSE broadcasts.
```bash
npx stubs serve --port 3000
```

### 19. `stubs explain <target>`
Inspects an entity or symbol's architectural profile, incoming/outgoing callers with confidence levels, degree centrality, downstream impact radius, and detected subsystem community.
```bash
npx stubs explain QueryEngine
npx stubs explain src/parser/okf.ts --json
```

### 20. `stubs query "<question or concept>"`
GraphRAG context retrieval: executes multi-hop BFS/DFS subgraph traversal from matched seed nodes and packs relevant architectural signatures, relations, and ADRs within a strict token budget.
```bash
npx stubs query "How does the MCP server work?" --budget 1500
npx stubs query "Parser AST extraction" --dfs --json
```

### 21. `stubs export <obsidian|wiki>`
Exports the entire codebase architecture graph into an interconnected Obsidian Vault (`[[wikilinks]]`) or Wikipedia-style modular markdown documentation with community hub maps.
```bash
npx stubs export obsidian --out ./vault
npx stubs export wiki --out ./wiki
```

### 22. `stubs mcp`
Starts a native Model Context Protocol (MCP) JSON-RPC 2.0 stdio server, exposing `stubs_query`, `stubs_explain`, `stubs_blast`, `stubs_path`, and `stubs_communities` to AI agents and IDEs.
```bash
npx stubs mcp
```

### 23. `stubs hook install`
Installs graph-first rules and hook directives for AI coding agents (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules`), preventing blind full-repo grep scans.
```bash
npx stubs hook install --platform agents
```

# `stubs` — Specification-First AI Software Development

`stubs` is an architectural framework, local execution engine, and AI agent protocol for building, maintaining, and evolving complex codebases.

Instead of jumping directly from natural language prompts to executable code—a practice that leads to architectural drift, broken types, and token-heavy refactoring loops—`stubs` enforces an intermediate **sidecar specification & architecture planning phase**.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CORE DUAL-FILE PARADIGM                           │
├──────────────────────────────────────┬──────────────────────────────────────┤
│    Specification Layer (*.<ext>.md)  │     Executable Source Layer (*.<ext>)│
├──────────────────────────────────────┼──────────────────────────────────────┤
│ • Open Knowledge Format (OKF) sidecar│ • Production-ready executable code   │
│ • YAML frontmatter & graph links     │ • Generated/materialized from spec   │
│ • Defines interfaces, ADRs, & types  │ • Header-linked via @sidecar comment │
│ • Holds human notes & directives     │ • Kept in sync via Code Sanding      │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

---

## What `stubs` Does

- **Dual-File Sidecar Architecture:** Pairs source files (e.g. `*.ts`, `*.py`, `*.go`) with Markdown specifications (`*.ts.md`, `*.py.md`) formatted in Google Open Knowledge Format (OKF), as well as pure architecture/concept markdown docs (`*.md`).
- **Zero-Model Local Core:** Requires zero external API keys, zero local ML models, and no complex runtime dependencies. The host AI agent handles reasoning, while the local CLI performs mechanical operations at 0 token cost.
- **Pluggable Graph & FTS5 Search:** Manages dependencies using a SQLite adjacency graph and FTS5 full-text search engine (`.stubs/graph.sqlite`).
- **Bi-Directional Code Sanding:** Reconciles specification and code drift automatically using AST structural hashes and timestamp vectors (`stubs sand`).
- **Interactive Grilling Engine:** Automatically conducts iterative architectural reviews and stress-tests designs across dependency trees (`stubs grill`).
- **Code Materializer:** Validates in-memory typechecks and extracts executable code blocks from sidecars (`stubs materialize`).
- **Interactive Web Portal & PWA:** Serves an interactive 1-Hop Ego Graph visualization, human directive channel, and template workbench locally (`stubs serve`) or via a touch-friendly PWA.

---

## Installation Guide

### Option 1: Quickstart with `npx` (Zero Installation Required)

Initialize `stubs` immediately in any repository:

```bash
# Initialize configuration, templates, gitignore, and agent skills
npx stubs init

# Or initialize with all agent adapters (Claude, Cursor, Antigravity) and architecture scaffolding:
npx stubs init --all-agents --scaffold
```

---

### Option 2: Install as a Project Dependency (Recommended)

Add `stubs` to your project's `devDependencies`:

```bash
npm install --save-dev stubs
# Or from GitHub repository:
npm install --save-dev github:Wiltermoodj/stubs
```

Once installed, invoke commands directly via `npx` or add a script in `package.json`:

```json
{
  "scripts": {
    "stubs": "stubs"
  }
}
```

Then run:

```bash
npm run stubs -- init
npm run stubs -- sand
npm run stubs -- grill <file.md>
```

---

### Option 3: Global CLI Install

To install the `stubs` command globally:

```bash
npm install -g stubs
# Or from GitHub:
npm install -g github:Wiltermoodj/stubs
```

---

## Updating `stubs`

To update `stubs` to the latest version in your repository without manual reinstallations:

```bash
npx stubs update
# Or if installed:
stubs update
```

The smart updater will:
1. Detect your package manager (`npm`, `pnpm`, `yarn`, `bun`) and update the dependency.
2. Refresh agent skills in `.agents/skills/stubs/` and configured adapters (`.claude/`, `.cursor/`).
3. Seed any new standard templates while **preserving your custom and modified templates**.
4. Automatically perform in-place SQLite schema migrations in `.stubs/graph.sqlite`.

---

## How to Use `stubs` (Recommended Workflow)

### 1. Initialize & Map Architecture

Initialize `.stubs/` configuration and generate an architectural context map:

```bash
stubs init
stubs map --scaffold
```

This generates `knowledge/architecture/context-map.md` and domain maps to structure the application.

### 2. Scaffold Specifications & Sidecars

Create architecture docs (`*.md`) or executable code sidecars (`*.<ext>.md`, e.g. `src/auth.ts.md`) using standard templates:

```bash
# List available templates
stubs template list

# Create a new specification sidecar from a template
stubs template apply spec --name=auth --target=src/auth.ts
```

### 3. Grill & Stress-Test the Design

Before writing production code, run the grilling engine to validate contracts, uncover hidden assumptions, and ensure design invariants hold:

```bash
stubs grill src/auth.ts.md
```

### 4. Materialize Code

Extract implementation code blocks from the sidecar specification into production source files:

```bash
stubs materialize
```

### 5. Sand & Reconcile Drift

Whenever changes are made directly to code or specifications, run the sanding engine to reconcile differences bi-directionally without losing design rationale:

```bash
# Check sync status
stubs sand --dry-run

# Reconcile code & specs
stubs sand
```

### 6. Audit & Validate

Run full workspace health checks, static analysis, and graph validation:

```bash
stubs audit
```

### 7. Launch the Live Web Portal

Launch the local web dashboard for interactive graph navigation, real-time directive submission, and live inspection:

```bash
stubs serve --port=3000
```

---

## CLI Command Reference

| Command                     | Description                                                                                              |
| :-------------------------- | :------------------------------------------------------------------------------------------------------- |
| `stubs install`             | Downloads and installs the skill bundle into `.agents/skills/stubs/`.                                    |
| `stubs update` / `upgrade`  | Updates the installed skill bundle or displays package upgrade commands.                                 |
| `stubs init`                | Initializes `.stubs/config.json` and `.stubs/graph.sqlite` in the current workspace.                     |
| `stubs map`                 | Audits or scaffolds (`--scaffold`) architectural context maps (`knowledge/architecture/context-map.md`). |
| `stubs grill <file>`        | Runs interactive or non-interactive design grilling rounds against a specification.                      |
| `stubs materialize`         | Extracts implementation blocks from sidecar specs into runnable source code files.                       |
| `stubs sand` / `stubs sync` | Bi-directionally syncs AST hashes & frontmatter between code and sidecar specs.                          |
| `stubs audit`               | Validates graph integrity, unlinked files, and specification health.                                     |
| `stubs template`            | Manages and applies specification templates (`list`, `show`, `apply`).                                   |
| `stubs serve`               | Starts the local web portal (`http://localhost:3000`) with SSE live updates.                             |
| `stubs auth login`          | Authenticates and stores GitHub PAT credentials (`~/.stubs/credentials.json`).                           |

---

## Sub-Skills Directory Reference

For agent orchestration, the `stubs` skill exposes specialized sub-skills under `.agents/skills/stubs/sub-skills/`:

- **[Context Mapping](.agents/skills/stubs/sub-skills/context-mapping/SKILL.md):** Hierarchical context maps & domain index management.
- **[Grilling](.agents/skills/stubs/sub-skills/grilling/SKILL.md):** Interactive and automated spec stress-testing.
- **[Materialization](.agents/skills/stubs/sub-skills/materialization/SKILL.md):** Sidecar code extraction and typechecking.
- **[Sanding](.agents/skills/stubs/sub-skills/sanding/SKILL.md):** AST structural hashing and bi-directional drift reconciliation.
- **[Auditing](.agents/skills/stubs/sub-skills/auditing/SKILL.md):** Workspace health checks and static analysis.

---

## Web & PWA Deployment (Source Repo Actions Only)

> ⚠️ **Important:** Web/PWA build and deploy actions are **Source Repository Commands** and must only be executed from a clone of the main `stubs` repository.

```bash
# Build the standalone web bundle (dist/web/)
npm run build:web

# Deploy the static bundle to GitHub Pages
npm run deploy:pages
```

---

## Architectural Principles

- **Deep Modules:** Simple public interfaces that conceal rich internal logic.
- **Context Objects:** Group session, environment, and user state into unified parameters (`AuthContext`, `RequestContext`) to prevent pass-through clutter.
- **Define Errors Out of Existence:** Prefer explicit `Result<T, E>` returns and idempotent APIs over disruptive runtime exceptions.
- **Self-Healing Frontmatter:** Guarantees that manual edit collisions or missing YAML fields never crash the parser.

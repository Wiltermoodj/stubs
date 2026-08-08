# `stubs` — Specification-First AI Software Development

`stubs` is an architectural framework, local execution engine, and AI agent protocol for building, maintaining, and evolving complex TypeScript codebases.

Instead of jumping directly from natural language prompts to executable code—a practice that leads to architectural drift, broken types, and token-heavy refactoring loops—`stubs` enforces an intermediate **sidecar specification phase**.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CORE DUAL-FILE PARADIGM                           │
├──────────────────────────────────────┬──────────────────────────────────────┤
│    Specification Layer (*.ts.md)     │     Executable Source Layer (*.ts)   │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ • Open Knowledge Format (OKF) sidecar│ • Production-ready executable code   │
│ • YAML frontmatter & graph links     │ • Generated via compiler type-checks │
│ • Defines interfaces, ADRs, & types  │ • Header-linked via @sidecar annotation│
│ • Holds human notes & directives     │ • Kept in sync via Code Sanding      │
└──────────────────────────────────────┴──────────────────────────────────────┘

```

---

## What `stubs` Does

- **Dual-File Sidecar Architecture:** Pairs production files (`*.ts`) 1:1 with Markdown specifications (`*.ts.md`) formatted in Google Open Knowledge Format (OKF).

- **Zero-Model Local Core:** Requires zero external API keys, zero local ML models, and no complex runtime dependencies. The host AI agent handles reasoning, while the local CLI performs mechanical operations at 0 token cost.

- **Pluggable Graph & FTS5 Search:** Manages dependencies using a SQLite adjacency graph and FTS5 full-text search engine (`graph.sqlite`).

- **Bi-Directional Code Sanding:** Reconciles specification drift automatically using AST structural hashes and timestamp vectors.

- **Interactive Web Portal & PWA:** Serves an interactive 1-Hop Ego Graph visualization, human directive channel, and template workbench locally or via a touch-friendly PWA.

- **Remote GitHub Collaboration & Mobile Support:** Works across local terminals, remote GitHub branches, and terminal-free mobile browsers using GitHub Personal Access Tokens (PAT) and WASM SQLite (`sql.js`).

---

## Quick Start & Installation

### Target Codebase Invocation & Setup

When working inside a target project/codebase, `stubs` should be executed directly via its CommonJS distribution entrypoint `cli.cjs` to ensure ESM/CommonJS host independence.

#### 1. In-Project Invocation
You can execute `stubs` commands inside your target codebase directly using `node`:
```bash
node .agents/skills/stubs/dist/cli.cjs <command> [options]
```

Or configure a `package.json` script alias inside your target codebase's `package.json`:
```json
"scripts": {
  "stubs": "node .agents/skills/stubs/dist/cli.cjs"
}
```
Now, you can simply run:
```bash
npm run stubs -- <command> [options]
```

#### 2. Global Command Availability (`npm link`)
If you want to invoke `stubs` globally across your system as a standard terminal command (e.g., `stubs init`, `stubs serve`), set up a global link from a clone of the `stubs` source repository:
```bash
# Inside your local clone of the main stubs repository:
npm link

# Now, global stubs availability is active in any terminal path:
stubs init
stubs serve
```

---

### Option 1: Install into Any Codebase (CLI)

To install the `stubs` skill into your active repository's `.agents/skills/stubs/` directory directly from GitHub:

```bash
npx github:Wiltermoodj/stubs install

```

Or, if you have `stubs` globally linked:

```bash
stubs install

```

---

### Option 2: Authenticate with GitHub

To enable remote repository switching, live branch syncing, and PR collaboration, save your GitHub Personal Access Token (PAT):

```bash
stubs auth login --provider=github

```

_(You can also set the `STUBS_GITHUB_PAT` environment variable.)_

---

### Option 3: Use the Zero-Terminal Mobile / PWA View

Access the touch-optimized Web UI from any mobile device or browser without needing local Node.js or terminal tools:

1. Open the hosted PWA or static build (`[https://wiltermoodj.github.io/stubs/](https://wiltermoodj.github.io/stubs/)` or local build).
2. Enter your GitHub PAT in the onboard setup modal.
3. Select your target repository and branch to inspect graph dependencies, submit directives, and review specs in real time using WASM-powered in-memory execution.

---

## Core Workflow Commands

| Command            | Rationale / Action                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `stubs install`    | Downloads and installs the skill bundle from GitHub into `.agents/skills/stubs/`.         |
| `stubs auth login` | Authenticates and securely stores your GitHub PAT globally (`~/.stubs/credentials.json`). |
| `stubs init`       | Initializes `.stubs/` configuration and SQLite graph database in the working directory.   |

|
| `stubs bootstrap` | Scans an existing TypeScript codebase, generates initial `*.ts.md` skeletons, and builds the dependency graph. |
| `stubs serve` | Launches the local HTTP server and Web Portal (`http://localhost:3000`) with SSE live updates.

|
| `stubs materialize` | Runs in-memory `tsc` typechecks on implementation code blocks and extracts them to executable `*.ts` files.

|
| `stubs sand` | Reconciles structural drift between `*.ts` source code and `*.ts.md` specification sidecars.

|

---

## Web & PWA Deployment (Source Repo Actions Only)

> ⚠️ **Important:** Web/PWA build and deploy actions are **Source Repository Commands** and must only be executed from a local clone of the main `stubs` repository. They cannot be executed inside target user projects.

To build or deploy the static Web UI for browser and mobile access manually from the main `stubs` source repository clone:

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

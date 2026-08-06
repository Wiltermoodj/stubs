Architecture & Design Specification: stubs AI Agent Skill
Document Status: Master Architecture & System Design Specification
Version: 1.3.0
Target Engine Runtime: Node.js / TypeScript (ES2022+)
Knowledge Representation Standard: Google Open Knowledge Format (OKF)
Software Design Standard: DESIGN_PHILOSOPHY.md
Persistence & Search Engine: SQLite3 + FTS5 Full-Text Search + Graph Adjacency Engine (Zero-Model Default)
1. Executive Summary & Core Architectural Tenets
The stubs framework provides an architecture, execution engine, and AI agent instruction protocol for building, maintaining, and evolving complex software codebases.
Instead of jumping directly from high-level natural language prompts to executable source code—a process prone to architectural drift, hidden type mismatches, and token-heavy refactoring loops—stubs forces an intermediate sidecar specification phase.
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CORE DUAL-FILE PARADIGM                           │
├──────────────────────────────────────┬──────────────────────────────────────┤
│ Specification Layer (*.ts.md)        │ Executable Source Layer (*.ts)       │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ • Permanent OKF Markdown sidecar     │ • Materialized, production-ready code│
│ • Contains YAML frontmatter & graph  │ • Generated via compiler type-checks │
│ • Defines interfaces, ADRs, & types  │ • Header-linked via @sidecar annotation│
│ • Preserves human context & notes    │ • Kept in sync via Code Sanding      │
└──────────────────────────────────────┴──────────────────────────────────────┘

Key Architectural Tenets
 * Dual-File Sidecar Architecture: Every production source file (*.ts) is paired 1:1 with an Open Knowledge Format Markdown specification sidecar (*.ts.md). Specifications are permanent, living architectural assets.
 * Zero-Model Core Engine: Drop-in skill installation requires zero external API keys, zero mandatory local ML models, and no environment setup. The host AI agent provides reasoning, while the local CLI binary handles mechanical tasks at 0 LLM token cost.
 * Pluggable Search Architecture: Graph traversal, OKF tag matching, and native SQLite FTS5 (Full-Text Search) serve as the core search layer by default. Vector search engines (Host API or Local ONNX) exist strictly as optional, opt-in plugins.
 * Open Knowledge Format (OKF): Every sidecar forms a node in a traversable, graph-structured knowledge network linked via YAML frontmatter (depends_on, used_by, exports, tags).
 * Deep Module Enforcement: Code generation and interface design strictly enforce deep module boundaries, information hiding, error elimination, and context aggregation.
 * Continuous Re-Grilling & Non-Destructive Refinement: System design is iterative. Re-grilling passes (refine, pivot, delta) propagate contract changes across downstream dependencies without destroying existing work.
 * Local Template Engine & Configurable Autonomy: Project-local molds (.stubs/templates/*) capture recurring patterns. Agents operate under 3 configurable autonomy levels (Strict Gate, Guided Execution, Autonomous/Optimistic) supported by a 5-phase retroactive reconciliation engine.
 * Bi-Directional Code Sanding & Self-Healing: The system reconciles specification drift automatically using AST structural hashes and timestamp vectors, while self-healing corrupted headers or manual formatting edits.
 * Real-Time Web Portal & Event Bridge: A local background server (stubs serve) streams sub-10ms graph updates, pending directives, and template proposals via Server-Sent Events (SSE).
2. Strategic Engineering & Deep Module Philosophy
All agents and developers operating within the stubs framework MUST enforce these core engineering rules across all software modules, shared libraries, and UI layers.
2.1 Strategic vs. Tactical Programming
 * Principle: Working code is not enough. The primary goal is creating clean, well-factored abstractions that minimize future cognitive load.
 * Rule: Every feature task MUST allocate 10–20% of total effort toward refining abstractions, updating sidecar specifications, and cleaning up touched subsystems. "Tactical Tornadoes" (quick patches that introduce caller complexity) are strictly prohibited.
2.2 Deep Modules & Information Hiding
 * Principle: Modules MUST provide a simple, narrow public interface that conceals extensive internal implementation complexity.
 * Rule: Prohibit pass-through / shallow modules that merely re-export underlying functions with zero domain enrichment.
 * Boundary Test: Unit tests MUST target the public interface of a deep module, never its internal private methods. Refactoring module internals MUST NOT break existing unit tests.
2.3 Define Errors Out of Existence
 * Principle: Exception handling is a primary source of software complexity. Design module interfaces so that edge cases fall naturally within normal execution semantics rather than throwing exceptions.
 * Rule: Favor idempotent operations, null-object representations, and explicit Result<T, E> types over throwing disruptive runtime errors. Reserve runtime exceptions strictly for unrecoverable infrastructure faults.
2.4 Distinct Abstraction per Layer ("Different Layer, Different Abstraction")
 * Principle: Adjacent layers in the system stack MUST present fundamentally different representations of the domain.
 * Rule: A Server Action or API endpoint MUST NOT simply mirror the parameter signatures and return types of an underlying database hook or ORM model.
2.5 Pull Complexity Downward
 * Principle: It is far better for a module implementation to be internally complex if it makes its callers vastly simpler.
 * Rule: Modules MUST absorb state machine checks, retry loops, hardware status polling, and default parameter fallbacks internally, presenting callers with clean, single-line invocations.
2.6 Elimination of Temporal Decomposition & Context Objects
 * Principle: Structuring code based on the temporal sequence of operations forces callers to orchestrate complex multi-step setup chains (init(), configure(), process()).
 * Rule (Self-Initialization): Modules MUST handle their own internal setup, lazy loading, and state checks on demand.
 * Rule (Context Objects): Group environment, session, security, and location parameters into a single, unified ContextObject (e.g., AuthContext, RequestContext) to prevent intermediate functions from acting as pass-through parameter carriers.
2.7 Code Cohesion: Bring Together What Belongs Together
 * Principle: Splitting closely related logic into micro-functions or micro-files creates "code splatter," forcing developers to jump across files to trace execution.
 * Rule: Code that shares secret knowledge, operates on the same data structures, or is always executed together MUST reside within the same deep module.
3. Dual-File Topology & Lifecycle State Machine
3.1 File System Layout Standard
src/
├── auth/
│   ├── index.md                 # Subsystem router & graph index
│   ├── jwt.ts                   # Materialized executable code
│   ├── jwt.ts.md                # OKF sidecar specification & ADR
│   ├── session.ts
│   └── session.ts.md
.stubs/
├── graph.sqlite                 # Persistent SQLite graph index & FTS5 search index
├── config.json                  # Project configuration & autonomy rules
├── templates/                   # Handlebars/EJS project molds (*.ts.md.tpl)
│   ├── default.ts.md.tpl
│   └── service.ts.md.tpl
└── scripts/                     # Local deterministic helper scripts
    └── gen-from-template.ts

3.2 Progressive Lifecycle Phase Machine
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Phase 1:       │ ──► │  Phase 2:       │ ──► │  Phase 3:       │ ──► │  Phase 4:       │
│  Skeleton       │     │  Specification  │     │  Materialization│     │  Maintenance    │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
  • High-level      • Interfaces &        • In-memory TS      • Code Sanding
    purpose & scope   types defined         type check pass     • Re-Grilling
  • Valid OKF       • Function            • Extracted to      • Cascade
    frontmatter       signatures            executable          updates
  • Subsystem index • ADRs documented       *.ts file         • Directive
    link created    • status: "spec"      • status:            resolution
                                            "materialized"

4. OKF Specification Sidecar & Frontmatter Schema
Every specification sidecar (*.ts.md) conforms strictly to the following Open Knowledge Format schema:
---
# OKF Core Metadata
title: "JWT Authentication Handler Spec"
type: "sidecar-spec" # subsystem-index | sidecar-spec | module-stub
description: "Architecture, cryptographic trade-offs, and verification interfaces for JWTs."
tags: ["auth", "security", "jwt"]

# Design Philosophy Validation
module_depth: "deep" # deep | shallow
context_object: "AuthContext"

# Template Lineage
template_source: "service-layer"
template_version: 1 # Integer version or "1.0-provisional"

# Stubs Lifecycle Metadata
status: "spec" # skeleton | spec | implemented | materialized | grilling | partially-materialized
version: 3
target_code_file: "./jwt.ts"

# Export Contracts & Graph Links
exports:
  - "verifyToken"
  - "generateToken"
depends_on:
  - "src/config/env.ts.md"
  - "src/types/user.ts.md"
used_by:
  - "src/middleware/authGuard.ts.md"

# System Health & Cascade Flags
status_flag: "clean" # clean | dependency-stale | template-outdated | template-realign-required | needs-human-review-resolution | typecheck-failed
stale_details: null

# Structural Vectors & Synchronization State
sync_state:
  last_sync_timestamp: "2026-08-05T18:00:00Z"
  sidecar_hash: "a1b2c3d4e5f6a7b8c9d0"
  code_hash: "f6g7h8i9j0a1b2c3d4e5"

# Architectural Decision Records (ADRs)
decisions:
  - id: "DEC-001"
    summary: "Adopt ES256 key signing and Result-pattern error returns for token verification."
    date: "2026-08-05"

# Human Directive Channel (Web Portal / Terminal Feedback)
user_notes:
  - id: "NOTE-20260805-01"
    timestamp: "2026-08-05T18:00:00Z"
    text: "Ensure verifyToken handles TokenExpiredError internally and returns explicit Result object."
    status: "pending"
---

# JWT Authentication Handler Specification

## 1. Module Overview & Responsibilities
Provides high-performance JWT token generation and cryptographic verification. Absorbs internal key rotation, algorithm selection, and clock skew mitigation to present callers with a single-line verification entrypoint.

## 2. Interfaces & Types
```typescript
export interface AuthContext {
  userId: string;
  roles: string[];
  tenantId: string;
}

export type TokenResult = 
  | { success: true; payload: AuthContext }
  | { success: false; error: "EXPIRED" | "INVALID_SIGNATURE" | "MALFORMED" };

3. Function Signatures
export function verifyToken(rawToken: string, ctx: AuthContext): Promise<TokenResult>;
export function generateToken(payload: AuthContext): Promise<string>;

4. Architectural Decisions & Trade-offs
 * ES256 ECDSA Keys: Selected over RSA to maintain tiny signature sizes and rapid verification times.
 * Stateless Verification: Verification executes without database lookups. Token revocation is managed via short expiration bounds (15\text{ minutes}) combined with refresh token rotation.
5. Implementation
import { jwtVerify, SignJWT } from 'jose';

export async function verifyToken(rawToken: string, ctx: AuthContext): Promise<TokenResult> {
  // Complete executable TypeScript logic written here during 'implemented' phase...
}


---

## 5. Agent Skill Architecture & Execution Protocol

### 5.1 Skill Directory Drop-in Boundary
When dropped into an AI agent's skill directory (e.g., `.claude/skills/stubs`, `.cursor/skills/stubs`, or custom agent environments), `stubs` operates seamlessly without setup:


┌─────────────────────────────────────────────────────────────────────────────┐
│                           SKILL ARCHITECTURE BOUNDARY                       │
├──────────────────────────────────────┬──────────────────────────────────────┤
│ 1. Host AI Agent (The Brain)         │ 2. stubs CLI Runtime (The Muscle)  │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ • Uses host's existing LLM           │ • Deterministic Node.js/TS binary    │
│ • Reads SKILL.md system rules      │ • Runs on host OS with 0 token cost  │
│ • Grills requirements & designs types│ • Manages SQLite graph & frontmatter │
│ • Generates TypeScript logic blocks  │ • Executes in-memory tsc typechecks│
│ • Invokes CLI commands via terminal  │ • Serves local Web UI (stubs serve)│
└──────────────────────────────────────┴──────────────────────────────────────┘

---

## 6. Interactive Grill Engine & Re-Grilling Mechanics


┌─────────────────────────────────────────────────────────────────────────────┐
│                            GRILL DEPTH MATRIX                               │
├─────────┬───────────────┬───────────────────────────┬───────────────────────┤
│ Depth   │ Name          │ Target Question Count     │ Primary Focus         │
├─────────┼───────────────┼───────────────────────────┼───────────────────────┤
│ Level 1 │ Light Probe   │ 1 to 2 questions          │ Inputs, outputs, basic│
│         │               │                           │ happy-path signature. │
├─────────┼───────────────┼───────────────────────────┼───────────────────────┤
│ Level 2 │ Standard Drill│ 2 to 4 questions          │ Deep module interface,│
│ (Default)               │                           │ error elimination,    │
│                         │                           │ Context Objects.      │
├─────────┼───────────────┼───────────────────────────┼───────────────────────┤
│ Level 3 │ Deep Interro- │ 4 to 6 questions          │ ADR trade-offs, race  │
│         │ gation        │                           │ conditions, security, │
│         │               │                           │ cascade risks.        │
└─────────┴───────────────┴───────────────────────────┴───────────────────────┘

---

## 7. Project-Local Template System & Configurable Autonomy

### 7.1 The 3-Tier Agent Autonomy Matrix

1. **Strict Gate (Default):** Agent drafts template proposals and waits for human approval in chat or Web Portal before generating downstream files. Dependent task branches pause or switch to unblocked parallel work.
2. **Guided Execution:** Agent scaffolds Markdown sidecars (`*.ts.md`) using provisional templates, but holds final code materialization (`*.ts`) until template approval.
3. **Autonomous / Optimistic:** Agent creates a provisional template (`v1.0-provisional`), scaffolds sidecars, and materializes code immediately. Asynchronous human review in the Web Portal triggers retroactive reconciliation if changes are made.

---

## 8. CLI Materialization Engine, In-Memory Typechecks & Sanding

### 8.1 In-Memory Typecheck Pipeline


[ Markdown AST Parser ] ──► Extracts ```typescript block from ## Implementation
│
▼
[ In-Memory TS Compiler API ] ──► Loads tsconfig.json & virtual overlay file
│
┌───────────────────────┴───────────────────────┐
▼                                               ▼
[ Diagnostics Fail ]                            [ Diagnostics Pass ]
• Materialization halts                         • Prepend @sidecar header
• Target *.ts untouched                         • Compute SHA-256 hashes
• status_flag: typecheck-failed                 • Execute atomic file write

---

## 9. Web Portal Server (`stubs serve`), REST API & SSE Protocol

The local background server launched by `stubs serve` runs an HTTP server providing an interactive dashboard, REST API, and Server-Sent Events (SSE) bridge with sub-10ms latency updates driven by OS-level filesystem watchers.

---

## 10. Pluggable Search Architecture & Scale Engine

To scale across repositories containing thousands of sidecars without requiring external APIs or local model binaries, `stubs` utilizes a **Tiered Pluggable Search Architecture**.


┌─────────────────────────────────────────────────────────────────────────────┐
│                        TIERED PLUGGABLE SEARCH ARCHITECTURE                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Core Default: Level 1 ] (Zero Setup / Zero Model)                        │
│  • SQLite Adjacency Graph Traversal (depends_on, used_by)               │
│  • OKF Metadata Tag Matching (tags: ["auth", "jwt"])                      │
│  • SQLite FTS5 Full-Text Search (BM25 token relevance across sidecar headers)│
│  • Requires NO API keys, NO local ML models, NO external network calls      │
│                                                                             │
│  [ Optional Plugin: Level 2 ] (Host API Provider)                           │
│  • Uses host-configured API keys (OpenAI, Gemini, Cohere, etc.)             │
│  • Configured via .stubs/config.json for massive enterprise codebases     │
│                                                                             │
│  [ Optional Plugin: Level 3 ] (Air-Gapped Local Vector Engine)               │
│  • Uses sqlite-vec + @xenova/transformers ONNX runtime                  │
│  • 100% offline local vector indexing for air-gapped environments           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

### 10.1 Core Default Search Mechanics (SQLite FTS5 + Graph)

By default, `.stubs/graph.sqlite` manages search using native SQLite capabilities:

```sql
-- Core SQLite FTS5 Full-Text Search Table
CREATE VIRTUAL TABLE IF NOT EXISTS sidecar_fts USING fts5(
    file_path,
    title,
    description,
    tags,
    exports,
    interfaces_text,
    decisions_text,
    content='sidecars',
    content_rowid='id'
);

Search Execution Priority
 * Topological Graph Bounds: Prunes search candidates using depends_on, used_by, and subsystem boundary scopes (src/auth).
 * Metadata Tag Match: Filters sidecars by exact or fuzzy OKF frontmatter tags.
 * FTS5 BM25 Ranking: Executes token-relevance scoring across title, description, interface definitions, and architectural decision records (excluding implementation code blocks).
This zero-model search stack processes queries across 10,000+ sidecar files in under 5 milliseconds with zero external dependencies.
11. Master Architectural Decision Record (ADR) Ledger
| Decision ID | Choice Made | Architectural Rationale |
|---|---|---|
| DEC-ARCH-001 | Permanent Sidecars (*.ts.md). | Provides a living knowledge graph without cluttering runtime .ts files. |
| DEC-ARCH-002 | Google OKF Frontmatter Standard. | Standardizes graph links (depends_on/used_by) for context window budgeting. |
| DEC-ARCH-003 | Depth-Parameterized Grill Protocol (L1–L3). | Prevents agent guessing and supports iterative architectural refinement. |
| DEC-ARCH-004 | Web Portal with 1-Hop Ego Graphs. | Eliminates visual graph clutter while enabling non-IDE specification review. |
| DEC-ARCH-005 | Real-Time SSE Event Bridge. | Enables sub-10ms bi-directional sync between Web Portal and workspace files. |
| DEC-ARCH-006 | CLI Binary + Skill Model. | Eliminates token waste on mechanical tasks while remaining runtime-agnostic. |
| DEC-ARCH-007 | Ousterhout Deep Module Philosophy. | Enforces simple public interfaces, hidden internal complexity, and context objects. |
| DEC-ARCH-008 | Script-First Automation (.stubs/scripts/*). | Allows agents to automate codebase-specific tasks deterministically at 0 token cost. |
| DEC-ARCH-009 | Delegated Host Sandboxing. | Relies on agent host runtimes (Docker, Claude Code sandbox) rather than redundant CLI security logic. |
| DEC-ARCH-010 | Bi-Directional Code Sanding. | Allows direct developer code edits without abandoning the sidecar architecture. |
| DEC-ARCH-011 | Self-Healing Frontmatter Engine. | Guarantees manual edits or corrupted YAML headers never crash the CLI parser. |
| DEC-ARCH-012 | Local Template Engine & Autonomy Matrix. | Captures project patterns while giving users control over agent execution speed vs. safety. |
| DEC-ARCH-013 | 5-Phase Retroactive Reconciliation. | Allows optimistic template execution without risking code loss when templates are heavily modified later. |
| DEC-ARCH-014 | In-Memory TS Compiler Type-Checking. | Validates extracted code syntactically and semantically before writing files to disk. |
| DEC-ARCH-015 | Partial Materialization Flags (--target). | Enables type-only extraction (.d.ts) and stub generation during early prototyping phases. |
| DEC-ARCH-016 | Persistent SQLite Indexing (graph.sqlite). | Eliminates O(N) filesystem parsing overhead on multi-thousand file repositories. |
| DEC-ARCH-017 | Pluggable Search Architecture (SQLite FTS5 Default). | Guarantees zero-config skill drop-in with 0 required model dependencies or API keys. |

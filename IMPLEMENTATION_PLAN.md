# Implementation Plan: Stubs AI Agent Skill

This document outlines the sequential steps to implement the `stubs` framework as detailed in the Architecture & Design Specification.

## Phase 1: Project Initialization & Core Engine Scaffold

- [x] Initialize Node.js / TypeScript (ES2022+) project structure using `npm init`.
- [x] Install and configure testing framework (`jest`), linter (`eslint`), and formatter (`prettier`).
- [x] Define standardized `npm run` scripts for `build`, `test`, `lint`, `format`, and `start` in `package.json`.
- [x] Set up the basic CLI architecture and command router.
- [x] Define the core configuration schema (`.stubs/config.json`).
- [x] Implement the Open Knowledge Format (OKF) frontmatter parser and validator.

## Phase 2: Database & Search Engine Initialization

- [x] Integrate SQLite3 and initialize the `.stubs/graph.sqlite` database.
- [x] Configure the SQLite FTS5 (Full-Text Search) virtual table (`sidecar_fts`).
- [x] Implement the Level 1 Graph Adjacency Engine (Topological graph bounds, metadata tag match, FTS5 BM25 ranking).
- [x] Create the schema and helper functions for persistent index management.

## Phase 3: Markdown AST Parsing & In-Memory Compiler

- [ ] Implement the Markdown AST Parser to extract TypeScript code blocks (`## Implementation`).
- [ ] Integrate the In-Memory TypeScript Compiler API.
- [ ] Implement the type-check pipeline with virtual overlay files and `tsconfig.json` loading.
- [ ] Develop the materialization logic: compute SHA-256 hashes, prepend `@sidecar` headers, and perform atomic file writes.

## Phase 4: Bi-Directional Code Sanding & Sync Engine

- [ ] Develop the synchronization state manager for `sync_state` frontmatter updates.
- [ ] Implement AST structural hashing and timestamp vector comparisons.
- [ ] Create the self-healing frontmatter engine to handle corrupted YAML headers or manual formatting edits.
- [ ] Build the bi-directional code sanding mechanism to reconcile `.ts` and `.ts.md` files.

## Phase 5: Local Template Engine & Autonomy Protocol

- [ ] Implement the Local Template Engine to process Handlebars/EJS project molds (`.stubs/templates/*`).
- [ ] Develop the 3-Tier Agent Autonomy Matrix logic (Strict Gate, Guided Execution, Autonomous/Optimistic).
- [ ] Create the 5-phase retroactive reconciliation engine for the Autonomous tier.

## Phase 6: Interactive Grill Engine

- [x] Implement the Grill Engine state machine.
- [x] Define and implement the 3-level Grill Depth Matrix (Light Probe, Standard Drill, Deep Interrogation).
- [x] Create the interactive terminal prompts and response handlers.

## Phase 7: Real-Time Web Portal & Event Bridge

- [ ] Set up the local background HTTP server (`stubs serve`).
- [ ] Implement the REST API and Server-Sent Events (SSE) bridge.
- [ ] Integrate OS-level filesystem watchers to stream sub-10ms graph updates and pending directives to the Web UI.

## Phase 8: Optional Pluggable Search Engines

- [x] Build the Level 2 (Host API Provider) search plugin for external LLMs.
- [x] Build the Level 3 (Air-Gapped Local Vector Engine) search plugin using `sqlite-vec` and ONNX runtime.

## Phase 9: Testing, Refinement & Finalization

- [ ] Write unit and integration tests (using `jest`) targeting the public interfaces of deep modules.
- [ ] Conduct end-to-end testing of the dual-file lifecycle state machine (Skeleton -> Specification -> Materialization -> Maintenance).
- [ ] Execute `npm run lint` and `npm run format` to ensure adherence to style guidelines.
- [ ] Perform performance testing and optimization (e.g., FTS5 search latency).
- [ ] Finalize documentation and release the `stubs` CLI binary.

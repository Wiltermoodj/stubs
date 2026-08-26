---
title: Stubs Framework — Planning Hub & Initiative Map
type: planning-map
description: Master architectural planning map indexing active initiatives, conceptual blueprints, phase statuses, and multi-agent task trackers.
tags:
  - planning
  - roadmap
  - initiatives
  - lifecycle
status: active
version: 1
status_flag: clean
---

# Stubs Framework — Planning Hub & Initiative Map

The `knowledge/planning/` directory is the centralized operational hub for repository planning, conceptual design, initiative roadmaps, and multi-agent task tracking.

---

## 5-Phase Lifecycle Overview

Every initiative and module in the repository progresses through 5 deterministic phases:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ 1. Conceptualize│ ──► │    2. Grill     │ ──► │ 3. Spec/Scaffold│ ──► │  4. Materialize │ ──► │ 5. Sand & Audit │
│  (Tree & Scope) │     │ (Stress-Test)   │     │ (OKF Sidecars)  │     │(Code Extraction)│     │ (AST Drift Sync)│
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

| Phase                  | Purpose                                               | Artifacts Produced                             | Gate to Next Phase                   |
| :--------------------- | :---------------------------------------------------- | :--------------------------------------------- | :----------------------------------- |
| **1. Conceptualize**   | Problem framing, domain scoping, file tree blueprint  | Concept docs (`type: concept-doc`), `filetree` | File tree defined, initiative linked |
| **2. Grill**           | Interrogate ambiguities, stress-test decisions        | Recorded ADRs & decision tables                | All open questions resolved          |
| **3. Spec / Scaffold** | OKF sidecar specs (`*.ts.md`, `*.py.md`), types, APIs | Skeleton sidecars (`status: spec`)             | Valid OKF frontmatter & signatures   |
| **4. Materialize**     | Implementation code extraction, compiler typechecking | Materialized source files (`*.ts`, `*.py`)     | Clean typecheck & compile pass       |
| **5. Sand & Audit**    | AST structural sync, health checks, drift healing     | Clean synced specs and implementation          | `status_flag: clean`, zero drift     |

---

## Active Initiatives & Task Trackers

| Initiative                                       | Lead / Agents   | Current Phase                     | Task Tracker Link                                       | Target Milestone |
| :----------------------------------------------- | :-------------- | :-------------------------------- | :------------------------------------------------------ | :--------------- |
| **Framework Lifecycle & Planning Hub Expansion** | AI Agent & Team | **Phase 1: Conceptualize / Plan** | [Lifecycle Expansion Plan](lifecycle-expansion-plan.md) | v1.1.0           |

---

## Conceptual Blueprints & Domain Concepts

| Concept Doc                                                        | Scope / Domain                        | Phase         | File Tree Blueprint | Linked Initiative   |
| :----------------------------------------------------------------- | :------------------------------------ | :------------ | :------------------ | :------------------ |
| [Lifecycle & Planning Expansion Plan](lifecycle-expansion-plan.md) | Core CLI, GraphEngine, Parser, Server | Conceptualize | Defined             | Framework Expansion |
| [Context Map](../architecture/context-map.md)                      | Root Architecture Hierarchy           | Spec          | Defined             | System Core         |

---

## Guidelines for Agents and Developers

1. **Register New Work Here:** When conceptualizing a new feature or architectural shift, create an initiative plan (`<initiative>-plan.md`) in this directory and link it above.
2. **Co-locate Subsystem Concepts:** Broad concepts sit in `knowledge/planning/` or `docs/concepts/`; domain-specific concepts may sit directly in subsystem folders (e.g. `src/auth/concept.md`).
3. **Use Task Checklists:** Maintain task checkboxes (`- [ ]` / `- [x]`) in initiative plans. As work progresses, agents and human contributors check off items and add newly discovered tasks dynamically.
4. **Enforce Gating Rules:** Do not move an artifact to `Materialize` before completing the `Grill` and `Spec/Scaffold` phases.

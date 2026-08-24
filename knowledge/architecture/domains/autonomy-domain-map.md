---
title: Autonomy Protocol — Domain Context Map
type: domain-context-map
domain: autonomy
parent_map: ../context-map.md
description: Deep-dive context map for the AutonomyProtocol, human-in-the-loop permission evaluation, and policy enforcement.
tags:
  - domain-map
  - autonomy
---

# Autonomy Protocol — Domain Context Map

[← Back to Root Context Map](../context-map.md)

## Domain Purpose & Responsibilities

The **Autonomy Protocol** enforces safety and permission boundaries on actions proposed by AI agents. It evaluates proposed actions (e.g. `scaffold_sidecar`, `materialize_code`, `draft_template_proposal`) against configured autonomy levels and human-in-the-loop policies stored in `.stubs/config.json`.

---

## Key Files & Sidecars

| File / Sidecar                                                                                                                                                                               | Purpose & Exported Symbols                                            | Depends On                            |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------- | :------------------------------------ |
| [`src/autonomy/protocol.ts`](file:///Users/lappier/code/projects/stubs/src/autonomy/protocol.ts) / [`protocol.ts.md`](file:///Users/lappier/code/projects/stubs/src/autonomy/protocol.ts.md) | `AutonomyProtocol` managing permission levels and proposal evaluation | `graph/engine.ts`, `config/schema.ts` |

---

## Domain Invariants

- Destructive or high-impact actions (like overwriting existing human code without an approved sidecar) require explicit evaluation and approval.

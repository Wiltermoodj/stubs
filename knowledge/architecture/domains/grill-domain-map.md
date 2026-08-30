---
title: Interactive Grill Engine — Domain Context Map
type: domain-context-map
domain: grill
parent_map: ../context-map.md
description: Deep-dive context map for the GrillEngine, dynamic question generation, and design decision recording.
tags:
  - domain-map
  - grill
---

# Interactive Grill Engine — Domain Context Map

[← Back to Root Context Map](../context-map.md)

## Domain Purpose & Responsibilities

The **Interactive Grill Engine** stress-tests software designs and sidecar specs. It interrogates underspecified modules across depth matrices (`light_probe`, `standard_drill`, `deep_interrogation`), resolves ambiguous requirements with the user or automated agent heuristics, and records resolved decisions directly back into the spec's `Design Decisions` section.

---

## Key Files & Sidecars

| File / Sidecar                                                                                      | Purpose & Exported Symbols                                    | Depends On                  |
| :-------------------------------------------------------------------------------------------------- | :------------------------------------------------------------ | :-------------------------- |
| [`src/grill/engine.ts`](../../src/grill/engine.ts) / [`engine.ts.md`](../../src/grill/engine.ts.md) | `GrillEngine` orchestrating Q&A rounds and decision recording | `types.ts`, `parser/okf.ts` |
| [`src/grill/types.ts`](../../src/grill/types.ts) / [`types.ts.md`](../../src/grill/types.ts.md)     | Question tree types, grill depths, and decision contracts     | -                           |

---

## Domain Invariants

- Decisions recorded by the grill engine are appended to the markdown spec without destroying existing user-written prose or code blocks.
- Non-interactive mode must always generate safe deterministic default choices.

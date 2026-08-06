---
title: "0027 - Elevation & Depth Standards"
type: "adr"
description: "Accepted"
status: "active"
last_updated: "2026-07-18T18:35:00Z"
---
# 0027 - Elevation & Depth Standards

## Status
Accepted

## Context
Inconsistent shadow usage — cards with heavy shadows, others with none, dropdowns without elevation distinction from underlying content — creates visual hierarchy confusion. Dark mode compounds problem since shadows become nearly invisible on dark backgrounds.

## Decision
adopt elevation guidelines defined in [Proposal 0012 — Elevation & Depth](../architecture/architecture/proposals/0012-elevation-and-depth.md):

1. **5-Tier Shadow Scale:**`shadow-xs` (resting), `shadow-sm` (raised/hover), `shadow-md` (floating/dropdown), `shadow-lg` (overlay/modal), `shadow-xl` (top-level/toast).
2. **Layering Consistency:** Higher-elevation elements always cast shadows. No shadowless elements above shadowed elements in stacking context.
3. **Backdrop Effects:** Modal overlays use semi-transparent backdrop with `backdrop-filter: blur(4px)`. Light mode: `rgba(0,0,0,0.5)`. Dark mode: `rgba(0,0,0,0.7)`.
4. **Dark Mode Adaptation:** Reduced shadow opacity. Supplement with subtle borders or background lightening to convey elevation.

## Consequences
- Elevation hierarchy consistent and predictable across overlay elements.
- Dark mode surfaces remain visually distinguishable border/lightening supplements.
- Modal focus reinforced backdrop blur and dimming.

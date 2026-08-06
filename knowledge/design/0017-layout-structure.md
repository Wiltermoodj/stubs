---
title: "0017 - Layout & Structure Standards"
type: "adr"
description: "Accepted"
status: "active"
last_updated: "2026-07-18T18:35:00Z"
---
# 0017 - Layout & Structure Standards

## Status
Accepted

## Context
Web application interfaces suffer from inconsistent layout patterns — navigation buried in unpredictable locations, z-index stacking conflicts between modals and dropdowns, and dashboard grids vary wildly between pages. Without shared structural contract, every new page introduces layout drift and increases cognitive load for users and developers.

## Decision
adopt layout guidelines defined in [Proposal 0002 — Layout & Structure](../architecture/architecture/proposals/0002-layout-and-structure.md):

1. **F-Pattern Content Flow:** Primary data and CTAs occupy top-left quadrant. Layouts read top-to-bottom, left-to-right.
2. **Navigation Hierarchy:** Persistent sidebar (5–9 top-level items) for domain navigation. Low-frequency actions (profile, settings, billing) move to header profile menu.
3. **Sidebar Specification:** Collapsed: 64px icon-only. Expanded: 240–280px. Toggle via explicit button. Mobile: full-screen drawer overlay.
4. **Dashboard Grids:** Overview dashboards use 2–3 column grids (max 6 cards above fold). Detail views use single-column stacked sections.
5. **Whitespace Over Borders:** Group related content by proximity and spacing — not containers or dividers. Visible borders reserved for interactive affordances (cards, inputs, tables).
6. **Z-Index Scale:** Standardized global layering — Base (0), Dropdowns (40), Sticky (50), FABs (60), Drawers (70), Modals (80), Toasts (100).

## Consequences
- Eliminates z-index stacking wars between independently developed components.
- Provides predictable content scanning pattern for users across pages.
- Standardizes sidebar behavior, reducing mobile navigation inconsistencies.
- Dashboard real-estate decisions become deterministic based on information density tier.

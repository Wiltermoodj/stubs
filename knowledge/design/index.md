---
title: 'Design Principles Index'
type: 'index'
description: 'Index of all design system ADRs governing UI/UX principles for The Bicycle Butler CRM'
status: 'active'
last_updated: '2026-07-29T15:35:00Z'
---

# Design Principles

Architectural Decision Records governing visual design, interaction patterns, and UI/UX standards for The Bicycle Butler CRM. All design ADRs are **Accepted** and enforced by the `design-system` agent skill.

> **Agent note:** Read the `.agents/skills/design-system/SKILL.md` for the compiled enforcement checklist. Read individual ADRs here for the full rationale and detailed rules.

## Code & Naming Standards

- [0015 - Style Guide](0015-style-guide.md) — `camelCase` in code; `Title Case` in UI display

## Visual Foundations

- [0017 - Layout & Structure Standards](0017-layout-structure.md) — F-pattern, sidebar spec, z-index scale
- [0018 - Spacing & Scaling System](0018-spacing-scaling.md) — 4px grid, 7-token scale, content widths
- [0019 - Typography Standards](0019-typography.md) — 2 families, Golden Ratio modular scale (max 6 tiers), 4 weights
- [0020 - Color System Architecture](0020-color-system.md) — OKLCH modeling, chart hue stepping, Zero Static Alert Colors
- [0021 - Iconography & Imagery Standards](0021-iconography-imagery.md) — Lucide, 5 sizes, avatar chain
- [0027 - Elevation & Depth Standards](0027-elevation-depth.md) — 5-tier shadow scale
- [0028 - Theming & Dark Mode](0028-theming-dark-mode.md) — Token contract, z-index lightness hierarchy (4%–6% dark gap)

## Interaction & Motion

- [0022 - Animations & Micro-Interaction Standards](0022-animations-microinteractions.md) — Ban linear easing, cubic-bezier curves (200ms–500ms), 1000ms icon tooltips, Optimistic UI
- [0038 - Page & Section Transitions](0038-page-section-transitions.md) — Route fade, section slide-in, stagger patterns

## Layout & Navigation

- [0024 - Responsive & Adaptive Layout](0024-responsive-layout.md) — Desktop >1024px, tablet 768–1024px, mobile <768px card transformation
- [0037 - Navigation Header Bar](0037-navigation-header-bar.md) — 3-zone layout, frosted glass, breadcrumb placement
- [0040 - Split Pane Detail Cards Dynamic Layout](0040-split-pane-detail-cards.md) — Dynamic CSS Grid Inspector Pane layout and visual weighting.

## Components

- [0029 - Button Hierarchy & States](0029-button-hierarchy-states.md) — Variant decision rule, menu-gated destructive actions, ghost triggers
- [0032 - Modal & Dialog Standards](0032-modal-dialog-standards.md) — AlertDialog vs Dialog vs Sheet, size tiers, anatomy
- [0033 - Toast & Notification Rules](0033-toast-notification-rules.md) — Auto-dismiss, undo toast, max 3 concurrent
- [0034 - Table Design Standards](0034-table-design-standards.md) — Clean grid lines, numeric right-alignment, density toggle, Concept C & Concept A
- [0035 - System Ban on Badges & Categorical Status Hierarchy](0035-badge-status-indicators.md) — Deprecation of badge.tsx, pills, dots, Concept C/A replacements
- [0036 - Destructive Action Confirmation](0036-destructive-action-confirmation.md) — Menu-gated entry points, neutral resting triggers, AlertDialog anatomy

## Forms & Data

- [0025 - Forms & Input Design](0025-forms-inputs.md) — AI prompt canvases, preview blocks, execution trails & confidence scores, dynamic validation
- [0026 - Data Visualization Standards](0026-data-visualization.md) — Labeled axes, tabular alt, OKLCH palette

## Accessibility

- [0023 - Accessibility Standards](0023-accessibility.md) — WCAG 2.1 AA, focus, keyboard, ARIA, touch targets

## Content & Copy

- [0030 - Content Formatting Standards](0030-content-formatting.md) — Dates, currency, numbers, unknowns (`—`)
- [0031 - UX Copy & Microcopy Standards](0031-ux-copy-microcopy.md) — Tone, button labels, error messages, forbidden phrases

---

## Cross-References

These ADRs are in `knowledge/architecture/adr/` and are referenced by design ADRs:

- [ADR 0011 — Optimistic UI Merging](../architecture/adr/0011-optimistic-ui-merging.md) — referenced by ADR 0022 (animation scoping)
- [ADR 0012 — Human-in-the-Loop AI](../architecture/adr/0012-human-in-the-loop-ai-enrichment.md) — referenced by ADR 0022 (ReviewQueue)

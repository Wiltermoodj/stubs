```markdown
---
title: '0039 - Page Toolbar & Section Header Standards'
type: 'adr'
description: 'Accepted'
status: 'active'
last_updated: '2026-08-01T21:40:00Z'
---

# 0039 - Page Toolbar & Section Header Standards

## Status

Accepted

## Context

Across core application domain views (Organizations, Contacts, Dealers, Expenses, Tasks, Deals, Inventory), section and page toolbars lack visual consistency, introduce arbitrary spatial animations, and occupy excessive vertical real estate (120px–220px before table/data display)[cite: 1]. Legacy implementations suffer from redundant secondary search inputs, loose toggle switches ("Archived", "Incomplete"), deprecated status badge pills, unorganized action rows, and hover-triggered dynamic layout shifts[cite: 1].

A unified architectural standard is required to enforce compact single-row toolbars, clean alignment zones, predictable control caps, and strict accessibility compliance across all entity section headers[cite: 1].

## Decision

### 1. Height & Layout Constraints

- **Maximum Vertical Height:** Standard single-row page toolbars must strictly enforce a maximum height of **52px**[cite: 1].
- **Vertical Real Estate Limit:** When KPI metric summary cards are present above a data grid (e.g., Expenses, Inventory)[cite: 1], the secondary toolbar row must sit immediately adjacent without excess padding[cite: 1]. Total page header space (title + toolbar) must not exceed two structural rows.
- **Strict Prohibition of Hover-to-Show & Spatial Animations:** Hiding essential toolbar elements (e.g., toggles or search fields) behind hover states or triggering sliding/expanding container animations is **strictly prohibited system-wide**[cite: 1]. All controls must remain statically visible or focusable via keyboard navigation without layout reflows (`transition: all linear` is banned per [ADR 0022](0022-animations-microinteractions.md))[cite: 1].

### 2. Header Zone Division & Alignment

Page toolbars enforce a strict 2-zone horizontal layout[cite: 1]:
```

+-------------------------------------------------------------------------------------------------+
| PAGE TOOLBAR BAR (Fixed Height: 52px) |
| +------------------------------------+ +----------------------------------------------------+ |
| | [Title] (e.g., Contacts) | | [Search Input] [Filter Popover] [Add Primary CTA] | |
| | [Sub-label Count (Concept C)] | | (h-9, 260px max) (Consolidated) (Single default) | |
| +------------------------------------+ +----------------------------------------------------+ |
+-------------------------------------------------------------------------------------------------+

```

#### Left Zone: Entity Context & Sub-label Stacking
- **Page Title:** Maximum 24px (`text-2xl font-semibold text-foreground`), adhering to [ADR 0019](0019-typography.md).
- **Concept C Sub-label Stacking:** Item counts, entity totals, or last-updated metadata must render stacked directly beneath the title in muted text (`text-muted-foreground/60 text-xs`)[cite: 1]. Floating status pills, static badges, and colored dots are **strictly deprecated** per [ADR 0035](0035-badge-status-indicators.md)[cite: 1].

#### Right Zone: Utility & Action Controls
- **Compact Search Input:** Page-level search fields must use a static, fixed-width input (`h-9`, `max-w-[260px]`) embedded directly in the right utility zone[cite: 1]. Expanding or sliding search fields are banned[cite: 1].
- **Filter Consolidation:** Loose toggle switches (e.g., "Archived", "Incomplete", "Near Me") must be consolidated into a single compact `Filters` dropdown button (`variant="outline" size="sm"`)[cite: 1].
- **Action Hierarchy Caps:** Each page toolbar enforces strict button limits per [ADR 0029](0029-button-hierarchy-states.md)[cite: 1]:
  - Maximum **1 Primary CTA** (`variant="default" size="sm"`), right-aligned at the top edge[cite: 1].
  - Maximum **1 Secondary Action** (`variant="outline" size="sm"`)[cite: 1].
  - Maximum **1 Overflow Menu** (`variant="ghost" size="icon-sm"`) containing low-frequency utilities (`Import`, `Export`, `Data Cleanup`, `Scan Business Card`)[cite: 1].

### 3. Responsive Adaptations
- **Desktop (>1024px):** Full single-row toolbar layout with compact search input, consolidated filters, and right-aligned primary CTA[cite: 1].
- **Tablet (768px–1024px):** Secondary utilities collapse into the `More Actions` (`...`) overflow menu (`variant="ghost"`)[cite: 1].
- **Mobile (<768px):** Toolbar switches to a vertical stack[cite: 1]:
  - Row 1: Title and Concept C sub-label (Left); Primary CTA (Right)[cite: 1].
  - Row 2: Full-width search input and consolidated filter trigger[cite: 1].
  - Non-standard cryptic indicators (e.g., `(!)`) on mobile are strictly prohibited per [ADR 0024](0024-responsive-layout.md)[cite: 1].

## Consequences
- Toolbar vertical height is compressed from 120px+ down to 52px, maximizing screen real estate for tabular content[cite: 1].
- Layout shifts, spatial sliding animations, and hover-flicker are eliminated[cite: 1].
- WCAG 2.1 Level AA keyboard navigation and touch target standards are fully maintained per [ADR 0023](0023-accessibility.md)[cite: 1].
- Action hierarchy and visual density are standardized across all application views[cite: 1].

```

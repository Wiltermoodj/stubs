---
title: '0035 - System Ban on Badges & Categorical Status Hierarchy'
type: 'adr'
description: 'Accepted'
status: 'active'
last_updated: '2026-08-01T14:52:00Z'
---

# 0035 - System Ban on Badges & Categorical Status Hierarchy

## Status

Accepted

## Context

Legacy UI patterns relied on static status pills, colored dot indicators (`•`), standalone colored status strings, and `badge.tsx` variants. These components created visual noise, caused color clutter on resting screens, and violated human-perceived contrast consistency.

> [!CAUTION]
>
> ### Total Deprecation Notice
>
> The `badge.tsx` component, static status pills, colored status dots (`•`), and standalone colored status text are **completely deprecated system-wide**. No new features may consume `badge.tsx` or introduce pill/dot status indicators.

## Decision

### 1 — System-Wide Deprecation

- **Total Ban:** Static status pills, badges, colored dots (`•`), and standalone colored status strings are strictly prohibited across all views, tables, header bars, and cards.
- **Component Deprecation:** `badge.tsx` is marked deprecated. Existing imports must be refactored to Concept C or Concept A data tier patterns.

### 2 — System-Sanctioned Replacements (See ADR 0034)

All categorical data, entity tiers, lifecycle states, and status metadata must be displayed using the sanctioned patterns defined in [ADR 0034 — Table Design Standards](0034-table-design-standards.md):

#### Concept C (System Standard)

- **Sub-label Stacking Inside Primary Cell:** Primary identifier sits on the top line in `font-medium text-foreground`; secondary tier name, status string, or ID sits stacked on the bottom line in muted text (`text-muted-foreground/60 text-xs`).
- **Zero Color Clutter:** Information hierarchy is established entirely through typography size, weight, and opacity—never static alert colors.

#### Concept A (Enhanced Flare Variant)

- **Left-Edge Margin Wash:** A subtle 6%–12% opacity linear gradient wash fading out within the first 20%–30% container width, reserved strictly for high-contrast or brand-flair requirements.

### 3 — Unread & Notification Indicators

Numeric unread counts or system updates must be represented as plain text numbers or inline typography integrated into item sub-labels, rather than floating colored badges.

## Consequences

- `badge.tsx` and static pill indicators are completely eliminated.
- Resting application views achieve visual harmony through clean typography scale.
- Categorical attributes and status data rely on Concept C sub-label stacking system-wide.

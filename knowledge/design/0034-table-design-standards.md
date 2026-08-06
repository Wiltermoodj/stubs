---
title: '0034 - Table Design Standards'
type: 'adr'
description: 'Accepted'
status: 'active'
last_updated: '2026-08-01T14:52:00Z'
---

# 0034 - Table Design Standards

## Status

Accepted

## Context

`DataTable` handles tabular data display. Outdated paradigms — including dedicated status columns, pill badges, colored dots, heavy vertical grid lines, persistent red delete buttons, and unaligned numbers — create visual clutter and impair scannability.

## Decision

### 1 — Structural Cleanliness (Ban on Badges, Dots & Heavy Grid Lines)

- **Zero Badges, Pills, or Dots:** Dedicated status columns, pill badges, colored dots (`•`), and standalone colored status text strings are **completely banned** system-wide.
- **No Heavy Grid Lines:** Vertical cell borders are forbidden. Table cells rely on generous horizontal spacing and subtle row divider strokes (`border-b border-border/40`).

### 2 — Categorical Data Tier Patterns

All categorical attributes, record tiers, and status information must be displayed using one of two approved system patterns:

#### Concept C (System Standard — Default)

- **Sub-label Stacking Inside a Single Cell:** Primary text sits on the top line; secondary metadata, tier names, and IDs sit stacked on the bottom line within the exact same primary cell.
- **Typography & Opacity Hierarchy:**
  - **Top Line:** Primary Identifier / Name in `font-medium text-foreground`.
  - **Bottom Line:** Muted Tier Name $\cdot$ Secondary ID at **50%–60% opacity** (`text-muted-foreground/60 text-xs`).

```
[ Primary Record Name                             ]
[ Gold Tier · ID: #84920                          ]
```

#### Concept A (Enhanced Flare Variant — Option)

- **Left-Edge Margin Wash:** Reserved for high-contrast or brand-flair requirements.
- **Visual Spec:** A subtle left-edge margin gradient wash ($\approx$6%–12% opacity linear gradient fading out completely within the first 20%–30% container width) applied to the record row or primary cell.

### 3 — Numeric Right-Alignment

- **Mandatory Right-Alignment:** All metrics, financial amounts, percentages, transaction counts, and dates **must strictly be right-aligned** (`text-right`) to align decimal places and numerical scale vertically for instant scanning.
- **Left-Alignment:** Text strings, names, and stacked Concept C labels are left-aligned (`text-left`).
- **Column Header Alignment:** Headers must align with their column data (right-align numeric headers, left-align text headers).

### 4 — Density Toggle Specs

Tables must support a user density toggle:

- **Comfortable Density (Default):** 16px cell padding (`py-4 px-4`), 64px row height (`h-16`). Designed for general overview and browsing.
- **Compact Density:** 8px cell padding (`py-2 px-3`), 48px row height (`h-12`). Designed for financial data grids and high-density operational workflows.

### 5 — Inline & Menu-Gated Row Actions

- Row actions use neutral `ghost` icon buttons.
- Destructive row actions (e.g. Delete, Revoke) **must never appear as persistent red buttons** on resting rows. They must be tucked inside an overflow menu (`...`) triggered by a `MoreHorizontal` ghost icon. Red accent highlights manifest **only when hovering over the destructive item inside the open menu**.

### 6 — Responsive Table Adaptations (ADR 0024)

- **Desktop (>1024px):** Full structured table with comfortable (64px) or compact (48px) rows.
- **Tablet (768px–1024px):** Progressive column hiding; secondary columns collapse into expandable detail rows.
- **Mobile (<768px):** Mandatory Mobile Card Transformation. Grid structures dismantle into stacked cards with top-left primary titles and Concept C sub-labels below.

## Consequences

- Data tables are clean, scannable, and free of noisy badges, dots, and grid lines.
- Numeric alignment enables effortless visual comparison of figures across rows.
- Concept C sub-label stacking compresses primary data and secondary status into a single readable column.
- Menu-gated destructive actions prevent accidental record deletion.

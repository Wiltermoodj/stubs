---
title: "0026 - Data Visualization Standards"
type: "adr"
description: "Accepted"
status: "active"
last_updated: "2026-07-18T18:35:00Z"
---
# 0026 - Data Visualization Standards

## Status
Accepted

## Context
Charts without labeled axes, insufficient color contrast, or missing tabular alternatives inaccessible and misleading. Chart tooltips obscure data points or charts don't reflow on mobile viewports degrade analytical experience.

## Decision
adopt data visualization guidelines defined in [Proposal 0011 — Data Visualization](../architecture/architecture/proposals/0011-data-visualization.md):

1. **Chart Color Palette:** 5–8 colors per theme with ≥30° OKLCH hue separation, WCAG AA contrast, and color vision deficiency distinguishability.
2. **Mandatory Labeling:** Title, labeled axes (with units), legend (multi-series), gridlines at readable intervals.
3. **Tooltips:** Hover (desktop) and tap (mobile). Show exact value, series name, and unit. Follow cursor without obscuring data.
4. **Responsive Reflow:** Below `md` — simplify to key metrics or tabular summary. Legends move below chart. Min height 200px.
5. **Accessibility:** Tabular data alternative for every chart. `aria-label` on chart containers describing trend.

## Consequences
- Charts communicate data clearly enforced labeling standards.
- Color vision deficiency testing prevents inaccessible chart palettes.
- Mobile users get usable data representation instead of squished chart.
- Screen reader users can access data via tabular alternatives.

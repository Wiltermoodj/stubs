---
title: "0024 - Responsive & Adaptive Layout"
type: "adr"
description: "Accepted"
status: "active"
last_updated: "2026-08-01T14:52:00Z"
---
# 0024 - Responsive & Adaptive Layout

## Status
Accepted

## Context
Applications designed only for desktop viewports break on tablets and phones — data tables overflow, multi-column forms become unusable, and fixed-position elements overlap device notches. Without unified breakpoint conventions and explicit component adaptation rules, responsive behavior varies per component.

## Decision
Adopt responsive layout standards across all viewports and components:

1. **4 Breakpoints:** `sm` (≥640px), `md` (≥768px), `lg` (≥1024px), `xl` (≥1280px).
2. **Mobile-First:** Base CSS targets the smallest viewport; layout complexity scales upward responsively.
3. **Data Table Viewport Adaptation Standards:**
   - **Desktop (>1024px):** Render a full structured data table with generous row height (48px–64px) and complete column visibility.
   - **Tablet (768px–1024px):** Enforce progressive column hiding. Secondary metadata columns collapse into expandable inline detail rows or drawer summaries while preserving core primary columns.
   - **Mobile (<768px):** Mandatory **Mobile Card Transformation**. Data tables must dismantle grid row structures and re-render each row as a stacked card with clean internal visual hierarchy (Primary title top-left, stacked sub-labels below via Concept C). Horizontal scrolling for primary tabular data is forbidden.
4. **Form & Navigation Adaptation:** Multi-column forms transition to single-column below 768px (`md`). Side panels convert to slide-over drawers below 1024px (`lg`). Navigation header collapses utility labels to icons below 640px (`sm`).
5. **Safe Area Handling:** `env(safe-area-inset-*)` must be respected for fixed headers, toolbars, and bottom action sheets on devices with display cutouts.
6. **Viewport Meta:** `width=device-width, initial-scale=1`.

## Consequences
- Data tables adapt predictably across all device factors without broken layouts or horizontal scrollbars.
- Mobile card transformation preserves full data clarity and actionability on small screens.
- Mobile-first approach prevents post-hoc responsive fixes.


---
title: '0028 - Theming & Dark Mode'
type: 'adr'
description: 'Accepted'
status: 'active'
last_updated: '2026-08-01T14:52:00Z'
---

# 0028 - Theming & Dark Mode

## Status

Accepted

## Context

Multi-theme applications suffer from incomplete theme definitions and illegible dark mode surface hierarchies. Because dark shades bleed together more easily on digital displays, traditional light-mode contrast gaps are insufficient in dark mode.

## Decision

Adopt theming and dark mode elevation mechanics:

1. **Theme Contract:** Every theme must supply a complete manifest of CSS custom properties. Incomplete theme manifests fail build validation.
2. **Required Token Categories:** 4 surface background tiers, 3 text contrast tiers, primary/secondary/accent + foreground tokens, dynamic feedback colors, border/input/ring, and 5 OKLCH chart series.
3. **Dark Mode Surface Elevation Mechanics:**
   - **z-Index Lightness Progression:** Dark mode surfaces **must strictly get lighter** as z-index increases: Layer 0 Canvas (darkest background) → Layer 1 Frame → Layer 2 Cards/Panels → Layer 3 Modals/Popovers (lightest dark surface).
   - **Double Lightness Contrast Gap:** Dark mode requires **double the lightness contrast gap (4%–6%)** between adjacent elevation layers compared to light mode (2%), preventing dark surfaces from bleeding together visually.
4. **Borders & Shadows in Dark Mode:** Shadows are supplemented or replaced by lightened stroke borders (`border-border/40`). Elevated surface borders derive from the lightness tier above their container.
5. **Media Comfort:** Images and video backgrounds are dimmed 10–15% or slightly desaturated in dark mode to prevent visual blowout.
6. **System Preference:** Default to `prefers-color-scheme`. User overrides (light/dark/system) persist in local storage.

## Consequences

- Dark mode elevation hierarchy is instantly discernible across canvas, card, and modal layers.
- 4%–6% lightness gap prevents surface bleed across complex UI layouts.
- Complete theme contract guarantees zero missing design tokens.

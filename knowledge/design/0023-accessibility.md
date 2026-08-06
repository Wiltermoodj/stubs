---
title: '0023 - Accessibility Standards'
type: 'adr'
description: 'Accepted'
status: 'active'
last_updated: '2026-07-18T18:35:00Z'
---

# 0023 - Accessibility Standards

## Status

Accepted

## Context

Accessibility violations — suppressed focus rings, missing keyboard navigation, color-only status indicators, undersized touch targets — exclude users with disabilities and expose projects to legal risk. Without codified standards, accessibility treated as optional polish structural requirement.

## Decision

adopt accessibility guidelines defined in [Proposal 0008 — Accessibility](../architecture/architecture/proposals/0008-accessibility.md):

1. **WCAG 2.1 Level AA** as minimum compliance target.
2. **Focus Management:** 2px visible ring via `:focus-visible`, focus trapping in modals, focus return on close.
3. **Keyboard Navigation:** mouse-reachable functionality must keyboard-reachable. WAI-ARIA patterns for composite widgets. Skip-navigation links on every page.
4. **Semantic Structure:** One `<h1>` per page, no skipped heading levels, semantic HTML elements (`<nav>`, `<main>`, `<aside>`) over generic `<div>`.
5. **Color Independence:** Never communicate color alone — supplement with icons, text, or patterns.
6. **Touch Targets:** 44×44px minimum hit area for interactive elements.
7. **Screen Reader Support:**`aria-hidden` on decorative images, `aria-label` on icon-only buttons, `aria-live` regions for dynamic updates.

## Consequences

- Accessibility structural requirement, not afterthought.
- Focus management rules prevent keyboard users from getting trapped or lost.
- Color independence ensures status indicators work for color-blind users.
- Touch target minimums guarantee mobile usability.

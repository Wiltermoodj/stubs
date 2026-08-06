# Strict UI & Design Guidelines

This document synthesizes the core UI/UX architectural decisions, design tokens, interaction rules, and component standards governing visual design and user interfaces across the system.

## 1. Visual Foundations & Color System

- **OKLCH Color Modeling:** All color tokens use OKLCH modeling to maintain perceptual uniform lightness, hue integrity, and optimal contrast across themes.
- **Zero Static Alert Colors:** Alert and status indicators dynamic styling rather than hardcoded static hex values.
- **Elevation & Depth:** 5-tier shadow scale (`shadow-xs` to `shadow-xl`) paired with subtle surface lightness shifts.
- **Theming & Dark Mode:** Dark theme uses dynamic OKLCH tokens with strict z-index lightness hierarchy (4%–6% gaps between structural layers).

## 2. Typography & Spacing

- **Typography:** 2 font families (System Sans / Inter for UI, Monospace for code/data). Golden Ratio modular scale (maximum 6 tiers).
- **Naming & Display:** Code/variables in `camelCase`; UI display text in `Title Case` or `Sentence case` depending on context.
- **Spacing Grid:** 4px baseline grid scale with 7 predefined tokens (`space-1` through `space-16`).

## 3. Interaction, Motion & Responsiveness

- **Micro-Interactions:** Smooth cubic-bezier easing curves (200ms–500ms). Linear easing is strictly prohibited.
- **Optimistic UI:** Instant UI feedback on user action with background server sync.
- **Responsive Layout:**
  - Desktop (>1024px): Multi-pane layouts and dynamic CSS Grid split panes.
  - Tablet (768px–1024px): Collapsible sidebars and adaptive panels.
  - Mobile (<768px): Card-transformed lists and full-width sheets.

## 4. Component Standards

- **Button Hierarchy:** Primary, Secondary, Ghost, Destructive variants. Destructive actions must be menu-gated or require neutral resting triggers with explicit confirmation dialogs.
- **Modals & Dialogs:** Strict usage matrix for `AlertDialog` (destructive/critical), `Dialog` (complex task workflows), and `Sheet` (inspector/detail views).
- **Status Indicators:** Categorical status hierarchy replaces ad-hoc badges with structured indicators.
- **Tables & Data:** Clean grid lines, numeric values right-aligned, density toggles, labeled chart axes with accessible tabular alternatives.
- **Toasts & Notifications:** Auto-dismissing notifications, maximum 3 concurrent toasts, support for undo actions.

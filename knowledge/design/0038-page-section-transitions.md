---
title: "0038 - Page & Section Transitions"
type: "adr"
description: "Accepted"
status: "active"
last_updated: "2026-07-29T15:30:00Z"
---
# 0038 - Page & Section Transitions

## Status
Accepted

## Context
ADR 0022 governs element-level animation durations (100–500ms) and easing curves but does not cover route-level transitions or the `animate-in` pattern for sections revealing on mount. Components use `animate-in fade-in slide-in-from-bottom-4` inconsistently — some pages have it, others don't. No rule defines stagger patterns, list item reveals, or when transitions should be skipped entirely.

## Decision

### 1 — Route-Level Transitions
- **Mechanism:** Fade-in only (`fade-in-0` → `fade-in-100`). No slide, flip, scale, or complex transitions at the page level — these add cognitive load and feel disorienting in a data-dense CRM.
- **Duration:** Standard 200ms (ADR 0022 tier 2).
- **Easing:** `ease-out` (elements entering, ADR 0022 §3).
- **Implementation:** Apply to the page root wrapper — the `<main>` element or top-level page `<div>`.
- **Class:** `animate-in fade-in duration-200`

### 2 — Section / Panel Mount Transitions
When a content panel, card, or section mounts into view (not a route change):
- **Pattern:** `animate-in fade-in slide-in-from-bottom-4 duration-300`
- Slide distance is `slide-in-from-bottom-4` (1rem). Never more than `slide-in-from-bottom-6`.
- `ease-out` easing (default for `animate-in`).
- This is the established pattern already in `EmptyState` — codify it as the standard.

### 3 — List Item Stagger
When a list of cards or items mounts together (e.g., search results, dashboard widgets):
- Stagger delay: 20–30ms between items, using `animation-delay` or Tailwind `delay-*` utilities.
- Maximum staggered items: 8. Beyond 8, all remaining items appear simultaneously (no perceptible stagger in large lists).
- Stagger only on initial mount — not on re-renders or filter changes.

```tsx
// Pattern: stagger the first 8 items
{items.map((item, i) => (
  <div
    key={item.id}
    className="animate-in fade-in slide-in-from-bottom-2 duration-300"
    style={{ animationDelay: `${Math.min(i, 7) * 25}ms` }}
  >
    {/* card content */}
  </div>
))}
```

### 4 — Dialog / Sheet Open & Close
Already implemented via Radix data-state attributes. Preserve the existing:
- Open: `fade-in-0 zoom-in-95` (200ms)
- Close: `fade-out-0 zoom-out-95` (200ms)
- Do not add slide animations to dialogs — the zoom + fade is sufficient and avoids jank.

### 5 — Dropdown / Popover Transitions
- Open: `fade-in-0 zoom-in-95` (100ms Micro tier — fast to feel snappy)
- Close: `fade-out-0 zoom-out-95` (100ms)
- Tooltip: fade-in only, 100ms, after 700–1000ms delay (ADR 0022 §5).

### 6 — Skeleton → Content Transition
- When skeleton shimmer resolves to real content: fade-in the content wrapper with `animate-in fade-in duration-200`.
- Never use a slide or scale to replace skeleton — the position is already established; only opacity changes.

### 7 — Reduced Motion Override
All transitions must respect `prefers-reduced-motion: reduce` (ADR 0022 §6).
- `motion-reduce:animate-none` or `motion-reduce:duration-0` on all animated elements.
- Skeleton shimmer also halts: `motion-reduce:after:animate-none`.

### 8 — Forbidden Transition Patterns
| Pattern | Reason |
|---|---|
| `transition: all` | Over-broad; animates unintended properties |
| `linear` easing | Mechanical; banned by ADR 0022 |
| Slide >6 units at page level | Disorienting at large viewport |
| Simultaneous fade + color change | Compound transitions feel sluggish |
| Infinite loops in content area | Reserved for intentional loading states only |
| Scale >105% on enter | Feels aggressive in data-dense context |

## Consequences
- Route transitions are imperceptibly smooth without drawing attention from content.
- Section reveals and card stagger give the UI a sense of responsiveness and polish.
- `animate-in fade-in slide-in-from-bottom-4 duration-300` is the single memorizable pattern for new content mount.
- Reduced-motion users get instant transitions without visual noise.

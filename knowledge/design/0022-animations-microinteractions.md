---
title: "0022 - Animations & Micro-Interaction Standards"
type: "adr"
description: "Accepted"
status: "active"
last_updated: "2026-08-01T15:45:00Z"
---
# 0022 - Animations & Micro-Interaction Standards

## Status
Accepted

## Context
Interfaces designed only for happy paths fail silently when network errors or slow responses occur[cite: 1]. Linear animations feel mechanical and unnatural[cite: 1]. Without strict duration budgets and delay rules, rapid cursor movement creates visual noise[cite: 1].

**Relationship to ADR 0011:** [ADR 0011 — Optimistic UI Merging](../architecture/adr/0011-optimistic-ui-merging.md) governs *data-layer merge strategy* for offline/disconnected states[cite: 1]. This ADR governs the *visual and micro-interaction layer*[cite: 1].

## Decision
Adopt animation and micro-interaction standards across all UI components:

1. **Strict Ban on Linear Easing:** `transition: all linear` is **strictly prohibited system-wide**[cite: 1]. All transitions and animations must use non-linear cubic-bezier physics curves (e.g., `cubic-bezier(0.4, 0, 0.2, 1)` for default ease-in-out, ease-out for entering elements, ease-in for exiting elements)[cite: 1].
2. **Duration Budget Limits (200ms–500ms):** All UI transition durations must strictly fall between **200ms and 500ms**[cite: 1]. Fast micro-interactions use 200ms, standard element transitions use 300ms, and complex surface/layout transitions cap strictly at 500ms[cite: 1]. Durations below 200ms or above 500ms are banned[cite: 1].
3. **1000ms Delayed Tooltip Rule for Icon Controls & Avatar Tags:** Icon-only controls and Avatar name tags must enforce a **1000ms delay** before rendering tooltips/popovers on continuous hover to prevent visual clutter during rapid mouse scanning[cite: 1]. Tooltips dismiss instantly on mouse-out[cite: 1].
4. **Avatar Hover Name Tag Pattern:** User name tag previews on avatars must render exclusively via **Portal-based Tooltips or Popovers** anchored to the avatar base[cite: 1]. Morphing or expanding the avatar container itself is strictly prohibited per [ADR 0021](0021-iconography-imagery.md) to eliminate layout reflows and container clipping[cite: 1].
5. **Unhappy Path First:** Every async operation defines 4 visual states — Empty (illustrated CTA), Loading (skeleton shimmer, not spinner), Error (contextual message + retry), Partial/Degraded (show what succeeded, inline error for what failed)[cite: 1].
6. **Optimistic UI Updates Subsection:** Client UI state **must mutate immediately** upon user action for predictable network calls (e.g., deleting records from lists, toggling statuses, or marking notifications read) before server responses resolve[cite: 1]. If the server call fails, state rolls back smoothly with a high-priority failure toast[cite: 1]. Reversible low-risk operations mutate optimistically; high-risk financial or security mutations require explicit confirmation[cite: 1].
7. **Reduced Motion Compliance:** Respect `prefers-reduced-motion: reduce` by replacing spatial animations with instant state switches or subtle opacity-only fades[cite: 1].

## Consequences
- Mechanical linear transitions are completely eliminated across the application[cite: 1].
- All interaction physics adhere strictly to human visual timing (200ms–500ms)[cite: 1].
- 1000ms tooltip delay eliminates banner flicker during quick cursor movements over toolbars and user avatar lists[cite: 1].
- Portal overlays preserve avatar geometry and layout stability without clipping[cite: 1].
- Optimistic updates provide immediate response for predictable user actions[cite: 1].
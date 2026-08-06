---
title: '0029 - Button Hierarchy & States'
type: 'adr'
description: 'Accepted'
status: 'active'
last_updated: '2026-08-01T15:50:00Z'
---

# 0029 - Button Hierarchy & States

## Status

Accepted

## Context

Button variants must maintain clear visual hierarchy without creating visual anxiety[cite: 1]. Persistent red "Delete" or "Remove" buttons on resting screens disrupt the neutral visual field and risk accidental destructive clicks[cite: 1]. Unbounded motion and arbitrary text-slide effects on standard form actions introduce visual noise and break text accessibility.

## Decision

### 1 — Menu-Gated Destructive Actions Rule

- **Persistent Red Button Ban:** Persistent red "Delete", "Remove", or "Revoke" buttons are **strictly banned** on resting table rows, card surfaces, and default section headers[cite: 1].
- **Overflow Menu Gating:** All row-level or card-level destructive actions must be tucked inside an overflow menu (`...`) or gated behind explicit modal confirmation triggers[cite: 1].
- **Menu Hover Behavior:** The overflow trigger button uses a neutral `ghost` style (`variant="ghost"`)[cite: 1]. Red text and background highlight manifest **only when the user actively hovers over the destructive action item inside the open overflow menu**[cite: 1].

### 2 — Variant Decision Rule

Only one button at each tier is permitted per card, modal footer, or toolbar section[cite: 1]:

| Tier                 | Variant       | When to use                                                                     |
| -------------------- | ------------- | ------------------------------------------------------------------------------- |
| Primary              | `default`     | The single primary CTA on a surface (Save, Confirm, Submit)[cite: 1]            |
| Secondary            | `outline`     | Secondary actions (Edit, Export, Cancel in footers)[cite: 1]                    |
| Tertiary             | `secondary`   | Supporting actions in grouped toolbars or filter bars[cite: 1]                  |
| Quiet / Menu Trigger | `ghost`       | Low-emphasis actions: header icon controls, overflow triggers (`...`)[cite: 1]  |
| Text                 | `link`        | Navigation-style triggers embedded in body text[cite: 1]                        |
| Modal Destructive    | `destructive` | Inside active confirmation modals or active hover states in open menus[cite: 1] |

### 3 — Functional Text-Slide Motion Rule

- **Standard Button State Motion:** Default buttons rely on standard variants (`default`, `outline`, `ghost`) with $200\text{ms}$ background/border transitions and tactile press feedback (`transform: scale(0.97)`).
- **Functional Text-Slide Exception:** Masked vertical text-slide animations (dual text masks sliding on hover or state change) are **strictly permitted only when the sliding text provides functional utility**:
  1. **State/Mode Switchers:** Revealing instant status feedback (e.g., "Copy Link" sliding to "Copied!").
  2. **Space-Constrained CTAs:** Displaying secondary metadata inside tight toolbars (e.g., "Export Data" sliding to "CSV / 1.2 MB").
  3. **Progressive Async Feedback:** Displaying live execution status during async triggers[cite: 1].
- **Prohibitions & Layout Guards:** Text-slide motion is **forbidden** as purely aesthetic duplication, on standard form inputs, or inside dense data table cells. Buttons using text-slide must enforce fixed width/height constraints with `overflow-hidden` to prevent layout reflows.

### 4 — Size Decision Rule

| Size                           | Use                                                          |
| ------------------------------ | ------------------------------------------------------------ |
| `sm`                           | Dense toolbars, table row overflow triggers, chips[cite: 1]  |
| `default`                      | Standard form submissions, modal footers, page CTAs[cite: 1] |
| `lg`                           | Hero sections, onboarding primary CTA only[cite: 1]          |
| `icon` / `icon-sm` / `icon-lg` | Icon-only controls; mandatory `aria-label`[cite: 1]          |

### 5 — Loading State

- Async buttons enter a loading state immediately on click: disabled + spinner (Lucide `Loader2` with `animate-spin`) replaces leading icon or appears left of label[cite: 1].
- Label changes to past-progressive verb where possible ("Saving…", "Deleting…")[cite: 1].
- The button is the status indicator; no separate full-screen spinner is rendered[cite: 1].

### 6 — Icon Placement

- Leading icon only except directional navigation buttons (e.g., "Next →")[cite: 1].
- Icon size: 16px (Action tier from [ADR 0021](0021-iconography-imagery.md))[cite: 1].

### 7 — Keyboard & Focus Defaults

- `Enter` confirms `default` and `outline` buttons when focused[cite: 1].
- `Enter` must **never** auto-confirm destructive buttons inside `AlertDialog`s — focus lands on Cancel by default[cite: 1].
- `Escape` dismisses the surface without action[cite: 1].

## Consequences

- Resting table rows and card surfaces remain clean and neutral with zero persistent red buttons[cite: 1].
- Destructive actions require intentional menu navigation, preventing accidental deletions[cite: 1].
- Button hierarchy is consistent across every page and component[cite: 1].
- Functional text-slide motion communicates dynamic status and secondary metadata without cluttering forms or causing layout shifts.

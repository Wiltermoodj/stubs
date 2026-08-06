---
title: "0032 - Modal & Dialog Standards"
type: "adr"
description: "Accepted"
status: "active"
last_updated: "2026-07-29T15:30:00Z"
---
# 0032 - Modal & Dialog Standards

## Status
Accepted

## Context
Three dialog-type components exist (`dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx`) with z-index and backdrop governed by ADR 0027, but no rule determines which to use when, what size a dialog should be, or what anatomy the header/footer must follow. This produces inconsistent modal experiences across the application.

## Decision

### 1 — Which Component to Use

| Situation | Component | Rationale |
|---|---|---|
| Destructive confirmation (delete, revoke) | `AlertDialog` | Non-dismissable overlay; Enter focuses Cancel by default |
| Informational confirmation (archive, publish) | `Dialog` | Dismissable; standard keyboard behavior |
| Form embedded in overlay (create/edit record) | `Dialog` | Standard modal with scroll |
| Detail preview / contextual panel | `Sheet` (right side) | Preserves page context; easier to dismiss |
| Multi-step wizard | `Dialog` (with stepper) | Contained flow with progress indicator |
| Mobile full-screen flow | `Drawer` (bottom sheet) | Native-feel for touch |

Rule: when in doubt between Dialog and Sheet, prefer **Sheet for read/browse, Dialog for write/confirm**.

### 2 — Dialog Size Tiers

| Size | Max width | Use |
|---|---|---|
| `sm` | `max-w-sm` (384px) | Simple confirmations, single-field inputs |
| `md` (default) | `max-w-lg` (512px) | Standard forms, multi-field create/edit |
| `lg` | `max-w-2xl` (672px) | Complex forms, data-rich content |
| `xl` | `max-w-4xl` (896px) | Multi-column layouts, embedded tables |
| Full-screen | `max-w-full h-full` | Immersive editors, document views |

Current `dialog.tsx` default is `sm:max-w-lg` — this is the `md` tier. Pass `className` to override.

### 3 — Header Anatomy (required)
Every Dialog must have a `DialogHeader` with:
- `DialogTitle` — specific, noun-first: "Edit Contact", "New Deal", "Delete John Smith?"
- `DialogDescription` — optional but recommended for forms; describes scope or consequence
- Close `×` button — top-right, always present (except `AlertDialog` which has no close ×)

Title should be ≤5 words. It names the action, not the entity type alone ("Edit Contact", not "Contact").

### 4 — Footer Anatomy (required)
Every Dialog with actions must have a `DialogFooter`:
- **Button order:** Cancel (left) → Primary action (right). Matches reading order.
- **Cancel:** Always `outline` variant, always labeled "Cancel" (ADR 0031 §2).
- **Primary action:** `default` or `destructive` variant depending on nature of action.
- **Single-action dialogs** (informational alerts): "Got it" button, `default` variant, no Cancel.
- Footer is always sticky — does not scroll out of view. Scrollable content is the body only.

### 5 — Scrollable Body Rule
- Max height: `max-h-[90vh]` (implemented in `dialog.tsx`).
- When content exceeds max-height, only the body scrolls — header and footer remain fixed.
- Scrollable body has `overflow-y-auto` and subtle top/bottom gradient fade to indicate more content.

### 6 — Sheet (Side Panel) Rules
- Always slides in from the **right** — never left, never bottom (bottom drawer is separate component).
- Default width: `w-[400px]` to `w-[540px]`. Never wider than 50vw on desktop.
- Always has a header with title + close ×.
- Sheet footer (if present) is sticky at the bottom.

### 7 — Focus Management (supplements ADR 0023)
- On open: focus lands on the first interactive element (first input in forms, Cancel button in AlertDialog).
- On close: focus returns to the element that triggered the dialog.
- Focus is trapped inside the dialog while open (Radix handles this natively — do not override).

### 8 — Nesting Rule
Never nest a Dialog inside another Dialog. If a secondary action inside a modal requires confirmation, use an inline warning message or replace the dialog content — do not stack overlays.

## Consequences
- Agents and developers have a clear decision tree for which overlay component to use.
- Header/footer anatomy is consistent across the entire product.
- Focus management rules prevent keyboard users from getting lost.
- Overlay nesting is eliminated, preventing z-index and focus management conflicts.

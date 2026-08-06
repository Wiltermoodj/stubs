---
title: "0036 - Destructive Action Confirmation"
type: "adr"
description: "Accepted"
status: "active"
last_updated: "2026-08-01T14:52:00Z"
---
# 0036 - Destructive Action Confirmation

## Status
Accepted

## Context
Destructive actions (deleting records, revoking access, cancelling contracts) present permanent risk of data loss. Destructive workflow entry points must be strictly menu-gated, and preceding trigger controls must remain visually neutral at rest.

## Decision

### 1 — Menu-Gated Destructive Entry Points
- **Resting Trigger Neutrality:** Resting buttons preceding a destructive workflow **must remain neutral or `ghost` style**. Persistent red "Delete" buttons on resting screens are strictly forbidden.
- **Allowed Entry Points:** Destructive workflows can **only** be initiated from inside an open overflow menu (`...`) (where red highlight manifests solely on active item hover) or via explicit modal dialog triggers.

### 2 — When Confirmation Is Required

**Always require confirmation dialog:**
| Action | Reason |
|---|---|
| Permanently delete a record | Irreversible data loss |
| Bulk delete (≥2 records) | Higher impact, harder to recover |
| Revoke user access / role removal | Security consequence |
| Cancel a deal / close a deal (financial) | Revenue-impacting, may affect commissions |
| Disconnect an integration (Google, Stripe) | Service disruption |
| Clear / reset data (import rollback) | Bulk data modification |

**Do NOT require confirmation:**
| Action | Reason |
|---|---|
| Archive a record | Reversible — unarchive is available |
| Mark as inactive | Reversible |
| Reassign an owner | Reversible |
| Save / publish a form | Positive-direction action |

### 3 — Confirmation Dialog Requirements
Use `AlertDialog` (not standard `Dialog` — see ADR 0032) for all hard destructive confirmations:
- **Title:** Question form naming the entity. "Delete John Smith?" / "Delete 5 Contacts?"
- **Description:** Clear sentence explaining the consequence. "This action cannot be undone."
- **Cancel Button:** `outline` variant, left position, labeled "Cancel". Keyboard focus lands on Cancel upon dialog opening.
- **Confirm Button:** `destructive` variant, right position, explicitly naming the action + entity: "Delete Contact", "Delete 5 Contacts".
- **Forbidden:** Enter key auto-confirmation is disabled (Radix default). Confirm button labels like "OK", "Yes", or "Confirm" alone are banned.

### 4 — Undo as Alternative to Confirmation
For soft-delete workflows where records can be recovered within a grace period:
- Skip the confirmation dialog.
- Perform the action immediately (optimistic UI, ADR 0022).
- Show an 8-second undo toast (ADR 0033 §4): "John Smith deleted. [Undo]".

## Consequences
- Resting surfaces remain visually calm without alarming red delete buttons.
- Destructive workflows require deliberate overflow menu interaction.
- Dialog focus defaults protect against accidental keyboard confirms.


---
title: '0031 - UX Copy & Microcopy Standards'
type: 'adr'
description: 'Accepted'
status: 'active'
last_updated: '2026-07-29T15:30:00Z'
---

# 0031 - UX Copy & Microcopy Standards

## Status

Accepted

## Context

No documented tone of voice or copy conventions exist. Strings scattered across components use inconsistent error phrasing ("An error occurred", "Something went wrong", "Failed"), inconsistent button labels ("OK", "Submit", "Save", "Done"), and empty state copy that is clinical or developer-facing ("No records found").

## Decision

### 1 — Tone of Voice

**Professional and direct.** Never corporate-cold, never casual-slangy.

- Address the user as "you" not "the user."
- Use active voice: "Save your changes" not "Changes will be saved."
- Be specific: "Delete John Smith?" not "Delete this record?"
- Skip filler words: "successfully" after an action is implied — toast can just say "Contact saved."

### 2 — Button Labels

- **Verb-first.** Always a verb phrase: "Save Changes", "Delete Contact", "Send Message".
- **Specific over generic.** "Save Changes" > "Save". "Delete Contact" > "Delete". "OK" is banned.
- **Destructive confirm buttons** name the entity: "Delete John Smith", not "Delete" or "Confirm".
- **Cancel** is always "Cancel" — not "Close", "No", "Back", "Dismiss" in dialog footers.
- **Multi-step forms:** "Continue" for forward, "Back" for backward — never "Next" or "Previous".

### 3 — Error Messages

Structure: **What happened** + **What to do**.

- ✅ "Couldn't save contact. Check your connection and try again."
- ✅ "This email is already in use. Sign in instead, or use a different email."
- ❌ "An error occurred."
- ❌ "Something went wrong. Please try again later."
- ❌ "Error 500."

Never show raw error codes, stack traces, or Firebase error IDs to users.

Field-level validation errors (ADR 0025) follow the same rule: "Enter a valid email address" not "Invalid format."

### 4 — Empty State Copy

Empty states are **invitations**, not failure messages.

Structure: **Action-oriented title** + **Brief why/what** + **CTA button** (when applicable).

| Context                   | Title                      | Description                                        |
| ------------------------- | -------------------------- | -------------------------------------------------- |
| No contacts               | "Add your first contact"   | "Start building your network by adding a contact." |
| No deals                  | "Start tracking deals"     | "Add your first deal to see it here."              |
| No search results         | "No results for "{query}"" | "Try different keywords or check your filters."    |
| No notifications          | "You're all caught up"     | "New notifications will appear here."              |
| Filter produced 0 results | "No matches found"         | "Try adjusting your filters."                      |

Rules:

- Title is ≤5 words.
- Description is ≤15 words.
- CTA uses `outline` button variant (ADR 0029 §1).
- No exclamation marks in empty states.

### 5 — Loading Copy

- Prefer skeleton shimmer over any text (ADR 0022).
- If a text fallback is needed: "Loading…" — one word, with ellipsis. Never "Please wait…", "Fetching data…", or "Loading [entity name]…".
- Button loading labels: progressive present tense — "Saving…", "Deleting…", "Sending…" (ADR 0029 §3).

### 6 — Toast / Notification Copy (supplements ADR 0033)

- **Success:** Past tense, entity-specific. "Contact saved." "Deal updated." "Message sent."
- **Error:** What failed + brief next step. "Couldn't save. Try again." (Full detail in error toast action if needed.)
- **Info:** Present tense. "Syncing offline changes…"
- **Destructive undo:** "Contact deleted. Undo?"
- Max 60 characters. No punctuation at end of single-clause toasts.

### 7 — Confirmation Dialog Copy (supplements ADR 0036)

- Title: Question form. "Delete {Name}?"
- Body: One sentence on consequence. "This action cannot be undone."
- For bulk: "Delete {N} contacts? This action cannot be undone."

### 8 — Placeholder Text in Inputs (supplements ADR 0025)

- Placeholder supplements the label — it does not replace it.
- Format: hint, not instruction. "e.g., john@example.com" not "Enter email address".
- Never use placeholder as the only indicator of what a field expects.

### 9 — Forbidden Phrases

The following strings are banned from user-facing copy:

| Banned                      | Replace with                                                |
| --------------------------- | ----------------------------------------------------------- |
| "OK"                        | Specific verb ("Got it" only for informational only alerts) |
| "Submit"                    | "Save", "Send", or specific action                          |
| "An error occurred"         | Specific failure + next step                                |
| "Something went wrong"      | Specific failure + next step                                |
| "N/A"                       | Em-dash `—` (ADR 0030)                                      |
| "Please try again later"    | "Try again" (or specific timeframe if known)                |
| "Loading..." (as page text) | Use skeleton shimmer                                        |
| "No data available"         | Contextual empty state (§4 above)                           |

## Consequences

- Every string in the product conveys exactly what happened and what to do next.
- Users never see developer-facing error messages or ambiguous states.
- Button labels are self-documenting — users always know what a button will do before clicking.
- Empty states feel like gentle invitations rather than dead ends.

---
title: "0037 - Navigation Header Bar"
type: "adr"
description: "Accepted"
status: "active"
last_updated: "2026-07-29T15:30:00Z"
---
# 0037 - Navigation Header Bar

## Status
Accepted

## Context
`top-nav.tsx` implements a `h-16` (64px) header with global search left, and actions right (sync indicator, install button, notifications, theme toggle, user avatar menu). Breadcrumbs are a separate `PlatformBreadcrumbs` component below the header. No standard documents the header's height, zone layout, content rules, or relationship to the sidebar — leaving agents free to add items arbitrarily.

## Decision

### 1 — Header Height
- **Fixed:** `h-16` (64px) on all breakpoints. Do not vary by page or scroll state.
- Header is sticky (`position: sticky; top: 0`), z-index `--z-index-sticky-header` (50, ADR 0017).
- Background: `bg-background/80 backdrop-blur-md` — the frosted-glass treatment already in `top-nav.tsx`. Preserve this; do not make opaque.

### 2 — Zone Layout (3 zones, left → right)

```
[ Left zone (flex-1)      ] [ Center zone (hidden) ] [ Right zone (shrink-0) ]
  Global search                                          Sync · Install · Bell ·
                                                         Theme · Avatar
```

| Zone | Content | Width |
|---|---|---|
| Left | `GlobalSearch` input | `flex-1`, max `xl:max-w-xl` |
| Center | Reserved for future logo on marketing pages. Empty in app. | — |
| Right | Utility icons + avatar menu | `shrink-0`, items in a flex row with `gap-1.5 sm:gap-3` |

The current `top-nav.tsx` layout matches this spec exactly. Do not add nav links, primary CTAs, or breadcrumbs inside the header bar.

### 3 — Global Search (Left Zone)
- Trigger: click on search input OR `⌘K` / `Ctrl+K` keyboard shortcut (implemented in `command-palette.tsx`).
- Search opens `CommandPalette` dialog at modal z-index.
- Search input in header is the visual affordance — it does not execute search itself; it opens the command palette.
- On mobile (below `md`): search input collapses to a `Search` icon button that opens the palette.

### 4 — Right Zone — Allowed Items
Items in the right zone are **utility controls only**. Order (left to right):

1. `GlobalSyncIndicator` — offline/sync state
2. `InstallAppButton` — PWA install prompt (hidden when not applicable)
3. `NotificationBell` — in-app notifications with unread count text indicator
4. `ThemeToggle` — hidden below `sm` breakpoint
5. User avatar `DropdownMenu` — 32px avatar, `ghost` button trigger

No primary navigation links, no page-level CTAs, and no search results belong in the right zone.

### 5 — User Avatar Dropdown — Required Items
The avatar dropdown must always contain in this order:
1. User name + email (non-interactive label)
2. Role text / Concept C sub-label if applicable (e.g. Financial Admin)
3. Separator
4. "Profile" → `/settings/profile`
5. Mode toggle (Field/HQ) if applicable
6. Separator
7. "Log out"

Do not add feature navigation or "quick create" actions here. Those belong in the command palette or sidebar.

### 6 — Breadcrumbs
- `PlatformBreadcrumbs` renders **below** the header in the page body, not inside the header bar.
- Breadcrumb format: `Home (icon) / {Section} / {Entity Name}` with `ChevronRight` separators.
- Current item (last segment): `font-medium text-foreground`. Ancestor items: `text-muted-foreground`, clickable.
- Show breadcrumbs on all pages with ≥2 navigation levels deep.
- Do not show on the dashboard home or top-level section list pages (e.g., `/contacts` index).
- Max visible segments: 4. If deeper, truncate middle segments with `…` and keep first + last 2.

### 7 — Mobile Behavior
- Below `md`: right zone hides `ThemeToggle`.
- Below `sm`: right zone items collapse to icon-only (no labels).
- Left zone: search collapses to icon. Header remains full-width.
- Sidebar toggle (hamburger) on mobile renders inside the sidebar component — not in the header.

## Consequences
- Header zone layout is immutable — agents cannot add nav links or CTAs to the header arbitrarily.
- Search, notifications, and profile are always in predictable positions.
- Breadcrumbs are always below the header — never inside it.
- The frosted-glass backdrop treatment is preserved as the header's defining visual characteristic.

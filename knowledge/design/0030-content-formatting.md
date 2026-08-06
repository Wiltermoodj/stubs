---
title: '0030 - Content Formatting Standards'
type: 'adr'
description: 'Accepted'
status: 'active'
last_updated: '2026-07-29T15:30:00Z'
---

# 0030 - Content Formatting Standards

## Status

Accepted

## Context

No standard exists for how dates, times, numbers, currency, or "unknown" values are displayed to users. This produces inconsistent UI: some dates show as ISO strings, some as full long form, currency loses locale formatting, and missing values alternate between blank cells, "N/A", "null", and em-dashes.

## Decision

### 1 — Date & Time Display

**Relative vs. Absolute rule (mirrors Facebook's recency model):**

| Age of event                     | Display format        | Example              |
| -------------------------------- | --------------------- | -------------------- |
| < 1 minute                       | "Just now"            | Just now             |
| 1–59 minutes                     | "{n} minutes ago"     | 12 minutes ago       |
| 1–23 hours                       | "{n} hours ago"       | 3 hours ago          |
| Yesterday (same calendar day −1) | "Yesterday at {time}" | Yesterday at 2:14 PM |
| 2–6 days ago                     | "{day} at {time}"     | Tuesday at 2:14 PM   |
| Same calendar year               | "MMM D at {time}"     | Jul 29 at 2:14 PM    |
| Different year                   | "MMM D, YYYY"         | Jul 29, 2024         |

**Absolute date format:** `MMM D, YYYY` (e.g., "Jul 29, 2026"). Never `MM/DD/YYYY`.

**Time format:** 12-hour with AM/PM: `2:14 PM`. No leading zero on hours.

**Date-only fields** (no time component): `MMM D, YYYY`. Never ISO string in UI.

**Timestamps in detail views / audit logs:** Full absolute: `Jul 29, 2026 at 2:14 PM`.

**Tooltip rule:** Relative time elements always show full absolute datetime in a tooltip on hover (title attribute or Radix Tooltip).

### 2 — Currency

- **Format:** `$1,234.56` — always USD, comma thousands separator, 2 decimal places.
- **Negative values:** Parentheses format: `($1,234.56)` — not a minus sign. Red `--color-destructive` text.
- **Zero:** Display as `$0.00` — never blank.
- **Large values in dashboards / KPI cards:** Abbreviate with suffix at ≥10,000: `$12.3K`, `$1.2M`, `$1.1B`. Full value appears in tooltip.
- **Range:** `$1,200 – $1,800` (en-dash, spaces either side).

### 3 — Plain Numbers

- **Thousands separator:** Comma: `1,234,567`.
- **Decimals:** Show only when meaningful (counts = 0 decimals; percentages = 1 decimal; rates = 2 decimals).
- **Large count abbreviation:** Same threshold as currency: ≥10,000 → `12.3K`, ≥1,000,000 → `1.2M`.
- **Zero:** Display as `0` — never blank for a numeric field.

### 4 — Percentages

- Format: `12.3%` — always 1 decimal place in data tables and KPI cards.
- Change indicators: positive `+4.2%` with success color, negative `−4.2%` with destructive color. Use Unicode minus `−` (U+2212), not hyphen.

### 5 — Unknown / Empty / Not Set Values

- **Single value fields:** Em-dash `—` (U+2014). Never blank, never "N/A", never "null", never "undefined".
- **Multi-line text fields:** Italic `—` in muted foreground color.
- **Numeric fields:** `—` (not `0`, which has a different meaning).
- **Date fields:** `—`.
- **Optional label fields in forms:** Show placeholder hint text in the input, not `—`.

### 6 — Phone Numbers

- Display: `(555) 867-5309` — US format with parentheses and hyphen.
- International: `+1 (555) 867-5309`.
- Clickable: wrap in `tel:` link.

### 7 — Addresses

- Multi-line inline display: `123 Main St, Suite 4, Denver, CO 80202`.
- Single-line (tables/cards): truncate at available width with ellipsis; show full on hover tooltip.

## Consequences

- All user-facing values display consistently regardless of which component renders them.
- "Unknown" states are visually unambiguous and never confused with zero or false values.
- Relative time keeps feeds feeling alive while absolute tooltips preserve precision.
- Currency formatting matches user expectations for a US-market sales CRM.

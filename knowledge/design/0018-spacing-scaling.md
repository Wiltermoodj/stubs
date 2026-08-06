---
title: "0018 - Spacing & Scaling System"
type: "adr"
description: "Accepted"
status: "active"
last_updated: "2026-07-18T18:35:00Z"
---
# 0018 - Spacing & Scaling System

## Status
Accepted

## Context
Ad-hoc spacing values (13px, 17px) produce visually inconsistent interfaces and make design reviews subjective. Without spacing system, UI density varies unpredictably across pages, and text truncation failures break responsive layouts.

## Decision
adopt spacing guidelines defined in [Proposal 0003 — Spacing & Scaling](../architecture/architecture/proposals/0003-spacing-and-scaling.md):

1. **4-Point Grid:** spacing uses multiples of 4px. Layout spacing between content blocks uses 8px increments.
2. **7-Token Spacing Scale:**`space-1` (4px) `space-12` (48px) — no values outside set.
3. **Minimum Interactive Sizing:** Buttons and inputs ≥36px height. Touch targets ≥44×44px hit area.
4. **Content Width Constraints:** Text capped at 65–75 characters/line. Forms max 640px. Dashboards max 1280px (standard overview) / max 1600px (`max-w-7xl` fluid token for data-dense multi-column financial tables and territory map views).
5. **String Overflow:** Single-line labels use `text-overflow: ellipsis`. Multi-line uses `line-clamp` (2–3 lines max).
6. **Border Radius Tokens:** Derived from single base value (8–12px): `radius-sm`, `radius-md`, `radius-lg`, `radius-xl`, `radius-full`.

## Consequences
- Spacing decisions become deterministic — developers pick from 7 tokens, not infinite pixel values.
- Responsive layouts protected from string overflow by default.
- Border radius consistency maintained token derivation ad-hoc values.
- Touch target minimum ensures mobile usability compliance.

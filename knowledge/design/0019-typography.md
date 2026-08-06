---
title: '0019 - Typography Standards'
type: 'adr'
description: 'Accepted'
status: 'active'
last_updated: '2026-08-01T14:52:00Z'
---

# 0019 - Typography Standards

## Status

Accepted

## Context

Unconstrained font usage leads to inconsistent visual hierarchy. Typography scales require a clear mathematical foundation to maintain harmonic proportions across viewports.

## Decision

Adopt typography standards across all UI components:

1. **2-Family Limit:** One sans-serif primary (e.g., Inter, Geist) + one monospace. Decorative fonts are reserved exclusively for marketing hero headings.
2. **Golden Ratio Mathematical Type Scale (Hard Cap of 6 Tiers):** All typography mathematical scaling rules use Golden Ratio ratios ($\approx 1.618$ modular step proportions) with a strict system-wide hard cap of **6 font tiers**: `xs` (12px), `sm` (14px), `base` (16px), `lg` (18px), `xl` (20px), `2xl` (24px). Application UI maximum font size is strictly 24px.
3. **4-Weight Hierarchy:** 400 (body text), 500 (labels/sub-labels), 600 (headings), 700 (hero/primary CTAs only).
4. **Display Heading Tightening:** For marketing headings beyond 24px, letter-spacing tightens by −2% to −3% and line-height drops to 110%–120%.
5. **Paragraph Readability:** Body line-height must remain between 140% and 160% (never below 140%).

## Consequences

- Golden Ratio modular scale guarantees harmonic visual relationships between heading and body tiers.
- Hard cap of 6 font tiers prevents typographic proliferation across components.
- Dashboard density is protected by the 24px maximum size cap.

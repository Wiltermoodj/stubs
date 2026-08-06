---
title: "0021 - Iconography & Imagery Standards"
type: "adr"
description: "Accepted"
status: "active"
last_updated: "2026-08-01T15:40:00Z"
---
# 0021 - Iconography & Imagery Standards

## Status
Accepted

## Context
Mixed icon sources (different libraries, stock SVGs, emoji) create visual inconsistency. Uncontrolled icon sizing and missing avatar fallbacks degrade interface polish. Images without aspect ratio locking cause layout shifts. Mutating avatar base containers to expand inline tags causes layout reflows and container clipping[cite: 1].

## Decision
adopt iconography guidelines defined in [Proposal 0006 — Iconography & Imagery](../architecture/architecture/proposals/0006-iconography-and-imagery.md):

1. **Single Icon Library:** One framework (e.g., Lucide) across entire project[cite: 1]. No mixed styles, stock SVGs, or emoji for functional UI[cite: 1].
2. **5-Tier Icon Size Scale:** Inline (16px), Action (20px), Navigation (24px), Feature (32px), Hero (48px)[cite: 1].
3. **Dynamic Background Contrast:** Icons on user-uploaded images require solid backdrop, drop-shadow, or scrim overlay[cite: 1].
4. **Avatar System & Fixed Bounds:**
   - **Fixed Geometry & Sizing:** 4 sizes (24/32/40/48px), strictly circular, with fallback chain: uploaded image → initials → generic icon[cite: 1].
   - **Immutable Container Rule:** The `Avatar` base primitive must strictly preserve its 1:1 circular aspect ratio[cite: 1]. Morphing or expanding the Avatar container itself into inline name tags, pills, or cards is strictly prohibited to prevent layout reflows and container clipping[cite: 1]. (Contextual user previews on hover must render via portal overlays per [ADR 0022](0022-animations-microinteractions.md)[cite: 1]).
5. **Image Handling:** Aspect ratio locking, lazy loading below fold, alt text for meaningful images, WebP/AVIF preference[cite: 1].

## Consequences
- Visual consistency across icons via single library[cite: 1].
- Predictable icon sizing eliminates per-component decisions[cite: 1].
- Avatar fallbacks prevent broken/empty user representations[cite: 1].
- Layout stability improves aspect ratio enforcement and prevents avatar shape mutations[cite: 1].
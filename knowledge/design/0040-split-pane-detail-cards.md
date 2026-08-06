---
title: "0040 - Split Pane Detail Cards Dynamic Layout"
type: "adr"
description: "Proposed layout implementation and priority rankings for dynamically rendering Split Pane Detail views."
status: "proposed"
last_updated: "2026-08-03T23:55:00Z"
---

# 0040 - Split Pane Detail Cards Dynamic Layout

## Status
Proposed

## Context
When Tables are shown in the Split Pane view, the right-hand side (Inspector Pane) detail cards currently list very little information. As this pane represents a key area of available real estate for contextual data (often scaling to significant widths on larger screens), it requires a dynamic layout system. The system must render information based on an assigned ranking/priority for that data point, while respecting varying space requirements (widths and heights) for different types of information.

## Decision

We will implement a `DynamicInspector` component to manage the layout of the Split Pane's detail view, adhering to the structural foundations of [ADR 0017 - Layout & Structure Standards](0017-layout-structure.md), the clean aesthetics of [ADR 0034 - Table Design Standards](0034-table-design-standards.md), and the elevation hierarchy of [ADR 0027 - Elevation & Depth Standards](0027-elevation-depth.md).

### 1 — Layout & Structure (CSS Grid)
- **Dynamic Grid Layout:** The `DynamicInspector` will use a CSS Grid that scales responsively (e.g., `grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3`) utilizing standard spacing (`gap-4` or `gap-6`).
- **Dynamic Card Weighting:** Each data module (Widget/Card) will define a `span` requirement based on its content density:
  - `span: 1` -> Maps to `col-span-1`. Ideal for narrow vertical data like basic Details/Firmographics, Contact Lists, or Location Lists.
  - `span: 2` -> Maps to `col-span-2` (or full width on smaller screens). Ideal for complex data requiring horizontal space like Deals, Trade Agreements, or timeline-based Interactions.
- **Scroll vs. Static Content:** Cards will configure their overflow behavior (`overflow: 'scroll' | 'static'`).
  - Scrollable lists (e.g., Contacts, Deals, Interactions) will have a maximum height (e.g., `max-h-[300px] overflow-y-auto`) and utilize sticky headers to ensure the parent container's layout does not blow out vertically.

### 2 — Data Loading & Skeleton States
- The initial render will prioritize immediately available data (e.g., the base `Details` which arrive with the row object).
- High-priority associated lists (Interactions, Deals) will be fetched asynchronously upon row focus, displaying Skeleton loaders within their respective grid cards until data arrives.

### 3 — Priority Rankings by Entity Table

The following outlines the priority ranking (load order/visual hierarchy), spanning weight, and scroll behavior for the key entities rendered in the Split Pane view.

#### Brands (Organizations)
1. **Interactions** (Span: 2, Scroll) - Most critical for context on recent touchpoints.
2. **Trade Agreements** (Span: 2, Static/Scroll) - High importance for business context and active terms.
3. **Deals** (Span: 2, Scroll) - Active pipeline and won deals.
4. **Contacts** (Span: 1, Scroll) - Key stakeholders.
5. **Locations** (Span: 1, Static) - Primary and secondary locations.
6. **Files** (Span: 1, Scroll) - Shared assets and documents.
7. **Details / Firmographics** (Span: 1, Static) - Basic info, description, website.

#### Dealers (Organizations)
1. **Interactions** (Span: 2, Scroll) - Recent store visits, calls.
2. **Deals / Orders** (Span: 2, Scroll) - Pending and historical sales.
3. **Contacts** (Span: 1, Scroll) - Store managers, mechanics, buyers.
4. **Locations** (Span: 1, Static) - Primary address, branches.
5. **Files** (Span: 1, Scroll) - Photos of storefronts, agreements.
6. **Details** (Span: 1, Static) - Basic info.

#### Contacts
1. **Interactions** (Span: 2, Scroll) - Communication history with this individual.
2. **Deals** (Span: 2, Scroll) - Associated opportunities they are involved in.
3. **Affiliated Organizations** (Span: 1, Static) - Brand or Dealer relationships.
4. **Files** (Span: 1, Scroll) - Any related documents.
5. **Details** (Span: 1, Static) - Phone, email, title, social links.

#### Deals
1. **Interactions / Timeline** (Span: 2, Scroll) - Recent progress, internal notes.
2. **Line Items / Products** (Span: 2, Static) - What is actually being sold (requires horizontal width for financial amounts).
3. **Contacts** (Span: 1, Scroll) - Decision makers and influencers.
4. **Trade Agreements** (Span: 1, Static) - Associated contracts.
5. **Details** (Span: 1, Static) - Value, stage, close date.

#### Trade Agreements
1. **Details & Terms** (Span: 2, Static) - Core parameters, status, effective dates.
2. **Organizations** (Span: 1, Static) - Parties involved.
3. **Files** (Span: 1, Scroll) - Contract documents.
4. **Interactions** (Span: 2, Scroll) - Negotiation notes.

#### Expenses & Mileage
1. **Details** (Span: 1, Static) - Amount, date, category, status.
2. **Receipt / Documentation** (Span: 1 or 2, Static) - Visual preview of receipt.
3. **Associated Deal / Organization** (Span: 1, Static) - Related context.
4. **Approval / Audit History** (Span: 2, Scroll) - Status transitions.

## Consequences
- The Split Pane view will maximize available real estate efficiently based on viewport size.
- Important associated data is immediately visible alongside the list view without requiring a full page navigation.
- Establishing standard weights and scrolling rules prevents long lists from breaking the Inspector layout.

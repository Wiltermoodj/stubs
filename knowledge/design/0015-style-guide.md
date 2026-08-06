---
title: '0015 - Style Guide'
type: 'adr'
description: 'Accepted'
status: 'active'
last_updated: '2026-07-18T17:50:00Z'
---

# 0015 - Style Guide

## Status

Accepted

## Context

codebase defines schemas, interfaces, types, and database models using inconsistent casing styles, including `snake_case`, `Title Case`, `PascalCase`, and `kebab-case`. inconsistency causes confusion, type-safety gaps, and integration friction across core CRM, Field Ops, functions, and frontend components. need single, unified casing standard for property names across codebase while ensuring user-facing labels in user interface (UI) correctly rendered in `Title Case`.

## Decision

mandate following casing requirements:

1. **Internal Code & Property Casing:** property names in TypeScript interfaces, type aliases, Zod schemas, database schema models, and variables must formatted in lowercase `camelCase` (e.g. `createdAt`, `userId`, `someProperty`).
2. **Casing Variants to Convert:** Properties using casing styles (as `snake_case`, `Title Case`, `PascalCase`, and `kebab-case`) considered violations.
3. **Automated Enforcement:**`schema-case-standardizer` tool will used to scan, identify, and automate migration of non-camelCase properties to lowercase `camelCase`.
4. **User Interface (UI) Display:** user interface must display labels, titles, and headers in `Title Case` (e.g., `Created At`, `User ID`). camelCase properties must converted to `Title Case` at rendering time or mapped to `Title Case` display labels. Changing property names in codebase to camelCase must not affect user-visible Title Case UI rendering.

## Consequences

- Ensures absolute casing consistency across domains (Core CRM, Admin, Field Ops, shared, etc.).
- Prevents casing-related integration friction between database layers, backend functions, and frontend UI.
- Simplifies type mapping, eliminating custom transformation logic for different casing styles.
- Maintains clean separation between internal database/schema property representation (`camelCase`) and human-readable presentation layer rendering (`Title Case`).

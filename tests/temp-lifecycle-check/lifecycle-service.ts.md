---
title: Lifecycle Greeting Service
type: sidecar-spec
description: test
tags: []
status: materialized
status_flag: clean
version: 1
target_code_file: ./lifecycle-service.ts
sync_state:
  last_sync_timestamp: 2025-01-01T00:00:00.000Z
  sidecar_hash: abc
  code_hash: def
---

# Lifecycle Greeting Service Specification

## Overview

An E2E service demonstrating the 4-stage lifecycle.

## Grilling & Discussion (Light Probe)

**Q1:** What template style should we use?

**A:** Sure, let us use standard templates.

**Q2:** Are parameters validated?

**A:** All parameters validated.

## Implementation

```typescript
export function greet(name: string): string {
  return 'Hello, ' + name + '!';
}
```

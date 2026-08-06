---
title: JWT Authentication Spec
type: sidecar-spec
description: >-
  Handles secure JSON Web Token generation, decoding, and cryptographic
  signature validation.
tags:
  - auth
  - jwt
  - security
module_depth: deep
context_object: AuthContext
status: spec
version: 1
target_code_file: ./jwt.ts
status_flag: clean
user_notes:
  - id: NOTE-101
    timestamp: '2026-08-05T12:00:00Z'
    text: Verify that expiration limits are correctly enforced in verifyToken.
    status: pending
  - id: NOTE-1786036877902
    timestamp: '2026-08-06T17:21:17.902Z'
    text: Must support custom HMAC SHA-512 signing algorithm.
    status: pending
---

# JWT Authentication Specification

## 1. Module Overview

Provides lightweight, secure JWT verification and generation interfaces.

## 2. Interfaces

```typescript
export interface AuthContext {
  userId: string;
  roles: string[];
}
```

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
status_flag: typecheck-failed
user_notes:
  - id: NOTE-101
    timestamp: '2026-08-05T12:00:00Z'
    text: Verify that expiration limits are correctly enforced in verifyToken.
    status: pending
  - id: NOTE-1786036877902
    timestamp: '2026-08-06T17:21:17.902Z'
    text: Must support custom HMAC SHA-512 signing algorithm.
    status: pending
  - id: NOTE-GRILL-1787306626714-0
    timestamp: '2026-08-21T10:03:46.707Z'
    text: >-
      Q: Regarding the module's public interface: what are the primary input
      parameters and expected happy-path output types/values? | A: [Automated
      reply to: Regarding the module's public ...]
    status: resolved
  - id: NOTE-GRILL-1787306626714-1
    timestamp: '2026-08-21T10:03:46.707Z'
    text: >-
      Q: What are the input validation rules and constraint boundaries (e.g.,
      format, value ranges, size limits) for this interface? | A: [Automated
      reply to: What are the input validation ...]
    status: resolved
  - id: NOTE-GRILL-1787306626714-2
    timestamp: '2026-08-21T10:03:46.707Z'
    text: >-
      Q: How does the context object `AuthContext` capture environment and
      security variables to prevent parameter cluttering? | A: [Automated reply
      to: How does the context object `A...]
    status: resolved
  - id: NOTE-GRILL-1787306626714-3
    timestamp: '2026-08-21T10:03:46.707Z'
    text: >-
      Q: How does this module "define errors out of existence" internally (e.g.,
      favoring idempotent behaviors, explicit Result types, or null-objects over
      throwing exceptions)? | A: [Automated reply to: How does this module
      "define e...]
    status: resolved
  - id: NOTE-GRILL-1787316251117-0
    timestamp: '2026-08-21T12:44:11.112Z'
    text: >-
      Q: Regarding the module's public interface: what are the primary input
      parameters and expected happy-path output types/values? | A: [Automated
      reply to: Regarding the module's public ...]
    status: resolved
  - id: NOTE-GRILL-1787316251117-1
    timestamp: '2026-08-21T12:44:11.112Z'
    text: >-
      Q: What are the input validation rules and constraint boundaries (e.g.,
      format, value ranges, size limits) for this interface? | A: [Automated
      reply to: What are the input validation ...]
    status: resolved
  - id: NOTE-GRILL-1787316251117-2
    timestamp: '2026-08-21T12:44:11.112Z'
    text: >-
      Q: How does the context object `AuthContext` capture environment and
      security variables to prevent parameter cluttering? | A: [Automated reply
      to: How does the context object `A...]
    status: resolved
  - id: NOTE-GRILL-1787316251117-3
    timestamp: '2026-08-21T12:44:11.112Z'
    text: >-
      Q: How does this module "define errors out of existence" internally (e.g.,
      favoring idempotent behaviors, explicit Result types, or null-objects over
      throwing exceptions)? | A: [Automated reply to: How does this module
      "define e...]
    status: resolved
stale_details: >-
  Type-checking failed:

  /Users/lappier/code/projects/stubs/src/jwt.ts (16,28): Property 'createHmac'
  does not exist on type 'Crypto'.

  /Users/lappier/code/projects/stubs/src/jwt.ts (26,30): Property 'createHmac'
  does not exist on type 'Crypto'.
sync_state:
  last_sync_timestamp: '2026-08-21T10:03:07.890Z'
  sidecar_hash: 23d2779f922c5ac573564d4b84c6b05cc07aa4c2a7fd942d97d604e207a0a58b
  code_hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
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

## Current implementation

This is a placeholder for the current implementation narrative. It should not be confused
with the actual implementation section below.

## Implementation

```typescript
export interface AuthContext {
  userId: string;
  roles: string[];
}

export interface JwtPayload {
  sub: string;
  exp: number;
  roles: string[];
}

export function signToken(payload: JwtPayload, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64');
  const data = `${header}.${body}`;
  const signature = crypto.createHmac('sha256', secret).update(data).digest('base64');
  return `${data}.${signature}`;
}

export function verifyToken(token: string, secret: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, bodyB64, sigB64] = parts;
  const data = `${headerB64}.${bodyB64}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('base64');

  if (sigB64 !== expectedSig) return null;

  try {
    const payload = JSON.parse(Buffer.from(bodyB64, 'base64').toString()) as JwtPayload;
    if (payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}
```

## Grilling & Discussion (Standard Drill)

**Date:** 8/21/2026  
**Depth:** standard_drill

- **Q:** _Regarding the module's public interface: what are the primary input parameters and expected happy-path output types/values?_
  **A:** [Automated reply to: Regarding the module's public ...]

- **Q:** _What are the input validation rules and constraint boundaries (e.g., format, value ranges, size limits) for this interface?_
  **A:** [Automated reply to: What are the input validation ...]

- **Q:** _How does the context object `AuthContext` capture environment and security variables to prevent parameter cluttering?_
  **A:** [Automated reply to: How does the context object `A...]

- **Q:** _How does this module "define errors out of existence" internally (e.g., favoring idempotent behaviors, explicit Result types, or null-objects over throwing exceptions)?_
  **A:** [Automated reply to: How does this module "define e...]

## Grilling & Discussion (Standard Drill)

**Date:** 8/21/2026  
**Depth:** standard_drill

- **Q:** _Regarding the module's public interface: what are the primary input parameters and expected happy-path output types/values?_
  **A:** [Automated reply to: Regarding the module's public ...]

- **Q:** _What are the input validation rules and constraint boundaries (e.g., format, value ranges, size limits) for this interface?_
  **A:** [Automated reply to: What are the input validation ...]

- **Q:** _How does the context object `AuthContext` capture environment and security variables to prevent parameter cluttering?_
  **A:** [Automated reply to: How does the context object `A...]

- **Q:** _How does this module "define errors out of existence" internally (e.g., favoring idempotent behaviors, explicit Result types, or null-objects over throwing exceptions)?_
  **A:** [Automated reply to: How does this module "define e...]

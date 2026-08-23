import { parseOkfSpec } from '../src/parser/okf';

describe('OKF Frontmatter Parser & Validator', () => {
  const validSpecContent = `---
title: "JWT Authentication Handler Spec"
type: "sidecar-spec"
description: "Architecture and verification interfaces for JWTs."
tags: ["auth", "security", "jwt"]
module_depth: "deep"
status: "spec"
version: 3
target_code_file: "./jwt.ts"
status_flag: "clean"
---
# Implementation
Some markdown content here.
`;

  it('should parse a valid OKF specification with frontmatter and body', () => {
    const result = parseOkfSpec(validSpecContent);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter?.title).toBe('JWT Authentication Handler Spec');
    expect(result.frontmatter?.type).toBe('sidecar-spec');
    expect(result.frontmatter?.version).toBe(3);
    expect(result.body.trim()).toBe('# Implementation\nSome markdown content here.');
  });

  it('should fail validation when required fields are missing', () => {
    const invalidContent = `---
title: "JWT Authentication"
type: "sidecar-spec"
# status is missing
version: 3
target_code_file: "./jwt.ts"
status_flag: "clean"
---
`;
    const result = parseOkfSpec(invalidContent);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Missing required field: "status"');
  });

  it('should fail validation when fields have incorrect types', () => {
    const invalidContent = `---
title: 123
type: "invalid-type"
description: "Auth spec"
tags: "not-an-array"
status: "spec"
version: "not-a-number"
target_code_file: "./jwt.ts"
status_flag: "clean"
---
`;
    const result = parseOkfSpec(invalidContent);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors).toContain('Field "title" must be a string.');
    expect(result.errors.some((e) => e.startsWith('Field "type" must be one of:'))).toBe(true);
    expect(result.errors).toContain('Field "tags" must be an array of strings.');
    expect(result.errors).toContain('Field "version" must be a number.');
  });

  it('should successfully parse concept documentation without target_code_file', () => {
    const conceptDoc = `---
title: "System Architecture & Domain Model"
type: "concept-doc"
description: "Core architectural principles and domain models for the repository."
tags:
  - architecture
  - domain
status: "spec"
version: 1
status_flag: "clean"
---
# Architecture Overview
This is a pure concept document and will not be turned into code.
`;
    const result = parseOkfSpec(conceptDoc);
    expect(result.isValid).toBe(true);
    expect(result.frontmatter?.type).toBe('concept-doc');
    expect(result.frontmatter?.target_code_file).toBeUndefined();
  });

  it('should fail when frontmatter does not start with three dashes', () => {
    const noFrontmatter = `title: "No dashes"
type: "sidecar-spec"
`;
    const result = parseOkfSpec(noFrontmatter);
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain('Invalid OKF format');
  });

  it('should handle complex optional metadata fields', () => {
    const complexSpec = `---
title: "JWT Authentication Handler Spec"
type: "sidecar-spec"
description: "Architecture and verification interfaces for JWTs."
tags: ["auth"]
status: "spec"
version: 3
target_code_file: "./jwt.ts"
status_flag: "clean"
sync_state:
  last_sync_timestamp: "2026-08-05T18:00:00Z"
  sidecar_hash: "hash123"
  code_hash: "hash456"
decisions:
  - id: "DEC-001"
    summary: "Adopt ES256 key signing"
    date: "2026-08-05"
user_notes:
  - id: "NOTE-1"
    timestamp: "2026-08-05T18:00:00Z"
    text: "Verify handles TokenExpiredError"
    status: "pending"
---
Body content
`;
    const result = parseOkfSpec(complexSpec);
    expect(result.isValid).toBe(true);
    expect(result.frontmatter?.sync_state?.sidecar_hash).toBe('hash123');
    expect(result.frontmatter?.decisions?.[0].id).toBe('DEC-001');
    expect(result.frontmatter?.user_notes?.[0].text).toBe('Verify handles TokenExpiredError');
  });
});

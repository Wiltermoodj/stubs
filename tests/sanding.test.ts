import * as fs from 'fs';
import * as path from 'path';
import { extractImplementationCode, replaceImplementationCode } from '../src/parser/markdown';
import { getAstStructuralHash, typeCheckCode } from '../src/sanding/ast';
import { SandingEngine, healCorruptedFrontmatter } from '../src/sanding/engine';

describe('Bi-Directional Code Sanding & Sync Engine (Phase 4)', () => {
  const tempDir = path.resolve('tests/temp-sanding-test');

  beforeAll(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Markdown Code Block Parser', () => {
    it('should extract typescript block under ## Implementation section', () => {
      const body = `
# Spec Header

## 2. Interfaces & Types
\`\`\`typescript
export interface Arg { val: string; }
\`\`\`

## 5. Implementation
\`\`\`typescript
export function foo(a: Arg) {
  return a.val;
}
\`\`\`
`;
      const code = extractImplementationCode(body);
      expect(code).toContain('export function foo');
      expect(code).not.toContain('export interface Arg');
    });

    it('should fallback to first typescript block if no Implementation section is found', () => {
      const body = `
# Generic Markdown

\`\`\`typescript
export const key = "fallback";
\`\`\`
`;
      const code = extractImplementationCode(body);
      expect(code).toBe('export const key = "fallback";');
    });

    it('should replace typescript code block under ## Implementation', () => {
      const body = `
## Implementation
\`\`\`typescript
export function oldCode() {}
\`\`\`
`;
      const updated = replaceImplementationCode(body, 'export function newCode() {}');
      expect(updated).toContain('export function newCode() {}');
      expect(updated).not.toContain('oldCode');
    });
  });

  describe('AST Structural Hashing', () => {
    it('should produce identical structural hashes for identical syntax with different whitespace/comments', () => {
      const codeA = `
        export function calculate(val: number): number {
          // Double the value
          return val * 2;
        }
      `;
      const codeB = `export   function   calculate(val:number):number{return val*2;}`;

      const hashA = getAstStructuralHash(codeA);
      const hashB = getAstStructuralHash(codeB);
      expect(hashA).toBe(hashB);
    });

    it('should produce different hashes for structurally different code', () => {
      const codeA = `
        export function calculate(val: number): number {
          return val * 2;
        }
      `;
      const codeB = `
        export function calculate(val: number): number {
          return val * 3;
        }
      `;

      const hashA = getAstStructuralHash(codeA);
      const hashB = getAstStructuralHash(codeB);
      expect(hashA).not.toBe(hashB);
    });
  });

  describe('Self-Healing Frontmatter Engine', () => {
    it('should heal and parse corrupted YAML containing unescaped quotes and missing syntax', () => {
      const corruptedYaml = `
title: JWT "Spec" Draft Handler
type: sidecar-spec
description: Missing trailing quotes description block
tags:
  - auth
  - jwt
status: spec
version: 3.5
target_code_file: ./jwt.ts
status_flag: clean
sync_state:
  last_sync_timestamp: "2026-08-05T18:00:00Z"
  sidecar_hash: hash-sidecar
  code_hash: hash-code
`;
      const healed = healCorruptedFrontmatter(corruptedYaml);
      expect(healed.title).toBe('JWT "Spec" Draft Handler');
      expect(healed.version).toBe(3.5);
      expect(healed.tags).toEqual(['auth', 'jwt']);
      expect(healed.sync_state?.sidecar_hash).toBe('hash-sidecar');
      expect(healed.sync_state?.code_hash).toBe('hash-code');
    });
  });

  describe('In-Memory Type-Checking', () => {
    it('should succeed for valid TS syntax', () => {
      const code = 'export function add(a: number, b: number): number { return a + b; }';
      const result = typeCheckCode('temp.ts', code);
      expect(result.success).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('should fail and return diagnostics for invalid TS code', () => {
      const code = 'export function add(a: number, b: number): number { return "not-a-number"; }';
      const result = typeCheckCode('temp.ts', code);
      expect(result.success).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });

  describe('Bi-Directional Reconciler (SandingEngine)', () => {
    const sidecarFile = path.join(tempDir, 'auth-spec.ts.md');
    const codeFile = path.join(tempDir, 'auth-spec.ts');

    beforeEach(() => {
      if (fs.existsSync(sidecarFile)) fs.unlinkSync(sidecarFile);
      if (fs.existsSync(codeFile)) fs.unlinkSync(codeFile);
    });

    it('should materialize code file if missing', async () => {
      const sidecarContent = `---
title: Auth Spec
type: sidecar-spec
description: JWT Spec
tags: []
status: spec
version: 1
target_code_file: ./auth-spec.ts
status_flag: clean
---
## Implementation
\`\`\`typescript
export function greet(): string {
  return "hello";
}
\`\`\`
`;
      fs.writeFileSync(sidecarFile, sidecarContent, 'utf8');

      const engine = new SandingEngine();
      const result = await engine.syncFile(sidecarFile);

      expect(result.status).toBe('synced');
      expect(result.direction).toBe('materialized');
      expect(fs.existsSync(codeFile)).toBe(true);

      const materialized = fs.readFileSync(codeFile, 'utf8');
      expect(materialized).toContain('export function greet');
      expect(materialized).toContain('// @sidecar');
    });

    it('should report no_change if both files match recorded sync hashes', async () => {
      // 1. Initial Materialize to get valid hashes
      const sidecarContent = `---
title: Auth Spec
type: sidecar-spec
description: JWT Spec
tags: []
status: spec
version: 1
target_code_file: ./auth-spec.ts
status_flag: clean
---
## Implementation
\`\`\`typescript
export function greet(): string {
  return "hello";
}
\`\`\`
`;
      fs.writeFileSync(sidecarFile, sidecarContent, 'utf8');

      const engine = new SandingEngine();
      await engine.syncFile(sidecarFile);

      // 2. Sync again immediately
      const result = await engine.syncFile(sidecarFile);
      expect(result.status).toBe('no_change');
    });

    it('should sync sidecar-to-code if sidecar was updated', async () => {
      // 1. Initial sync
      const sidecarContent = `---
title: Auth Spec
type: sidecar-spec
description: JWT Spec
tags: []
status: spec
version: 1
target_code_file: ./auth-spec.ts
status_flag: clean
---
## Implementation
\`\`\`typescript
export function greet(): string {
  return "v1";
}
\`\`\`
`;
      fs.writeFileSync(sidecarFile, sidecarContent, 'utf8');

      const engine = new SandingEngine();
      await engine.syncFile(sidecarFile);

      // 2. Modify sidecar file
      const updatedSidecar = fs.readFileSync(sidecarFile, 'utf8');
      const modifiedSidecar = updatedSidecar.replace('v1', 'v2');
      fs.writeFileSync(sidecarFile, modifiedSidecar, 'utf8');

      // 3. Sync again (should materialize)
      const result = await engine.syncFile(sidecarFile);
      expect(result.status).toBe('synced');
      expect(result.direction).toBe('materialized');

      const code = fs.readFileSync(codeFile, 'utf8');
      expect(code).toContain('v2');
    });

    it('should sync code-to-sidecar if code was updated', async () => {
      // 1. Initial sync
      const sidecarContent = `---
title: Auth Spec
type: sidecar-spec
description: JWT Spec
tags: []
status: spec
version: 1
target_code_file: ./auth-spec.ts
status_flag: clean
---
## Implementation
\`\`\`typescript
export function greet(): string {
  return "original";
}
\`\`\`
`;
      fs.writeFileSync(sidecarFile, sidecarContent, 'utf8');

      const engine = new SandingEngine();
      await engine.syncFile(sidecarFile);

      // 2. Modify code file
      const codeContent = fs.readFileSync(codeFile, 'utf8');
      const modifiedCode = codeContent.replace('original', 'developer-edit');
      // Set timestamp forward to make sure code_mtime > last_sync_timestamp
      fs.writeFileSync(codeFile, modifiedCode, 'utf8');

      // 3. Sync again (should sand back to sidecar)
      const result = await engine.syncFile(sidecarFile);
      expect(result.status).toBe('synced');
      expect(result.direction).toBe('sanded');

      const sidecar = fs.readFileSync(sidecarFile, 'utf8');
      expect(sidecar).toContain('developer-edit');
    });

    it('should resolve non-structural conflict automatically based on modification time', async () => {
      // 1. Initial sync
      const sidecarContent = `---
title: Auth Spec
type: sidecar-spec
description: JWT Spec
tags: []
status: spec
version: 1
target_code_file: ./auth-spec.ts
status_flag: clean
---
## Implementation
\`\`\`typescript
export function greet(): string {
  return "base";
}
\`\`\`
`;
      fs.writeFileSync(sidecarFile, sidecarContent, 'utf8');

      const engine = new SandingEngine();
      await engine.syncFile(sidecarFile);

      // Make sure we sleep/wait or artificially alter mtimes to ensure separation
      const now = Date.now();

      // 2. Introduce formatting change in both files (non-structural)
      const updatedSidecar = fs.readFileSync(sidecarFile, 'utf8');
      const formattedSidecar = updatedSidecar.replace(
        'return "base";',
        'return "base"; // sidecar comment',
      );
      fs.writeFileSync(sidecarFile, formattedSidecar, 'utf8');
      fs.utimesSync(sidecarFile, new Date(now + 10000), new Date(now + 10000)); // Newer

      const updatedCode = fs.readFileSync(codeFile, 'utf8');
      const formattedCode = updatedCode.replace('return "base";', 'return "base"; // code comment');
      fs.writeFileSync(codeFile, formattedCode, 'utf8');
      fs.utimesSync(codeFile, new Date(now + 5000), new Date(now + 5000)); // Older

      // 3. Sync should detect conflict but auto-resolve based on sidecar being newer
      const result = await engine.syncFile(sidecarFile);
      expect(result.status).toBe('synced');
      expect(result.direction).toBe('materialized');

      const code = fs.readFileSync(codeFile, 'utf8');
      expect(code).toContain('// sidecar comment');
    });

    it('should flag true structural conflict as needs-human-review-resolution', async () => {
      // 1. Initial sync
      const sidecarContent = `---
title: Auth Spec
type: sidecar-spec
description: JWT Spec
tags: []
status: spec
version: 1
target_code_file: ./auth-spec.ts
status_flag: clean
---
## Implementation
\`\`\`typescript
export function greet(): string {
  return "v1";
}
\`\`\`
`;
      fs.writeFileSync(sidecarFile, sidecarContent, 'utf8');

      const engine = new SandingEngine();
      await engine.syncFile(sidecarFile);

      const now = Date.now();

      // 2. Structural edit in sidecar
      const updatedSidecar = fs.readFileSync(sidecarFile, 'utf8');
      const structuralSidecar = updatedSidecar.replace('"v1"', 'true ? "sidecar-edit" : "v1"');
      fs.writeFileSync(sidecarFile, structuralSidecar, 'utf8');
      fs.utimesSync(sidecarFile, new Date(now + 5000), new Date(now + 5000));

      // 3. Structural edit in code file
      const updatedCode = fs.readFileSync(codeFile, 'utf8');
      const structuralCode = updatedCode.replace('"v1"', '"code-edit"');
      fs.writeFileSync(codeFile, structuralCode, 'utf8');
      fs.utimesSync(codeFile, new Date(now + 10000), new Date(now + 10000));

      // 4. Sync should return conflict
      const result = await engine.syncFile(sidecarFile);
      expect(result.status).toBe('conflict');

      // Verify frontmatter flag was updated
      const finalSidecar = fs.readFileSync(sidecarFile, 'utf8');
      expect(finalSidecar).toContain('status_flag: needs-human-review-resolution');
      expect(finalSidecar).toContain('Conflict detected:');
    });
  });
});

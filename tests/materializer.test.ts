import * as fs from 'fs';
import * as path from 'path';
import { parseMarkdown, extractImplementationCode } from '../src/parser/ast';
import { typeCheckVirtualFile } from '../src/compiler/typechecker';
import { MaterializerEngine } from '../src/materializer/engine';
import { GraphEngine } from '../src/graph/engine';

describe('Phase 3: Markdown AST Parsing, In-Memory Type-Checking & Materialization Engine', () => {
  const testDbPath = '.stubs/test-materializer.sqlite';
  const testSidecarPath = 'src/fixtures-test/test-service.ts.md';
  const testTargetPath = 'src/fixtures-test/test-service.ts';

  let graphEngine: GraphEngine;

  beforeAll(() => {
    // Ensure fixture directory exists
    const dir = path.dirname(testSidecarPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  beforeEach(async () => {
    // Ensure fixture directory exists
    const dir = path.dirname(testSidecarPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Initialize clean test graph engine
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    graphEngine = new GraphEngine(testDbPath);
    await graphEngine.initialize();
  });

  afterEach(async () => {
    await graphEngine.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    if (fs.existsSync(testSidecarPath)) {
      fs.unlinkSync(testSidecarPath);
    }
    if (fs.existsSync(testTargetPath)) {
      fs.unlinkSync(testTargetPath);
    }
    const dir = path.dirname(testSidecarPath);
    if (fs.existsSync(dir)) {
      try {
        fs.rmdirSync(dir);
      } catch {
        // Safe to ignore if dir is not empty
      }
    }
  });

  describe('Markdown AST Parser', () => {
    it('should parse raw markdown into structured blocks', () => {
      const content = `
# Heading 1
Some normal text.

## 2. Implementation
\`\`\`typescript
const a: number = 10;
\`\`\`
      `;
      const blocks = parseMarkdown(content);
      expect(blocks).toContainEqual({ type: 'heading', level: 1, text: 'Heading 1' });
      expect(blocks).toContainEqual({ type: 'heading', level: 2, text: '2. Implementation' });
      expect(blocks).toContainEqual({
        type: 'code',
        lang: 'typescript',
        content: 'const a: number = 10;',
      });
    });

    it('should extract typescript blocks from within ## Implementation section', () => {
      const content = `
## Overview
Some other details.

## Implementation
\`\`\`typescript
export function foo() { return "bar"; }
\`\`\`

## Another Section
\`\`\`typescript
this should not be extracted
\`\`\`
      `;
      const blocks = parseMarkdown(content);
      const extraction = extractImplementationCode(blocks);
      expect(extraction.error).toBeNull();
      expect(extraction.code).toBe('export function foo() { return "bar"; }');
    });

    it('should fail with error if ## Implementation section is missing', () => {
      const content = `
## Overview
\`\`\`typescript
const a = 1;
\`\`\`
      `;
      const blocks = parseMarkdown(content);
      const extraction = extractImplementationCode(blocks);
      expect(extraction.code).toBeNull();
      expect(extraction.error).toContain('No "## Implementation" section found');
    });

    it('should fail with error if ## Implementation is present but lacks typescript code', () => {
      const content = `
## Implementation
No code blocks here.
      `;
      const blocks = parseMarkdown(content);
      const extraction = extractImplementationCode(blocks);
      expect(extraction.code).toBeNull();
      expect(extraction.error).toContain('No typescript code block found within');
    });
  });

  describe('In-Memory TypeScript Typechecker', () => {
    it('should pass on syntactically and semantically correct TS code', () => {
      const code = `
        export interface Config {
          port: number;
        }
        export function startServer(config: Config): string {
          return \`Running on \${config.port}\`;
        }
      `;
      const result = typeCheckVirtualFile('src/temp-file.ts', code);
      expect(result.success).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('should fail with diagnostics on semantic type errors', () => {
      const code = `
        const value: number = "not-a-number";
      `;
      const result = typeCheckVirtualFile('src/temp-file.ts', code);
      expect(result.success).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0]).toContain("Type 'string' is not assignable to type 'number'");
    });

    it('should load local imports in virtual overlay to avoid false type errors', () => {
      // Create a physical file to import
      const importedFilePath = path.resolve('src/fixtures-test/helper-dep.ts');
      fs.mkdirSync(path.dirname(importedFilePath), { recursive: true });
      fs.writeFileSync(importedFilePath, 'export const GREETING = "Hello";', 'utf8');

      const code = `
        import { GREETING } from './helper-dep';
        export function greet(): string {
          return GREETING;
        }
      `;
      try {
        const result = typeCheckVirtualFile('src/fixtures-test/test-main.ts', code);
        expect(result.success).toBe(true);
      } finally {
        if (fs.existsSync(importedFilePath)) {
          fs.unlinkSync(importedFilePath);
        }
      }
    });
  });

  describe('Materializer Engine', () => {
    it('should complete a successful materialization path', async () => {
      const validSidecarContent = `---
title: "Test Service Spec"
type: "sidecar-spec"
description: "Test service description"
tags: ["test", "service"]
status: "implemented"
version: 1
target_code_file: "./test-service.ts"
status_flag: "clean"
---

# Test Service Spec

## Implementation
\`\`\`typescript
export function sum(a: number, b: number): number {
  return a + b;
}
\`\`\`
      `;

      fs.writeFileSync(testSidecarPath, validSidecarContent, 'utf8');

      const materializer = new MaterializerEngine(graphEngine);
      const result = await materializer.materialize(testSidecarPath);

      expect(result.success).toBe(true);

      // Verify the target *.ts file was created
      expect(fs.existsSync(testTargetPath)).toBe(true);
      const targetContent = fs.readFileSync(testTargetPath, 'utf8');
      expect(targetContent).toContain('// @sidecar ./test-service.ts.md');
      expect(targetContent).toContain('export function sum(a: number, b: number): number');

      // Verify sidecar frontmatter was updated
      const updatedSidecarContent = fs.readFileSync(testSidecarPath, 'utf8');
      expect(updatedSidecarContent).toContain('status: materialized');
      expect(updatedSidecarContent).toContain('status_flag: clean');
      expect(updatedSidecarContent).toContain('sync_state:');
      expect(updatedSidecarContent).toContain('sidecar_hash:');
      expect(updatedSidecarContent).toContain('code_hash:');

      // Verify SQLite database sync
      const dbEntry = await graphEngine.getSidecar(testSidecarPath);
      expect(dbEntry).not.toBeNull();
      expect(dbEntry.frontmatter.status).toBe('materialized');
      expect(dbEntry.frontmatter.status_flag).toBe('clean');
      expect(dbEntry.frontmatter.sync_state).toBeDefined();
    });

    it('should update sidecar with status_flag="typecheck-failed" and not create code file on type-checking failure', async () => {
      const invalidSidecarContent = `---
title: "Test Service Spec"
type: "sidecar-spec"
description: "Test service description"
tags: ["test", "service"]
status: "implemented"
version: 1
target_code_file: "./test-service.ts"
status_flag: "clean"
---

# Test Service Spec

## Implementation
\`\`\`typescript
const x: number = "not-a-number";
\`\`\`
      `;

      fs.writeFileSync(testSidecarPath, invalidSidecarContent, 'utf8');

      const materializer = new MaterializerEngine(graphEngine);
      const result = await materializer.materialize(testSidecarPath);

      expect(result.success).toBe(false);
      expect(result.diagnostics).toBeDefined();
      expect(result.diagnostics!.length).toBeGreaterThan(0);

      // Verify target *.ts file was NOT created
      expect(fs.existsSync(testTargetPath)).toBe(false);

      // Verify sidecar frontmatter was updated with typecheck-failed status flag
      const updatedSidecarContent = fs.readFileSync(testSidecarPath, 'utf8');
      expect(updatedSidecarContent).toContain('status_flag: typecheck-failed');
      expect(updatedSidecarContent).toContain('is not assignable');
      expect(updatedSidecarContent).toContain('number');

      // Verify SQLite database sync
      const dbEntry = await graphEngine.getSidecar(testSidecarPath);
      expect(dbEntry).not.toBeNull();
      expect(dbEntry.frontmatter.status_flag).toBe('typecheck-failed');
      expect(dbEntry.frontmatter.stale_details).toContain('is not assignable');
      expect(dbEntry.frontmatter.stale_details).toContain('number');
    });

    it('should handle materialization failure when no implementation block exists', async () => {
      const emptySidecarContent = `---
title: "Test Service Spec"
type: "sidecar-spec"
description: "Test service description"
tags: ["test", "service"]
status: "implemented"
version: 1
target_code_file: "./test-service.ts"
status_flag: "clean"
---

# Test Service Spec

## No Implementation Heading Here
Some metadata.
      `;

      fs.writeFileSync(testSidecarPath, emptySidecarContent, 'utf8');

      const materializer = new MaterializerEngine(graphEngine);
      const result = await materializer.materialize(testSidecarPath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No "## Implementation" section found');

      // Verify target *.ts file was NOT created
      expect(fs.existsSync(testTargetPath)).toBe(false);

      // Verify sidecar frontmatter was updated
      const updatedSidecarContent = fs.readFileSync(testSidecarPath, 'utf8');
      expect(updatedSidecarContent).toContain('status_flag: typecheck-failed');
      expect(updatedSidecarContent).toContain('No "## Implementation" section found');
    });
  });
});

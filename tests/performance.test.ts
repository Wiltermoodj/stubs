import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';
import { GraphEngine } from '../src/graph/engine';
import { getAstStructuralHash } from '../src/sanding/ast';
import { SandingEngine } from '../src/sanding/engine';

describe('Stubs Framework Performance & Latency Benchmarks', () => {
  const dbPath = path.resolve('.stubs/test-performance.sqlite');
  const tempDir = path.resolve('tests/temp-perf-test');
  const sidecarFile = path.join(tempDir, 'perf-service.ts.md');
  const codeFile = path.join(tempDir, 'perf-service.ts');

  let graphEngine: GraphEngine;

  beforeAll(async () => {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    graphEngine = new GraphEngine(dbPath);
    await graphEngine.initialize();

    // Seed the database with 50 sidecars to simulate a realistic workspace size
    for (let i = 1; i <= 50; i++) {
      await graphEngine.upsertSidecar({
        filePath: `src/perf/module_${i}.ts.md`,
        frontmatter: {
          title: `Performance Seed Module ${i}`,
          type: 'sidecar-spec',
          description: `This is the mock description for subsystem performance module number ${i}. It is used to benchmark FTS5 queries.`,
          tags: ['performance', `module-${i}`, i % 2 === 0 ? 'even' : 'odd'],
          status: 'spec',
          version: 1,
          target_code_file: `./module_${i}.ts`,
          status_flag: 'clean',
        },
        body: `
# Performance Seed Module ${i}

## 1. Module Overview
Benchmark module for SQLite FTS5 search queries.

## 2. Interfaces
\`\`\`typescript
export interface Data_${i} {
  id: string;
  value: number;
}
\`\`\`
`,
      });
    }

    // Write a baseline sidecar and code file for sync performance
    const sidecarContent = `---
title: "Perf Sync Spec"
type: "sidecar-spec"
description: "Sync performance sidecar"
tags: ["perf"]
status: "materialized"
version: 1
target_code_file: "./perf-service.ts"
status_flag: "clean"
sync_state:
  last_sync_timestamp: "${new Date().toISOString()}"
  sidecar_hash: "initial-sidecar-hash"
  code_hash: "initial-code-hash"
---
## Implementation
\`\`\`typescript
export function benchmarkRun(): void {}
\`\`\`
`;
    const codeContent = `// @sidecar ./perf-service.ts.md
export function benchmarkRun(): void {}
`;

    fs.writeFileSync(sidecarFile, sidecarContent, 'utf8');
    fs.writeFileSync(codeFile, codeContent, 'utf8');
  });

  afterAll(async () => {
    await graphEngine.close();
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should execute SQLite FTS5 queries under 50ms SLA', async () => {
    const start = performance.now();

    // Search for a specific keyword in FTS5
    const results = await graphEngine.search('performance seed module 25');

    const duration = performance.now() - start;

    console.log(`[PERF] SQLite FTS5 Search latency: ${duration.toFixed(2)}ms`);
    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    // Assert against the strict SLA of < 50ms
    expect(duration).toBeLessThan(50);
  });

  it('should parse and structural-hash AST at high throughput', () => {
    const codeSample = `
      export interface User {
        id: string;
        username: string;
        roles: string[];
      }

      export class UserService {
        private users: User[] = [];

        public getUser(id: string): User | null {
          const user = this.users.find(u => u.id === id);
          if (!user) {
            return null;
          }
          return user;
        }

        public createUser(user: User): User {
          this.users.push(user);
          return user;
        }
      }
    `;

    const iterations = 100;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      const hash = getAstStructuralHash(codeSample);
      expect(hash).toBeDefined();
    }

    const duration = performance.now() - start;
    const avgDuration = duration / iterations;

    console.log(
      `[PERF] AST Structural Hashing: ${duration.toFixed(2)}ms total for ${iterations} runs (Avg: ${avgDuration.toFixed(2)}ms per file)`,
    );
    // Assert that average hashing duration is well under 5ms per file
    expect(avgDuration).toBeLessThan(5);
  });

  it('should synchronize files with no change within 20ms', async () => {
    const sandingEngine = new SandingEngine();

    // Run first sync to establish hashes
    await sandingEngine.syncFile(sidecarFile);

    const start = performance.now();

    // Measure a "no change" sync operation
    const result = await sandingEngine.syncFile(sidecarFile);

    const duration = performance.now() - start;

    console.log(`[PERF] "No Change" Sync operation latency: ${duration.toFixed(2)}ms`);
    expect(result.status).toBe('no_change');
    // Assert against the performance SLA of < 20ms
    expect(duration).toBeLessThan(20);
  });
});

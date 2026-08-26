import { promises as fs } from 'fs';
import * as path from 'path';
import { TreeEngine } from '../src/concept/tree';
import { GraphEngine } from '../src/graph/engine';

describe('Tree Engine Visual Tree Generator Tests', () => {
  const testDir = path.join(__dirname, 'temp_tree_test');
  let graphEngine: GraphEngine;

  beforeAll(async () => {
    await fs.mkdir(path.join(testDir, 'src', 'auth'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'src', 'auth', 'jwt.ts'),
      'export function sign() {}',
      'utf8',
    );
    await fs.writeFile(
      path.join(testDir, 'src', 'auth', 'jwt.ts.md'),
      `---
title: "JWT Spec"
type: "sidecar-spec"
description: "JWT Authentication Handler"
tags: ["auth"]
status: "spec"
version: 1
phase: "spec"
target_code_file: "./jwt.ts"
status_flag: "clean"
---
# JWT Spec
`,
      'utf8',
    );

    const dbPath = path.join(testDir, 'graph.sqlite');
    graphEngine = new GraphEngine(dbPath);
    await graphEngine.initialize();
    await graphEngine.indexWorkspace(testDir);
  });

  afterAll(async () => {
    try {
      await graphEngine.close();
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('should generate hierarchical visual tree from physical files', async () => {
    const treeEngine = new TreeEngine({ graphEngine });
    const output = await treeEngine.generateVisualTree({
      rootDir: testDir,
      includePlanned: false,
      showStatus: false,
    });

    expect(output).toContain('src/');
    expect(output).toContain('auth/');
    expect(output).toContain('jwt.ts');
    expect(output).toContain('jwt.ts.md');
  });

  it('should annotate tree with phase and status badges when showStatus is true', async () => {
    const treeEngine = new TreeEngine({ graphEngine });
    const output = await treeEngine.generateVisualTree({
      rootDir: testDir,
      includePlanned: false,
      showStatus: true,
    });

    expect(output).toContain('jwt.ts.md');
    expect(output).toContain('[SPEC · clean]');
  });
});

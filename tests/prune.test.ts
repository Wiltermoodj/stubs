import { promises as fs } from 'fs';
import * as path from 'path';
import { PruneEngine } from '../src/prune/engine';
import { GraphEngine } from '../src/graph/engine';

describe('Prune Engine & Phantom Spec Garbage Collector Tests', () => {
  const testDir = path.join(__dirname, 'temp_prune_test');
  const dbPath = path.join(testDir, 'graph.sqlite');

  beforeAll(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('detects phantom sidecars referencing deleted or missing code files', async () => {
    const phantomSidecar = path.join(testDir, 'phantom-service.ts.md');
    await fs.writeFile(
      phantomSidecar,
      `---
title: Phantom Service
type: sidecar-spec
description: Phantom test sidecar
target_code_file: ./phantom-service.ts
---
# Phantom Service
`,
      'utf8',
    );

    const graphEngine = new GraphEngine(dbPath);
    await graphEngine.initialize();

    const pruneEngine = new PruneEngine({ graphEngine });
    const result = await pruneEngine.auditWorkspace({ specsDir: testDir });

    expect(result.summary.phantomSidecars).toBeGreaterThanOrEqual(1);
    expect(result.issues.some((i) => i.type === 'PHANTOM_SIDECAR')).toBe(true);

    const md = pruneEngine.renderMarkdown(result);
    expect(md).toContain('PHANTOM_SIDECAR');
    expect(md).toContain('phantom-service.ts.md');

    await graphEngine.close();
  });

  it('detects untracked code files that lack paired sidecar specifications', async () => {
    const untrackedCode = path.join(testDir, 'untracked-helper.ts');
    await fs.writeFile(untrackedCode, 'export function helper(): boolean { return true; }', 'utf8');

    const graphEngine = new GraphEngine(dbPath);
    await graphEngine.initialize();

    const pruneEngine = new PruneEngine({ graphEngine });
    const result = await pruneEngine.auditWorkspace({ specsDir: testDir });

    expect(result.summary.untrackedCodeFiles).toBeGreaterThanOrEqual(1);
    expect(result.issues.some((i) => i.type === 'UNTRACKED_CODE')).toBe(true);

    await graphEngine.close();
  });

  it('detects stale database records and cleans them up with fixOrphans', async () => {
    const graphEngine = new GraphEngine(dbPath);
    await graphEngine.initialize();

    const deletedFilePath = 'src/deleted/old-module.ts';
    await graphEngine.upsertGraphNodes([
      {
        id: deletedFilePath,
        file_path: deletedFilePath,
        kind: 'file',
        domain: 'deleted',
        lifecycle_phase: 'spec',
      },
    ]);

    const pruneEngine = new PruneEngine({ graphEngine });
    const auditBefore = await pruneEngine.auditWorkspace({ specsDir: testDir });

    expect(auditBefore.summary.staleDbNodes).toBeGreaterThanOrEqual(1);
    expect(auditBefore.issues.some((i) => i.type === 'STALE_DB_NODE')).toBe(true);

    // Run fix
    const fixResult = await pruneEngine.fixOrphans(auditBefore);
    expect(fixResult.staleNodesRemoved).toBeGreaterThanOrEqual(1);

    // Audit again should be clean of stale nodes
    const auditAfter = await pruneEngine.auditWorkspace({ specsDir: testDir });
    expect(auditAfter.summary.staleDbNodes).toBe(0);

    await graphEngine.close();
  });
});

import { promises as fs } from 'fs';
import * as path from 'path';
import { ArchLintEngine, getModuleLayer } from '../src/lint/engine';
import { GraphEngine } from '../src/graph/engine';

describe('Architectural Guardrails & Layer Linter Tests', () => {
  const testDir = path.join(__dirname, 'temp_lint_arch_test');
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

  it('correctly maps module paths to architectural layers', () => {
    expect(getModuleLayer('src/config/schema.ts').layer).toBe(0);
    expect(getModuleLayer('src/storage/index.ts').layer).toBe(1);
    expect(getModuleLayer('src/parser/ast.ts').layer).toBe(2);
    expect(getModuleLayer('src/compiler/typechecker.ts').layer).toBe(3);
    expect(getModuleLayer('src/graph/engine.ts').layer).toBe(4);
    expect(getModuleLayer('src/context/engine.ts').layer).toBe(5);
    expect(getModuleLayer('src/lint/engine.ts').layer).toBe(5);
    expect(getModuleLayer('src/cli/router.ts').layer).toBe(6);
    expect(getModuleLayer('src/cli.ts').layer).toBe(6);
  });

  it('detects layer inversions where a lower-tier module imports a higher-tier module', async () => {
    const graphEngine = new GraphEngine(dbPath);
    await graphEngine.initialize();

    // Create mock node representing Layer 1 (storage) importing Layer 4 (graph)
    const storageCodePath = 'src/storage/driver.ts';
    const graphCodePath = 'src/graph/db.ts';

    await graphEngine.upsertGraphNodes([
      {
        id: storageCodePath,
        file_path: storageCodePath,
        symbol_name: 'StorageDriver',
        kind: 'file',
        domain: 'storage',
        lifecycle_phase: 'spec',
      },
      {
        id: graphCodePath,
        file_path: graphCodePath,
        symbol_name: 'GraphDb',
        kind: 'file',
        domain: 'graph',
        lifecycle_phase: 'spec',
      },
    ]);

    // Add forbidden edge: storage -> graph (Layer 1 -> Layer 4)
    await graphEngine.upsertGraphEdges([
      {
        source_id: storageCodePath,
        target_id: graphCodePath,
        relation: 'imports',
        weight: 1,
      },
    ]);

    const lintEngine = new ArchLintEngine({ graphEngine });
    const result = await lintEngine.lintWorkspace({ rules: ['LAYER_VIOLATION'] });

    expect(result.summary.layerViolations).toBe(1);
    expect(result.summary.passed).toBe(false);
    expect(result.violations[0].rule).toBe('LAYER_VIOLATION');
    expect(result.violations[0].sourceFile).toBe(storageCodePath);
    expect(result.violations[0].targetFile).toBe(graphCodePath);

    const md = lintEngine.renderMarkdown(result);
    expect(md).toContain('Layer inversion');
    expect(md).toContain('FAILED');

    await graphEngine.close();
  });

  it('detects circular dependency cycles', async () => {
    const cycleDbPath = path.join(testDir, 'cycle_graph.sqlite');
    const graphEngine = new GraphEngine(cycleDbPath);
    await graphEngine.initialize();

    const fileA = 'src/grill/engine.ts';
    const fileB = 'src/sanding/engine.ts';

    await graphEngine.upsertGraphNodes([
      {
        id: fileA,
        file_path: fileA,
        symbol_name: 'GrillEngine',
        kind: 'file',
        domain: 'grill',
        lifecycle_phase: 'spec',
      },
      {
        id: fileB,
        file_path: fileB,
        symbol_name: 'SandingEngine',
        kind: 'file',
        domain: 'sanding',
        lifecycle_phase: 'spec',
      },
    ]);

    // Create cycle: A -> B and B -> A
    await graphEngine.upsertGraphEdges([
      {
        source_id: fileA,
        target_id: fileB,
        relation: 'imports',
        weight: 1,
      },
      {
        source_id: fileB,
        target_id: fileA,
        relation: 'imports',
        weight: 1,
      },
    ]);

    const lintEngine = new ArchLintEngine({ graphEngine });
    const result = await lintEngine.lintWorkspace({ rules: ['CIRCULAR_DEPENDENCY'] });

    expect(result.summary.circularCycles).toBeGreaterThanOrEqual(1);
    expect(result.violations.some((v) => v.rule === 'CIRCULAR_DEPENDENCY')).toBe(true);

    await graphEngine.close();
  });
});

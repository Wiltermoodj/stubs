import { promises as fs } from 'fs';
import * as path from 'path';
import { ImpactEngine } from '../src/impact/engine';
import { GraphEngine } from '../src/graph/engine';

describe('Impact Engine & Blast-Radius Tests', () => {
  const testDir = path.join(__dirname, 'temp_impact_test');
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

  it('calculates impact radius and risk level correctly', async () => {
    const graphEngine = new GraphEngine(dbPath);
    await graphEngine.initialize();

    const rootPath = path.join(testDir, 'root.ts');
    const midPath = path.join(testDir, 'mid.ts');
    const leafPath = path.join(testDir, 'leaf.ts');

    await fs.writeFile(rootPath, 'export function rootFn() { return "root"; }', 'utf8');
    await fs.writeFile(
      midPath,
      'import { rootFn } from "./root";\nexport function midFn() { return rootFn(); }',
      'utf8',
    );
    await fs.writeFile(
      leafPath,
      'import { midFn } from "./mid";\nexport function leafFn() { return midFn(); }',
      'utf8',
    );

    await graphEngine.indexCodeFile(rootPath);
    await graphEngine.indexCodeFile(midPath);
    await graphEngine.indexCodeFile(leafPath);

    const impactEngine = new ImpactEngine({ graphEngine });

    // Analyze impact of changing root.ts (should affect mid.ts and leaf.ts downstream)
    const rootImpact = await impactEngine.analyzeImpact(rootPath, {
      depth: 3,
      direction: 'inbound',
    });
    expect(rootImpact.canonicalPath).toBe(rootPath.replace(/\\/g, '/'));
    expect(rootImpact.totalAffected).toBeGreaterThanOrEqual(1);

    const md = impactEngine.renderMarkdown(rootImpact);
    expect(md).toContain('# Impact & Blast-Radius Report:');
    expect(md).toContain('Downstream Affected Callers & Dependents');

    // Analyze impact of leaf.ts (has 0 downstream callers)
    const leafImpact = await impactEngine.analyzeImpact(leafPath, { direction: 'inbound' });
    expect(leafImpact.totalAffected).toBe(0);
    expect(leafImpact.riskLevel).toBe('LOW');

    const leafMd = impactEngine.renderMarkdown(leafImpact);
    expect(leafMd).toContain('Zero downstream dependents affected');

    await graphEngine.close();
  });
});

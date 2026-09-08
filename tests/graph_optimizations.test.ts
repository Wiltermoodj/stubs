import { GraphEngine } from '../src/graph/engine';
import { TopologyEngine, GraphNode, GraphEdge } from '../src/graph/topology';
import { ExportEngine } from '../src/export/engine';
import { VirtualFileSystem, WasmSqliteDriver } from '../src/storage';
import { parseOkfSpec } from '../src/parser/okf';

describe('Graphing & Mapping Optimizations', () => {
  let vfs: VirtualFileSystem;
  let dbDriver: WasmSqliteDriver;
  let graphEngine: GraphEngine;

  beforeEach(async () => {
    vfs = new VirtualFileSystem();
    dbDriver = new WasmSqliteDriver({ fsDriver: vfs, dbPath: ':memory:' });
    graphEngine = new GraphEngine({ fsDriver: vfs, dbDriver, dbPath: ':memory:' });
    await graphEngine.initialize();
  });

  afterEach(async () => {
    await graphEngine.close();
  });

  describe('OKF Wiki Export Compliance', () => {
    it('generates wiki pages with valid OKF YAML frontmatter', async () => {
      // Seed nodes & edges
      const nodes: GraphNode[] = [
        { id: 'src/core/hub.ts', file_path: 'src/core/hub.ts', kind: 'file', domain: 'core' },
        { id: 'src/core/util.ts', file_path: 'src/core/util.ts', kind: 'file', domain: 'core' },
      ];
      const edges: GraphEdge[] = [
        { source_id: 'src/core/hub.ts', target_id: 'src/core/util.ts', relation: 'imports', confidence: 'EXTRACTED' },
      ];

      await graphEngine.upsertGraphNodes(nodes);
      await graphEngine.upsertGraphEdges(edges);

      const exportEngine = new ExportEngine({ graphEngine, fsDriver: vfs });
      const result = await exportEngine.toWiki('./wiki');

      expect(result.format).toBe('wiki');
      expect(result.filesGenerated.length).toBeGreaterThan(0);

      // Check index.md
      const indexContent = await vfs.readFile('wiki/index.md');
      const parsedIndex = parseOkfSpec(indexContent);
      expect(parsedIndex.isValid).toBe(true);
      expect(parsedIndex.frontmatter?.type).toBe('wiki-portal');

      // Check subsystem file
      const subFile = result.filesGenerated.find((f) => f.includes('subsystems/'));
      expect(subFile).toBeDefined();
      if (subFile) {
        const subContent = await vfs.readFile(subFile);
        const parsedSub = parseOkfSpec(subContent);
        expect(parsedSub.isValid).toBe(true);
        expect(parsedSub.frontmatter?.type).toBe('wiki-subsystem');
        expect(parsedSub.frontmatter?.title).toContain('Subsystem:');
      }
    });
  });

  describe('Pre-execution Blast Radius Guard', () => {
    it('evaluates safety thresholds and flags high impact hubs', () => {
      const nodes: GraphNode[] = [
        { id: 'god-node', file_path: 'src/god.ts', kind: 'file', domain: 'core' },
      ];
      const edges: GraphEdge[] = [];

      for (let i = 1; i <= 15; i++) {
        const depId = `dep-${i}`;
        nodes.push({ id: depId, file_path: `src/dep${i}.ts`, kind: 'file', domain: `dom-${i % 4}` });
        edges.push({ source_id: depId, target_id: 'god-node', relation: 'imports' });
      }

      const topology = new TopologyEngine(nodes, edges);

      // Low threshold should fail
      const lowCheck = topology.checkBlastGuard('god-node', 'low');
      expect(lowCheck.safe).toBe(false);
      expect(lowCheck.impactCount).toBe(15);

      // Critical threshold with high impact
      const critCheck = topology.checkBlastGuard('god-node', 'critical');
      expect(critCheck.impactCount).toBe(15);
    });
  });

  describe('Hierarchical Agent Context Compaction', () => {
    it('generates structured L0, L1, L2 tiered context', () => {
      const nodes: GraphNode[] = [
        { id: 'src/api/handler.ts', file_path: 'src/api/handler.ts', kind: 'file', domain: 'api' },
        { id: 'src/core/service.ts', file_path: 'src/core/service.ts', kind: 'file', domain: 'core' },
      ];
      const edges: GraphEdge[] = [
        { source_id: 'src/api/handler.ts', target_id: 'src/core/service.ts', relation: 'imports' },
      ];

      const topology = new TopologyEngine(nodes, edges);
      const ctx = topology.getTieredAgentContext('src/api/handler.ts');

      expect(ctx).not.toBeNull();
      expect(ctx?.l0_target.id).toBe('src/api/handler.ts');
      expect(ctx?.l1_dependencies.length).toBe(1);
      expect(ctx?.l1_dependencies[0].id).toBe('src/core/service.ts');
      expect(ctx?.formattedSummary).toContain('[L0 TARGET]');
      expect(ctx?.formattedSummary).toContain('[L1 DEPENDS ON');
    });
  });

  describe('Incremental Workspace Hash Skip', () => {
    it('skips unchanged files on subsequent scans', async () => {
      await vfs.writeFile('src/test1.ts', 'export const a = 1;');
      await vfs.writeFile('src/test2.ts', 'export const b = 2;');

      const scan1 = await graphEngine.indexCodeWorkspace('src');
      expect(scan1.indexed).toBe(2);
      expect(scan1.skipped).toBe(0);

      // Second scan without modifications should skip both
      const scan2 = await graphEngine.indexCodeWorkspace('src');
      expect(scan2.indexed).toBe(0);
      expect(scan2.skipped).toBe(2);

      // Modifying one file should index 1 and skip 1
      await vfs.writeFile('src/test1.ts', 'export const a = 2;');
      const scan3 = await graphEngine.indexCodeWorkspace('src');
      expect(scan3.indexed).toBe(1);
      expect(scan3.skipped).toBe(1);
    });
  });
});

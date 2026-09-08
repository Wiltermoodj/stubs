import { TopologyEngine, GraphNode, GraphEdge } from '../src/graph/topology';
import { extractFileGraph } from '../src/graph/extractor';

describe('Advanced Graphing & Mapping Capabilities', () => {
  describe('Topological Edit Ordering', () => {
    it('orders base dependencies before consumers in dependencies_first mode', () => {
      // StorageDriver (leaf) <- StorageService <- ApiHandler (root consumer)
      const nodes: GraphNode[] = [
        { id: 'src/api/handler.ts', file_path: 'src/api/handler.ts', kind: 'file' },
        { id: 'src/services/storage.ts', file_path: 'src/services/storage.ts', kind: 'file' },
        { id: 'src/drivers/sqlite.ts', file_path: 'src/drivers/sqlite.ts', kind: 'file' },
      ];

      const edges: GraphEdge[] = [
        { source_id: 'src/api/handler.ts', target_id: 'src/services/storage.ts', relation: 'imports' },
        { source_id: 'src/services/storage.ts', target_id: 'src/drivers/sqlite.ts', relation: 'imports' },
      ];

      const topology = new TopologyEngine(nodes, edges);
      const result = topology.getTopologicalEditOrder(
        ['src/api/handler.ts', 'src/services/storage.ts', 'src/drivers/sqlite.ts'],
        'dependencies_first',
      );

      expect(result.hasCycles).toBe(false);
      expect(result.orderedFiles).toEqual([
        'src/drivers/sqlite.ts',
        'src/services/storage.ts',
        'src/api/handler.ts',
      ]);
    });

    it('orders consumers before dependencies in dependents_first mode', () => {
      const nodes: GraphNode[] = [
        { id: 'src/a.ts', file_path: 'src/a.ts', kind: 'file' },
        { id: 'src/b.ts', file_path: 'src/b.ts', kind: 'file' },
      ];
      const edges: GraphEdge[] = [
        { source_id: 'src/a.ts', target_id: 'src/b.ts', relation: 'imports' },
      ];

      const topology = new TopologyEngine(nodes, edges);
      const result = topology.getTopologicalEditOrder(['src/a.ts', 'src/b.ts'], 'dependents_first');

      expect(result.orderedFiles).toEqual(['src/a.ts', 'src/b.ts']);
    });
  });

  describe('Architecture Boundary Linting', () => {
    it('detects forbidden cross-domain dependencies', () => {
      const nodes: GraphNode[] = [
        { id: 'src/cli/router.ts', file_path: 'src/cli/router.ts', kind: 'file', domain: 'cli' },
        { id: 'src/storage/db.ts', file_path: 'src/storage/db.ts', kind: 'file', domain: 'storage' },
      ];
      const edges: GraphEdge[] = [
        { source_id: 'src/cli/router.ts', target_id: 'src/storage/db.ts', relation: 'imports' },
      ];

      const topology = new TopologyEngine(nodes, edges);
      const report = topology.lintArchitectureRules([
        {
          source_domain: 'cli',
          forbidden_target_domain: 'storage',
          reason: 'CLI must access storage only through core services',
        },
      ]);

      expect(report.passed).toBe(false);
      expect(report.totalViolations).toBe(1);
      expect(report.violations[0].sourceDomain).toBe('cli');
      expect(report.violations[0].targetDomain).toBe('storage');
    });

    it('passes when no forbidden rules are matched', () => {
      const nodes: GraphNode[] = [
        { id: 'src/cli/router.ts', file_path: 'src/cli/router.ts', kind: 'file', domain: 'cli' },
        { id: 'src/core/service.ts', file_path: 'src/core/service.ts', kind: 'file', domain: 'core' },
      ];
      const edges: GraphEdge[] = [
        { source_id: 'src/cli/router.ts', target_id: 'src/core/service.ts', relation: 'imports' },
      ];

      const topology = new TopologyEngine(nodes, edges);
      const report = topology.lintArchitectureRules([
        {
          source_domain: 'cli',
          forbidden_target_domain: 'storage',
        },
      ]);

      expect(report.passed).toBe(true);
      expect(report.totalViolations).toBe(0);
    });
  });

  describe('Fine-Grained Symbol-to-Symbol Call Graph Extraction', () => {
    it('extracts call edges from caller functions and methods to callee symbols', () => {
      const code = `
import { helperFunc } from './helper';

export class Service {
  public execute() {
    helperFunc();
  }
}

export function directCaller() {
  helperFunc();
}
`;
      const { nodes, edges } = extractFileGraph('src/service.ts', code);

      const methodNode = nodes.find((n) => n.kind === 'method' && n.symbol_name === 'execute');
      expect(methodNode).toBeDefined();

      const funcNode = nodes.find((n) => n.kind === 'function' && n.symbol_name === 'directCaller');
      expect(funcNode).toBeDefined();

      const callEdges = edges.filter((e) => e.relation === 'calls');
      expect(callEdges.length).toBe(2);

      // Verify caller sources
      const callerSources = callEdges.map((e) => e.source_id);
      expect(callerSources).toContain('src/service.ts#Service.execute');
      expect(callerSources).toContain('src/service.ts#directCaller');
    });
  });
});

import { TopologyEngine, GraphNode, GraphEdge } from '../src/graph/topology';

describe('Topology Analytics & Graphify Features', () => {
  const nodes: GraphNode[] = [
    // Cluster 1 (Core Parser Domain)
    {
      id: 'src/parser/okf.ts',
      file_path: 'src/parser/okf.ts',
      symbol_name: null,
      kind: 'file',
      domain: 'parser',
    },
    {
      id: 'src/parser/okf.ts#parseOkfSpec',
      file_path: 'src/parser/okf.ts',
      symbol_name: 'parseOkfSpec',
      kind: 'function',
      domain: 'parser',
    },
    {
      id: 'src/parser/ast.ts',
      file_path: 'src/parser/ast.ts',
      symbol_name: null,
      kind: 'file',
      domain: 'parser',
    },

    // Cluster 2 (Graph Storage Domain)
    {
      id: 'src/graph/engine.ts',
      file_path: 'src/graph/engine.ts',
      symbol_name: null,
      kind: 'file',
      domain: 'graph',
    },
    {
      id: 'src/graph/engine.ts#GraphEngine',
      file_path: 'src/graph/engine.ts',
      symbol_name: 'GraphEngine',
      kind: 'class',
      domain: 'graph',
    },
    {
      id: 'src/storage/index.ts',
      file_path: 'src/storage/index.ts',
      symbol_name: null,
      kind: 'file',
      domain: 'storage',
    },

    // Bridge node
    {
      id: 'src/cli/router.ts',
      file_path: 'src/cli/router.ts',
      symbol_name: null,
      kind: 'file',
      domain: 'cli',
    },
  ];

  const edges: GraphEdge[] = [
    // Internal Cluster 1 edges
    {
      source_id: 'src/parser/okf.ts',
      target_id: 'src/parser/okf.ts#parseOkfSpec',
      relation: 'contains',
      confidence: 'EXTRACTED',
    },
    {
      source_id: 'src/parser/okf.ts#parseOkfSpec',
      target_id: 'src/parser/ast.ts',
      relation: 'calls',
      confidence: 'EXTRACTED',
    },

    // Internal Cluster 2 edges
    {
      source_id: 'src/graph/engine.ts',
      target_id: 'src/graph/engine.ts#GraphEngine',
      relation: 'contains',
      confidence: 'EXTRACTED',
    },
    {
      source_id: 'src/graph/engine.ts#GraphEngine',
      target_id: 'src/storage/index.ts',
      relation: 'calls',
      confidence: 'EXTRACTED',
    },

    // Cross-cluster bridge
    {
      source_id: 'src/cli/router.ts',
      target_id: 'src/parser/okf.ts#parseOkfSpec',
      relation: 'calls',
      confidence: 'EXTRACTED',
    },
    {
      source_id: 'src/cli/router.ts',
      target_id: 'src/graph/engine.ts#GraphEngine',
      relation: 'calls',
      confidence: 'EXTRACTED',
    },
    // A cross-domain call from storage to parser (surprising)
    {
      source_id: 'src/storage/index.ts',
      target_id: 'src/parser/ast.ts',
      relation: 'calls',
      confidence: 'INFERRED',
    },
  ];

  it('should explain node correctly with in/out degree, confidence and community', () => {
    const topology = new TopologyEngine(nodes, edges);
    const res = topology.explainNode('parseOkfSpec');

    expect(res).not.toBeNull();
    expect(res?.symbolName).toBe('parseOkfSpec');
    expect(res?.domain).toBe('parser');
    expect(res?.inDegree).toBeGreaterThanOrEqual(2); // from okf.ts and router.ts
    expect(res?.outDegree).toBeGreaterThanOrEqual(1); // to ast.ts
    expect(res?.incoming.some((inc) => inc.confidence === 'EXTRACTED')).toBe(true);

    const formatted = topology.formatNodeExplanation(res!);
    expect(formatted).toContain('Node Profile:');
    expect(formatted).toContain('Community:');
    expect(formatted).toContain('Connections');
  });

  it('should detect distinct communities using Louvain modularity', () => {
    const topology = new TopologyEngine(nodes, edges);
    const res = topology.getCommunities();

    expect(res.totalCommunities).toBeGreaterThanOrEqual(2);
    expect(res.communityInfo.length).toBeGreaterThanOrEqual(2);
    for (const comm of res.communityInfo) {
      expect(comm.nodes.length).toBeGreaterThan(0);
      expect(comm.hubNode).toBeDefined();
      expect(comm.label).toBeDefined();
      expect(comm.cohesion).toBeGreaterThanOrEqual(0);
    }
  });

  it('should detect surprising connections across disparate domains', () => {
    const topology = new TopologyEngine(nodes, edges);
    const surprises = topology.getSurprisingConnections();

    expect(surprises.length).toBeGreaterThan(0);
    expect(surprises[0].surpriseScore).toBeGreaterThan(0);
    expect(
      surprises.some((s) => s.sourceId.includes('storage') && s.targetId.includes('parser')),
    ).toBe(true);
  });

  it('should suggest relevant architecture questions from topology', () => {
    const topology = new TopologyEngine(nodes, edges);
    const questions = topology.suggestArchitectureQuestions();

    expect(questions.length).toBeGreaterThan(0);
    expect(questions[0].question).toBeDefined();
    expect(questions[0].rationale).toBeDefined();
  });
});

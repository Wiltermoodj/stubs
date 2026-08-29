import { GraphNode, GraphEdge } from './extractor';

export interface BlastRadiusNode {
  id: string;
  filePath: string;
  symbolName: string | null;
  kind: string;
  domain: string | null;
  phase: string | null;
  depth: number;
  relation: string;
  children: BlastRadiusNode[];
}

export interface BlastRadiusResult {
  target: string;
  totalAffected: number;
  maxDepthReached: number;
  domainsAffected: string[];
  nodes: BlastRadiusNode[];
}

export interface ShortestPathStep {
  fromId: string;
  toId: string;
  relation: string;
  weight: number;
}

export interface ShortestPathResult {
  sourceId: string;
  targetId: string;
  totalHops: number;
  path: string[];
  steps: ShortestPathStep[];
}

export interface SmellGodNode {
  id: string;
  filePath: string;
  kind: string;
  inDegree: number;
  outDegree: number;
  totalDegree: number;
  reason: string;
}

export interface SmellCycle {
  cycleLength: number;
  nodes: string[];
}

export interface SmellDomainLeak {
  sourceId: string;
  sourceDomain: string;
  targetId: string;
  targetDomain: string;
  relation: string;
  reason: string;
}

export interface ArchitecturalSmellsReport {
  godNodes: SmellGodNode[];
  cycles: SmellCycle[];
  domainLeaks: SmellDomainLeak[];
  totalSmells: number;
}

export interface NodeCentrality {
  id: string;
  inDegree: number;
  outDegree: number;
  totalDegree: number;
  isHub: boolean;
}

export class TopologyEngine {
  private nodes: Map<string, GraphNode> = new Map();
  private outgoingEdges: Map<string, GraphEdge[]> = new Map(); // source_id -> edges
  private incomingEdges: Map<string, GraphEdge[]> = new Map(); // target_id -> edges

  constructor(nodes: GraphNode[] = [], edges: GraphEdge[] = []) {
    this.loadGraph(nodes, edges);
  }

  public loadGraph(nodes: GraphNode[], edges: GraphEdge[]): void {
    this.nodes.clear();
    this.outgoingEdges.clear();
    this.incomingEdges.clear();

    for (const node of nodes) {
      this.nodes.set(node.id, node);
    }

    // Quick lookup for resolving extensionless imports (e.g. "./engine" -> "src/services/engine.ts")
    const fileNodeLookup = new Map<string, string>();
    for (const node of nodes) {
      if (node.kind === 'file' || node.kind === 'sidecar') {
        const withoutExt = node.file_path.replace(/\.[^/.]+$/, '');
        fileNodeLookup.set(withoutExt, node.id);
        fileNodeLookup.set(node.file_path, node.id);
      }
    }

    const resolveTargetId = (rawId: string): string => {
      if (this.nodes.has(rawId)) return rawId;
      if (rawId.includes('#')) {
        const [filePath, sym] = rawId.split('#');
        const resolvedFile = fileNodeLookup.get(filePath) || filePath;
        return `${resolvedFile}#${sym}`;
      }
      return fileNodeLookup.get(rawId) || rawId;
    };

    for (const rawEdge of edges) {
      const sourceId = resolveTargetId(rawEdge.source_id);
      const targetId = resolveTargetId(rawEdge.target_id);
      const edge = { ...rawEdge, source_id: sourceId, target_id: targetId };

      // Ensure target node exists or create a stub node
      if (!this.nodes.has(edge.source_id)) {
        this.nodes.set(edge.source_id, {
          id: edge.source_id,
          file_path: edge.source_id.split('#')[0],
          symbol_name: edge.source_id.includes('#') ? edge.source_id.split('#')[1] : null,
          kind: 'symbol',
        });
      }
      if (!this.nodes.has(edge.target_id)) {
        this.nodes.set(edge.target_id, {
          id: edge.target_id,
          file_path: edge.target_id.split('#')[0],
          symbol_name: edge.target_id.includes('#') ? edge.target_id.split('#')[1] : null,
          kind: 'symbol',
        });
      }

      if (!this.outgoingEdges.has(edge.source_id)) {
        this.outgoingEdges.set(edge.source_id, []);
      }
      this.outgoingEdges.get(edge.source_id)!.push(edge);

      if (!this.incomingEdges.has(edge.target_id)) {
        this.incomingEdges.set(edge.target_id, []);
      }
      this.incomingEdges.get(edge.target_id)!.push(edge);
    }
  }

  /**
   * Resolves a target string (exact ID, file path, symbol name, or fuzzy match) to node IDs.
   */
  public resolveNodeIds(query: string): string[] {
    if (this.nodes.has(query)) {
      return [query];
    }

    const matches: string[] = [];
    const queryLower = query.toLowerCase().replace(/\\/g, '/');

    for (const [id, node] of this.nodes.entries()) {
      const idLower = id.toLowerCase();
      const fileLower = node.file_path.toLowerCase();
      const symLower = (node.symbol_name || '').toLowerCase();

      if (
        idLower === queryLower ||
        fileLower === queryLower ||
        fileLower.endsWith('/' + queryLower) ||
        fileLower.endsWith(queryLower) ||
        symLower === queryLower
      ) {
        matches.push(id);
      }
    }

    // Fallback: substring matching
    if (matches.length === 0) {
      for (const [id, node] of this.nodes.entries()) {
        if (
          id.toLowerCase().includes(queryLower) ||
          node.file_path.toLowerCase().includes(queryLower)
        ) {
          matches.push(id);
        }
      }
    }

    return matches;
  }

  /**
   * Computes the blast radius starting from target up to maxDepth.
   * Default direction: downstream (who depends on or imports this target).
   */
  public getBlastRadius(
    targetQuery: string,
    options: {
      depth?: number;
      direction?: 'downstream' | 'upstream' | 'both';
      includeSymbols?: boolean;
    } = {},
  ): BlastRadiusResult {
    const maxDepth = options.depth !== undefined ? options.depth : 3;
    const direction = options.direction || 'downstream';

    const matchedIds = this.resolveNodeIds(targetQuery);
    const startId = matchedIds.length > 0 ? matchedIds[0] : targetQuery;

    const visited = new Set<string>([startId]);
    const domainsAffected = new Set<string>();
    const startNode = this.nodes.get(startId);
    if (startNode?.domain) {
      domainsAffected.add(startNode.domain);
    }

    const treeNodes: BlastRadiusNode[] = [];
    let totalCount = 0;
    let maxDepthReached = 0;

    const queue: { id: string; depth: number; parentList: BlastRadiusNode[] }[] = [
      { id: startId, depth: 0, parentList: treeNodes },
    ];

    // If starting from a file node, also seed with its contained symbol nodes at depth 0
    if (!startId.includes('#')) {
      for (const [nodeId, node] of this.nodes.entries()) {
        if (node.file_path === startId && nodeId !== startId) {
          visited.add(nodeId);
          queue.push({ id: nodeId, depth: 0, parentList: treeNodes });
        }
      }
    }

    while (queue.length > 0) {
      const { id, depth, parentList } = queue.shift()!;
      if (depth >= maxDepth) continue;

      const nextEdges: { targetId: string; relation: string }[] = [];

      // Downstream: who imports/calls/depends on this node (incoming edges)
      if (direction === 'downstream' || direction === 'both') {
        const incoming = this.incomingEdges.get(id) || [];
        for (const edge of incoming) {
          nextEdges.push({ targetId: edge.source_id, relation: edge.relation });
        }
      }

      // Upstream: what this node imports/calls (outgoing edges)
      if (direction === 'upstream' || direction === 'both') {
        const outgoing = this.outgoingEdges.get(id) || [];
        for (const edge of outgoing) {
          nextEdges.push({ targetId: edge.target_id, relation: edge.relation });
        }
      }

      for (const { targetId, relation } of nextEdges) {
        if (!visited.has(targetId)) {
          visited.add(targetId);
          totalCount++;
          const targetNode = this.nodes.get(targetId);
          if (targetNode?.domain) {
            domainsAffected.add(targetNode.domain);
          }

          const currentDepth = depth + 1;
          if (currentDepth > maxDepthReached) {
            maxDepthReached = currentDepth;
          }

          const bNode: BlastRadiusNode = {
            id: targetId,
            filePath: targetNode ? targetNode.file_path : targetId.split('#')[0],
            symbolName: targetNode ? targetNode.symbol_name || null : null,
            kind: targetNode ? targetNode.kind : 'symbol',
            domain: targetNode ? targetNode.domain || null : null,
            phase: targetNode ? targetNode.lifecycle_phase || null : null,
            depth: currentDepth,
            relation,
            children: [],
          };

          parentList.push(bNode);

          queue.push({
            id: targetId,
            depth: currentDepth,
            parentList: bNode.children,
          });
        }
      }
    }

    return {
      target: startId,
      totalAffected: totalCount,
      maxDepthReached,
      domainsAffected: Array.from(domainsAffected),
      nodes: treeNodes,
    };
  }

  /**
   * Finds the shortest directed path between source and target using BFS.
   */
  public findShortestPath(
    sourceQuery: string,
    targetQuery: string,
    options: { maxHops?: number; relationTypes?: string[] } = {},
  ): ShortestPathResult | null {
    const maxHops = options.maxHops || 15;
    const allowedRelations = options.relationTypes ? new Set(options.relationTypes) : null;

    const sourceMatches = this.resolveNodeIds(sourceQuery);
    const targetMatches = this.resolveNodeIds(targetQuery);

    if (sourceMatches.length === 0 || targetMatches.length === 0) {
      return null;
    }

    const startId = sourceMatches[0];
    const destinationId = targetMatches[0];

    if (startId === destinationId) {
      return {
        sourceId: startId,
        targetId: destinationId,
        totalHops: 0,
        path: [startId],
        steps: [],
      };
    }

    const queue: { currentId: string; path: string[]; steps: ShortestPathStep[] }[] = [
      { currentId: startId, path: [startId], steps: [] },
    ];
    const visited = new Set<string>([startId]);

    while (queue.length > 0) {
      const { currentId, path: currPath, steps: currSteps } = queue.shift()!;
      if (currPath.length > maxHops) continue;

      const outgoing = this.outgoingEdges.get(currentId) || [];
      for (const edge of outgoing) {
        if (allowedRelations && !allowedRelations.has(edge.relation)) {
          continue;
        }

        const nextId = edge.target_id;
        const nextStep: ShortestPathStep = {
          fromId: currentId,
          toId: nextId,
          relation: edge.relation,
          weight: edge.weight || 1.0,
        };

        if (nextId === destinationId) {
          return {
            sourceId: startId,
            targetId: destinationId,
            totalHops: currSteps.length + 1,
            path: [...currPath, nextId],
            steps: [...currSteps, nextStep],
          };
        }

        if (!visited.has(nextId)) {
          visited.add(nextId);
          queue.push({
            currentId: nextId,
            path: [...currPath, nextId],
            steps: [...currSteps, nextStep],
          });
        }
      }
    }

    return null;
  }

  /**
   * Computes In-Degree and Out-Degree centrality for all nodes in the graph.
   */
  public getNodeCentralities(): Map<string, NodeCentrality> {
    const centralities = new Map<string, NodeCentrality>();

    for (const id of this.nodes.keys()) {
      const inDeg = (this.incomingEdges.get(id) || []).length;
      const outDeg = (this.outgoingEdges.get(id) || []).length;
      centralities.set(id, {
        id,
        inDegree: inDeg,
        outDegree: outDeg,
        totalDegree: inDeg + outDeg,
        isHub: inDeg >= 8 || outDeg >= 12 || inDeg + outDeg >= 15,
      });
    }

    return centralities;
  }

  /**
   * Detects architectural smells:
   * 1. God Nodes (high fan-in/fan-out)
   * 2. Dependency Cycles using Tarjan's Strongly Connected Components algorithm
   * 3. Domain Boundary Leaks (cross-domain dependencies bypassing entrypoints)
   */
  public detectSmells(): ArchitecturalSmellsReport {
    const godNodes: SmellGodNode[] = [];
    const domainLeaks: SmellDomainLeak[] = [];

    // 1. Centrality / God Nodes
    const centralities = this.getNodeCentralities();
    for (const [id, c] of centralities.entries()) {
      if (c.inDegree >= 10 || c.outDegree >= 15 || c.totalDegree >= 18) {
        const node = this.nodes.get(id);
        let reason: string;
        if (c.inDegree >= 10 && c.outDegree >= 15) {
          reason = `Extreme coupling hub: high fan-in (${c.inDegree}) and high fan-out (${c.outDegree})`;
        } else if (c.inDegree >= 10) {
          reason = `High fan-in God Node (${c.inDegree} incoming dependents)`;
        } else {
          reason = `High fan-out God Node (${c.outDegree} outgoing dependencies)`;
        }

        godNodes.push({
          id,
          filePath: node ? node.file_path : id.split('#')[0],
          kind: node ? node.kind : 'symbol',
          inDegree: c.inDegree,
          outDegree: c.outDegree,
          totalDegree: c.totalDegree,
          reason,
        });
      }
    }

    // 2. Tarjan's Strongly Connected Components (Cycle Detection)
    const cycles = this.detectTarjanCycles();

    // 3. Domain Boundary Leaks
    for (const [sourceId, edges] of this.outgoingEdges.entries()) {
      const sourceNode = this.nodes.get(sourceId);
      if (!sourceNode || !sourceNode.domain) continue;

      for (const edge of edges) {
        const targetNode = this.nodes.get(edge.target_id);
        if (!targetNode || !targetNode.domain) continue;

        if (sourceNode.domain !== targetNode.domain) {
          // Check if target is a private/internal non-entrypoint file
          const targetPath = targetNode.file_path.toLowerCase();
          const isInternal =
            targetPath.includes('/internal/') ||
            targetPath.includes('/private/') ||
            targetPath.includes('/impl/');

          if (isInternal) {
            domainLeaks.push({
              sourceId,
              sourceDomain: sourceNode.domain,
              targetId: edge.target_id,
              targetDomain: targetNode.domain,
              relation: edge.relation,
              reason: `Direct cross-domain link from [Domain: ${sourceNode.domain}] to internal module in [Domain: ${targetNode.domain}]`,
            });
          }
        }
      }
    }

    return {
      godNodes: godNodes.sort((a, b) => b.totalDegree - a.totalDegree),
      cycles,
      domainLeaks,
      totalSmells: godNodes.length + cycles.length + domainLeaks.length,
    };
  }

  /**
   * Tarjan's Strongly Connected Components algorithm for cycle detection.
   */
  private detectTarjanCycles(): SmellCycle[] {
    let index = 0;
    const indices = new Map<string, number>();
    const lowlinks = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const sccs: string[][] = [];

    const strongConnect = (v: string) => {
      indices.set(v, index);
      lowlinks.set(v, index);
      index++;
      stack.push(v);
      onStack.add(v);

      const edges = this.outgoingEdges.get(v) || [];
      for (const edge of edges) {
        const w = edge.target_id;
        if (!indices.has(w)) {
          strongConnect(w);
          lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
        } else if (onStack.has(w)) {
          lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
        }
      }

      if (lowlinks.get(v) === indices.get(v)) {
        const scc: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          scc.push(w);
        } while (w !== v);

        // Only cycles with >= 2 nodes or self-loops are cycles
        if (scc.length > 1) {
          sccs.push(scc);
        } else if (scc.length === 1) {
          const selfEdges = (this.outgoingEdges.get(scc[0]) || []).filter(
            (e) => e.target_id === scc[0],
          );
          if (selfEdges.length > 0) {
            sccs.push(scc);
          }
        }
      }
    };

    for (const v of this.nodes.keys()) {
      if (!indices.has(v)) {
        strongConnect(v);
      }
    }

    return sccs.map((nodes) => ({
      cycleLength: nodes.length,
      nodes,
    }));
  }

  /**
   * Formats Blast Radius as a compact ANSI tree string.
   */
  public formatBlastRadiusTree(res: BlastRadiusResult): string {
    const lines: string[] = [];
    lines.push(
      `🎯 Blast Radius for ${res.target} (${res.maxDepthReached} levels, ${res.totalAffected} affected entities):`,
    );

    const renderChildren = (children: BlastRadiusNode[], prefix: string) => {
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const isLast = i === children.length - 1;
        const branch = isLast ? '└── ' : '├── ';
        const domainTag = child.domain ? `[Domain: ${child.domain}] ` : '';
        const symbolTag = child.symbolName ? `#${child.symbolName}` : '';
        const relationTag = ` (${child.relation})`;

        lines.push(`${prefix}${branch}${domainTag}${child.filePath}${symbolTag}${relationTag}`);
        renderChildren(child.children, prefix + (isLast ? '    ' : '│   '));
      }
    };

    renderChildren(res.nodes, '');
    return lines.join('\n');
  }

  /**
   * Formats Shortest Path as a step-by-step visual chain.
   */
  public formatShortestPath(res: ShortestPathResult): string {
    const lines: string[] = [];
    lines.push(`🔗 Shortest Path: ${res.sourceId} -> ${res.targetId} (${res.totalHops} hops)`);

    if (res.steps.length === 0) {
      lines.push(res.sourceId);
      return lines.join('\n');
    }

    lines.push(res.steps[0].fromId);
    let indent = '  ';
    for (const step of res.steps) {
      lines.push(`${indent}└─(${step.relation})─> ${step.toId}`);
      indent += '    ';
    }

    return lines.join('\n');
  }
}

import { GraphNode, GraphEdge } from './extractor';
export { GraphNode, GraphEdge } from './extractor';

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

export interface NodeExplanationConnection {
  nodeId: string;
  filePath: string;
  symbolName: string | null;
  kind: string;
  relation: string;
  confidence: string;
  direction: 'incoming' | 'outgoing';
}

export interface NodeExplanationResult {
  nodeId: string;
  filePath: string;
  symbolName: string | null;
  kind: string;
  domain: string | null;
  phase: string | null;
  locStart: number | null;
  locEnd: number | null;
  communityId: number;
  communityLabel: string;
  inDegree: number;
  outDegree: number;
  totalDegree: number;
  isHub: boolean;
  incoming: NodeExplanationConnection[];
  outgoing: NodeExplanationConnection[];
  downstreamImpactCount: number;
}

export interface CommunityInfo {
  id: number;
  label: string;
  nodes: string[];
  hubNode: string;
  dominantDomain: string | null;
  internalEdges: number;
  externalEdges: number;
  cohesion: number;
}

export interface CommunityDetectionResult {
  communities: Record<number, string[]>;
  communityInfo: CommunityInfo[];
  modularity: number;
  totalCommunities: number;
}

export interface SurprisingConnection {
  sourceId: string;
  targetId: string;
  relation: string;
  confidence: string;
  sourceDomain: string | null;
  targetDomain: string | null;
  sourceCommunity: number;
  targetCommunity: number;
  surpriseScore: number;
  reason: string;
}

export interface ArchitectureQuestion {
  id: string;
  category: 'god_node' | 'cross_domain_leak' | 'cycle' | 'surprising_edge';
  entity: string;
  question: string;
  rationale: string;
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
   * Alias for findShortestPath.
   */
  public getShortestPath(
    sourceQuery: string,
    targetQuery: string,
    options: { maxHops?: number; relationTypes?: string[] } = {},
  ): ShortestPathResult | null {
    return this.findShortestPath(sourceQuery, targetQuery, options);
  }

  /**
   * Finds the shortest path (unweighted BFS) between source and target nodes/symbols.
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

  /**
   * Explains a target node/symbol, its central role, connections, confidence, and community.
   */
  public explainNode(targetQuery: string): NodeExplanationResult | null {
    const matched = this.resolveNodeIds(targetQuery);
    if (matched.length === 0) {
      return null;
    }
    const nodeId = matched[0];
    const node = this.nodes.get(nodeId);
    if (!node) return null;

    const incoming = this.incomingEdges.get(nodeId) || [];
    const outgoing = this.outgoingEdges.get(nodeId) || [];

    const incomingConnections: NodeExplanationConnection[] = incoming.map((edge) => {
      const srcNode = this.nodes.get(edge.source_id);
      return {
        nodeId: edge.source_id,
        filePath: srcNode?.file_path || edge.source_id.split('#')[0],
        symbolName:
          srcNode?.symbol_name ||
          (edge.source_id.includes('#') ? edge.source_id.split('#')[1] : null),
        kind: srcNode?.kind || 'symbol',
        relation: edge.relation,
        confidence: edge.confidence || 'EXTRACTED',
        direction: 'incoming',
      };
    });

    const outgoingConnections: NodeExplanationConnection[] = outgoing.map((edge) => {
      const tgtNode = this.nodes.get(edge.target_id);
      return {
        nodeId: edge.target_id,
        filePath: tgtNode?.file_path || edge.target_id.split('#')[0],
        symbolName:
          tgtNode?.symbol_name ||
          (edge.target_id.includes('#') ? edge.target_id.split('#')[1] : null),
        kind: tgtNode?.kind || 'symbol',
        relation: edge.relation,
        confidence: edge.confidence || 'EXTRACTED',
        direction: 'outgoing',
      };
    });

    const inDegree = incoming.length;
    const outDegree = outgoing.length;
    const totalDegree = inDegree + outDegree;

    // Determine community membership
    const communityRes = this.getCommunities();
    let communityId = 0;
    let communityLabel = 'Community 0';
    for (const info of communityRes.communityInfo) {
      if (info.nodes.includes(nodeId) || info.nodes.includes(node.file_path)) {
        communityId = info.id;
        communityLabel = info.label;
        break;
      }
    }

    // Downstream blast radius impact
    const blast = this.getBlastRadius(nodeId, { depth: 2, direction: 'downstream' });

    return {
      nodeId,
      filePath: node.file_path,
      symbolName: node.symbol_name || null,
      kind: node.kind,
      domain: node.domain || null,
      phase: node.lifecycle_phase || null,
      locStart: node.loc_start || null,
      locEnd: node.loc_end || null,
      communityId,
      communityLabel,
      inDegree,
      outDegree,
      totalDegree,
      isHub: totalDegree >= 10,
      incoming: incomingConnections,
      outgoing: outgoingConnections,
      downstreamImpactCount: blast.totalAffected,
    };
  }

  /**
   * Formats node explanation as a readable CLI string.
   */
  public formatNodeExplanation(res: NodeExplanationResult): string {
    const lines: string[] = [];
    const entityTitle = res.symbolName ? `${res.filePath}#${res.symbolName}` : res.filePath;
    lines.push(`🔍 Node Profile: ${entityTitle}`);
    lines.push(`  Kind:        ${res.kind}`);
    if (res.domain) lines.push(`  Domain:      ${res.domain}`);
    if (res.phase) lines.push(`  Phase:       ${res.phase}`);
    if (res.locStart)
      lines.push(`  Location:    Lines ${res.locStart}-${res.locEnd || res.locStart}`);
    lines.push(`  Community:   [#${res.communityId}] ${res.communityLabel}`);
    lines.push(
      `  Centrality:  Total Degree: ${res.totalDegree} (In: ${res.inDegree}, Out: ${res.outDegree})${res.isHub ? ' ⭐ [CENTRAL HUB]' : ''}`,
    );
    lines.push(`  Downstream:  ${res.downstreamImpactCount} entities impacted`);
    lines.push('');

    lines.push(`  Connections (${res.totalDegree}):`);
    for (const out of res.outgoing) {
      const targetLabel = out.symbolName ? `${out.filePath}#${out.symbolName}` : out.filePath;
      lines.push(`    ──[${out.relation}]──> ${targetLabel} [${out.confidence}]`);
    }
    for (const inc of res.incoming) {
      const srcLabel = inc.symbolName ? `${inc.filePath}#${inc.symbolName}` : inc.filePath;
      lines.push(`    <──[${inc.relation}]── ${srcLabel} [${inc.confidence}]`);
    }

    return lines.join('\n');
  }

  /**
   * Performs Louvain modularity-based community detection across graph nodes.
   */
  public getCommunities(): CommunityDetectionResult {
    const nodeIds = Array.from(this.nodes.keys());
    if (nodeIds.length === 0) {
      return { communities: {}, communityInfo: [], modularity: 0, totalCommunities: 0 };
    }

    // Build adjacency weights
    const neighbors = new Map<string, Map<string, number>>();
    let totalWeight = 0;
    const nodeDegree = new Map<string, number>();

    for (const u of nodeIds) {
      neighbors.set(u, new Map());
      nodeDegree.set(u, 0);
    }

    for (const [u, edges] of this.outgoingEdges.entries()) {
      for (const edge of edges) {
        const v = edge.target_id;
        if (!neighbors.has(u)) neighbors.set(u, new Map());
        if (!neighbors.has(v)) neighbors.set(v, new Map());

        const w = edge.weight || 1.0;
        const currU = neighbors.get(u)!.get(v) || 0;
        neighbors.get(u)!.set(v, currU + w);

        const currV = neighbors.get(v)!.get(u) || 0;
        neighbors.get(v)!.set(u, currV + w);

        nodeDegree.set(u, (nodeDegree.get(u) || 0) + w);
        nodeDegree.set(v, (nodeDegree.get(v) || 0) + w);
        totalWeight += w;
      }
    }

    if (totalWeight === 0) {
      // Degenerate graph: group by domain or singleton
      const communities: Record<number, string[]> = {};
      const communityInfo: CommunityInfo[] = [];
      const domainMap = new Map<string, string[]>();

      for (const [id, node] of this.nodes.entries()) {
        const dom = node.domain || 'default';
        if (!domainMap.has(dom)) domainMap.set(dom, []);
        domainMap.get(dom)!.push(id);
      }

      let cIdx = 0;
      for (const [dom, members] of domainMap.entries()) {
        communities[cIdx] = members;
        communityInfo.push({
          id: cIdx,
          label: `Domain: ${dom}`,
          nodes: members,
          hubNode: members[0],
          dominantDomain: dom === 'default' ? null : dom,
          internalEdges: 0,
          externalEdges: 0,
          cohesion: 1.0,
        });
        cIdx++;
      }

      return { communities, communityInfo, modularity: 0, totalCommunities: communityInfo.length };
    }

    const m = totalWeight;
    const community = new Map<string, number>();
    const communityTot = new Map<number, number>();

    nodeIds.forEach((u, i) => {
      community.set(u, i);
      communityTot.set(i, nodeDegree.get(u) || 0);
    });

    let improved = true;
    let iteration = 0;
    const maxIterations = 15;

    while (improved && iteration < maxIterations) {
      improved = false;
      iteration++;

      for (const u of nodeIds) {
        const currentComm = community.get(u)!;
        const k_u = nodeDegree.get(u) || 0;

        // Weights to each neighboring community
        const commWeights = new Map<number, number>();
        for (const [v, w] of (neighbors.get(u) || new Map()).entries()) {
          const c = community.get(v)!;
          commWeights.set(c, (commWeights.get(c) || 0) + w);
        }

        // Remove u from its current community
        communityTot.set(currentComm, (communityTot.get(currentComm) || 0) - k_u);

        let bestComm = currentComm;
        let bestGain = 0;

        for (const [c, k_in_c] of commWeights.entries()) {
          const tot_c = communityTot.get(c) || 0;
          // Delta Q modularity gain
          const deltaQ = k_in_c - (tot_c * k_u) / m;
          if (deltaQ > bestGain) {
            bestGain = deltaQ;
            bestComm = c;
          }
        }

        // Reinsert u
        community.set(u, bestComm);
        communityTot.set(bestComm, (communityTot.get(bestComm) || 0) + k_u);

        if (bestComm !== currentComm) {
          improved = true;
        }
      }
    }

    // Renumber communities 0..C-1
    const rawToNormalized = new Map<number, number>();
    let nextId = 0;
    const groups = new Map<number, string[]>();

    for (const [u, rawC] of community.entries()) {
      if (!rawToNormalized.has(rawC)) {
        rawToNormalized.set(rawC, nextId++);
      }
      const normC = rawToNormalized.get(rawC)!;
      if (!groups.has(normC)) groups.set(normC, []);
      groups.get(normC)!.push(u);
    }

    const communities: Record<number, string[]> = {};
    const communityInfo: CommunityInfo[] = [];

    for (const [cId, members] of groups.entries()) {
      communities[cId] = members;

      // Find central hub in community
      let hubNode = members[0];
      let maxDeg = -1;
      const domainCount = new Map<string, number>();

      let internalEdges = 0;
      let externalEdges = 0;

      const memberSet = new Set(members);

      for (const u of members) {
        const deg =
          (this.outgoingEdges.get(u)?.length || 0) + (this.incomingEdges.get(u)?.length || 0);
        if (deg > maxDeg) {
          maxDeg = deg;
          hubNode = u;
        }

        const node = this.nodes.get(u);
        if (node?.domain) {
          domainCount.set(node.domain, (domainCount.get(node.domain) || 0) + 1);
        }

        for (const edge of this.outgoingEdges.get(u) || []) {
          if (memberSet.has(edge.target_id)) {
            internalEdges++;
          } else {
            externalEdges++;
          }
        }
      }

      let dominantDomain: string | null = null;
      let maxDomainCount = 0;
      for (const [dom, count] of domainCount.entries()) {
        if (count > maxDomainCount) {
          maxDomainCount = count;
          dominantDomain = dom;
        }
      }

      const hubShort = hubNode.includes('#')
        ? hubNode.split('#')[1]
        : hubNode.split('/').pop() || hubNode;
      const label = dominantDomain ? `${dominantDomain} (${hubShort})` : hubShort;
      const cohesion =
        internalEdges + externalEdges > 0 ? internalEdges / (internalEdges + externalEdges) : 1.0;

      communityInfo.push({
        id: cId,
        label,
        nodes: members,
        hubNode,
        dominantDomain,
        internalEdges,
        externalEdges,
        cohesion: Math.round(cohesion * 100) / 100,
      });
    }

    return {
      communities,
      communityInfo: communityInfo.sort((a, b) => b.nodes.length - a.nodes.length),
      modularity: 0.5,
      totalCommunities: communityInfo.length,
    };
  }

  /**
   * Detects surprising cross-community or cross-domain dependencies with low neighborhood overlap.
   */
  public getSurprisingConnections(): SurprisingConnection[] {
    const communityRes = this.getCommunities();
    const nodeToComm = new Map<string, number>();
    for (const info of communityRes.communityInfo) {
      for (const u of info.nodes) {
        nodeToComm.set(u, info.id);
      }
    }

    const surprising: SurprisingConnection[] = [];

    for (const [sourceId, edges] of this.outgoingEdges.entries()) {
      const srcNode = this.nodes.get(sourceId);
      const srcComm = nodeToComm.get(sourceId) ?? -1;

      for (const edge of edges) {
        const targetId = edge.target_id;
        const tgtNode = this.nodes.get(targetId);
        const tgtComm = nodeToComm.get(targetId) ?? -1;

        const isCrossDomain = Boolean(
          srcNode?.domain && tgtNode?.domain && srcNode.domain !== tgtNode.domain,
        );
        const isCrossCommunity = srcComm !== -1 && tgtComm !== -1 && srcComm !== tgtComm;

        if (isCrossCommunity || isCrossDomain) {
          // Jaccard similarity of neighborhoods
          const srcNeighbors = new Set(
            (this.outgoingEdges.get(sourceId) || []).map((e) => e.target_id),
          );
          const tgtNeighbors = new Set(
            (this.incomingEdges.get(targetId) || []).map((e) => e.source_id),
          );

          let intersection = 0;
          for (const n of srcNeighbors) {
            if (tgtNeighbors.has(n)) intersection++;
          }
          const union = srcNeighbors.size + tgtNeighbors.size - intersection;
          const jaccard = union > 0 ? intersection / union : 0;

          if (jaccard < 0.25 || isCrossDomain) {
            const surpriseScore = Math.round((1 - jaccard) * 100) / 100;
            surprising.push({
              sourceId,
              targetId,
              relation: edge.relation,
              confidence: edge.confidence || 'EXTRACTED',
              sourceDomain: srcNode?.domain || null,
              targetDomain: tgtNode?.domain || null,
              sourceCommunity: srcComm,
              targetCommunity: tgtComm,
              surpriseScore,
              reason: isCrossDomain
                ? `Cross-domain coupling from ${srcNode?.domain} to ${tgtNode?.domain}`
                : `Distant bridge between Community #${srcComm} and Community #${tgtComm}`,
            });
          }
        }
      }
    }

    return surprising.sort((a, b) => b.surpriseScore - a.surpriseScore);
  }

  /**
   * Alias for detectSmells.
   */
  public detectArchitecturalSmells(): ArchitecturalSmellsReport {
    return this.detectSmells();
  }

  /**
   * Generates actionable architectural review questions based on topology.
   */
  public suggestArchitectureQuestions(): ArchitectureQuestion[] {
    const smells = this.detectSmells();
    const surprises = this.getSurprisingConnections();
    const questions: ArchitectureQuestion[] = [];

    // 1. Questions from God Nodes
    for (const god of smells.godNodes.slice(0, 3)) {
      questions.push({
        id: `q-god-${god.id.replace(/[^a-zA-Z0-9]/g, '-')}`,
        category: 'god_node',
        entity: god.id,
        question: `Should "${god.id}" be refactored into smaller, focused sub-modules to reduce its ${god.totalDegree} dependencies?`,
        rationale: `Node is a central bottleneck with in-degree ${god.inDegree} and out-degree ${god.outDegree}.`,
      });
    }

    // 2. Questions from Cycles
    for (let i = 0; i < Math.min(smells.cycles.length, 2); i++) {
      const cycle = smells.cycles[i];
      questions.push({
        id: `q-cycle-${i}`,
        category: 'cycle',
        entity: cycle.nodes.join(' ↔ '),
        question: `Can the circular dependency chain between [${cycle.nodes.join(' -> ')}] be broken using dependency inversion?`,
        rationale: `Cycle of length ${cycle.cycleLength} prevents clean layered compilation and increases coupling.`,
      });
    }

    // 3. Questions from Domain Leaks / Surprises
    for (const surp of surprises.slice(0, 3)) {
      questions.push({
        id: `q-surp-${surp.sourceId.replace(/[^a-zA-Z0-9]/g, '-')}-${surp.targetId.replace(/[^a-zA-Z0-9]/g, '-')}`,
        category: 'surprising_edge',
        entity: `${surp.sourceId} -> ${surp.targetId}`,
        question: `Is the coupling from "${surp.sourceId}" to "${surp.targetId}" intentional (${surp.reason})?`,
        rationale: `Bridge connects distinct architectural subsystems with surprise score ${surp.surpriseScore}.`,
      });
    }

    return questions;
  }
}

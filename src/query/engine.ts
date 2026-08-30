import { GraphEngine } from '../graph/engine';
import { TopologyEngine } from '../graph/topology';
import { FileStorageDriver, NodeFileSystem } from '../storage';
import { loadConfig } from '../config/schema';

export interface QueryOptions {
  budget?: number; // approximate token budget (default: 1500 tokens)
  mode?: 'bfs' | 'dfs'; // traversal mode (default: 'bfs')
  maxDepth?: number; // max hops (default: 2)
  configPath?: string;
}

export interface QuerySubGraphNode {
  id: string;
  filePath: string;
  symbolName: string | null;
  kind: string;
  domain: string | null;
  phase: string | null;
  description?: string;
  exports?: string[];
}

export interface QuerySubGraphEdge {
  sourceId: string;
  targetId: string;
  relation: string;
  confidence: string;
}

export interface QueryResult {
  query: string;
  mode: 'bfs' | 'dfs';
  seedNodes: string[];
  nodes: QuerySubGraphNode[];
  edges: QuerySubGraphEdge[];
  summaryText: string;
  approxTokens: number;
}

export class QueryEngine {
  private graphEngine: GraphEngine;
  private fsDriver: FileStorageDriver;

  constructor(options?: { graphEngine?: GraphEngine; fsDriver?: FileStorageDriver }) {
    if (options?.graphEngine) {
      this.graphEngine = options.graphEngine;
    } else {
      const config = loadConfig();
      this.graphEngine = new GraphEngine(config.paths.db_path);
    }
    this.fsDriver = options?.fsDriver || new NodeFileSystem();
  }

  /**
   * Queries the knowledge graph and returns a token-budgeted subgraph context package.
   */
  public async query(queryText: string, options: QueryOptions = {}): Promise<QueryResult> {
    await this.graphEngine.initialize();
    const mode = options.mode || 'bfs';
    const maxDepth = options.maxDepth !== undefined ? options.maxDepth : 2;
    const tokenBudget = options.budget || 1500;
    const charBudget = tokenBudget * 4; // ~4 chars per token

    // Load topology engine from DB
    const allNodes = await this.graphEngine.getGraphNodes();
    const allEdges = await this.graphEngine.getGraphEdges();
    const topology = new TopologyEngine(allNodes, allEdges);

    // 1. Identify seed nodes
    const seedSet = new Set<string>();

    // Strategy A: Direct name matching against graph nodes
    const directMatches = topology.resolveNodeIds(queryText);
    for (const m of directMatches) {
      seedSet.add(m);
    }

    // Strategy B: Word-by-word match
    const words = queryText
      .split(/\s+/)
      .map((w) => w.replace(/[^a-zA-Z0-9_-]/g, ''))
      .filter((w) => w.length >= 3);

    for (const word of words) {
      const wMatches = topology.resolveNodeIds(word);
      for (const m of wMatches.slice(0, 3)) {
        seedSet.add(m);
      }
    }

    // Strategy C: FTS5 search across sidecar specifications
    try {
      const ftsResults = await this.graphEngine.search(queryText, { limit: 5 });
      for (const res of ftsResults) {
        const matchingNode = allNodes.find(
          (n) => n.file_path === res.filePath || n.id === res.filePath,
        );
        if (matchingNode) {
          seedSet.add(matchingNode.id);
        } else {
          seedSet.add(res.filePath);
        }
      }
    } catch {
      // FTS fallback
    }

    // If still no seeds, pick central hubs
    if (seedSet.size === 0) {
      const smells = topology.detectSmells();
      for (const god of smells.godNodes.slice(0, 3)) {
        seedSet.add(god.id);
      }
    }

    const seedNodes = Array.from(seedSet).slice(0, 5);

    // 2. Expand subgraph via BFS or DFS
    const visitedNodes = new Set<string>(seedNodes);
    const collectedEdges: QuerySubGraphEdge[] = [];

    if (mode === 'bfs') {
      const queue: { id: string; depth: number }[] = seedNodes.map((id) => ({ id, depth: 0 }));
      while (queue.length > 0) {
        const { id, depth } = queue.shift()!;
        if (depth >= maxDepth) continue;

        const outgoing = allEdges.filter((e) => e.source_id === id);
        const incoming = allEdges.filter((e) => e.target_id === id);

        for (const edge of [...outgoing, ...incoming]) {
          const neighborId = edge.source_id === id ? edge.target_id : edge.source_id;
          collectedEdges.push({
            sourceId: edge.source_id,
            targetId: edge.target_id,
            relation: edge.relation,
            confidence: edge.confidence || 'EXTRACTED',
          });

          if (!visitedNodes.has(neighborId)) {
            visitedNodes.add(neighborId);
            queue.push({ id: neighborId, depth: depth + 1 });
          }
        }
      }
    } else {
      // DFS chain tracing
      const stack: { id: string; depth: number }[] = seedNodes.map((id) => ({ id, depth: 0 }));
      while (stack.length > 0) {
        const { id, depth } = stack.pop()!;
        if (depth >= maxDepth) continue;

        const outgoing = allEdges.filter((e) => e.source_id === id);
        for (const edge of outgoing) {
          collectedEdges.push({
            sourceId: edge.source_id,
            targetId: edge.target_id,
            relation: edge.relation,
            confidence: edge.confidence || 'EXTRACTED',
          });

          if (!visitedNodes.has(edge.target_id)) {
            visitedNodes.add(edge.target_id);
            stack.push({ id: edge.target_id, depth: depth + 1 });
          }
        }
      }
    }

    // Deduplicate edges
    const uniqueEdges: QuerySubGraphEdge[] = [];
    const edgeSeen = new Set<string>();
    for (const e of collectedEdges) {
      const key = `${e.sourceId}->${e.targetId}:${e.relation}`;
      if (!edgeSeen.has(key)) {
        edgeSeen.add(key);
        uniqueEdges.push(e);
      }
    }

    // Retrieve node metadata & sidecar descriptions
    const resultNodes: QuerySubGraphNode[] = [];
    for (const nId of visitedNodes) {
      const gNode = allNodes.find((n) => n.id === nId);
      const filePath = gNode?.file_path || (nId.includes('#') ? nId.split('#')[0] : nId);
      const symName = gNode?.symbol_name || (nId.includes('#') ? nId.split('#')[1] : null);

      // Check for sidecar description in DB
      let description: string | undefined;
      let expList: string[] | undefined;
      try {
        const sidecarRow = await this.graphEngine.getSidecar(filePath);
        if (sidecarRow) {
          description = sidecarRow.description;
          if (sidecarRow.exports) {
            expList = (sidecarRow.exports as string)
              .split(',')
              .map((s: string) => s.trim())
              .filter(Boolean);
          }
        }
      } catch {
        // Ignore sidecar fetch errors
      }

      resultNodes.push({
        id: nId,
        filePath,
        symbolName: symName,
        kind: gNode?.kind || 'symbol',
        domain: gNode?.domain || null,
        phase: gNode?.lifecycle_phase || null,
        description,
        exports: expList,
      });
    }

    // Format output and cap at character budget
    const formatted = this.formatMarkdownContext(
      queryText,
      mode,
      seedNodes,
      resultNodes,
      uniqueEdges,
    );
    let finalSummary = formatted;
    if (finalSummary.length > charBudget) {
      finalSummary =
        finalSummary.substring(0, charBudget) + '\n\n... [Truncated to stay within token budget]';
    }

    const approxTokens = Math.ceil(finalSummary.length / 4);

    return {
      query: queryText,
      mode,
      seedNodes,
      nodes: resultNodes,
      edges: uniqueEdges,
      summaryText: finalSummary,
      approxTokens,
    };
  }

  /**
   * Formats the extracted subgraph as structured, high-signal Markdown.
   */
  private formatMarkdownContext(
    query: string,
    mode: 'bfs' | 'dfs',
    seeds: string[],
    nodes: QuerySubGraphNode[],
    edges: QuerySubGraphEdge[],
  ): string {
    const lines: string[] = [];
    lines.push(`## 🧠 Knowledge Graph Context for: "${query}"`);
    lines.push(
      `*Mode:* \`${mode.toUpperCase()}\` | *Seeds:* ${seeds.map((s) => `\`${s}\``).join(', ')} | *SubGraph:* ${nodes.length} nodes, ${edges.length} edges`,
    );
    lines.push('');

    lines.push(`### 📌 Key Architectural Nodes`);
    for (const node of nodes) {
      const title = node.symbolName
        ? `\`${node.filePath}#${node.symbolName}\``
        : `\`${node.filePath}\``;
      const domainTag = node.domain ? ` [Domain: ${node.domain}]` : '';
      const phaseTag = node.phase ? ` [Phase: ${node.phase}]` : '';
      lines.push(`- **${title}** (${node.kind})${domainTag}${phaseTag}`);
      if (node.description) {
        lines.push(`  *Summary:* ${node.description}`);
      }
      if (node.exports && node.exports.length > 0) {
        lines.push(`  *Exports:* ${node.exports.slice(0, 5).join(', ')}`);
      }
    }
    lines.push('');

    lines.push(`### 🔗 Relationship Graph Connections`);
    if (edges.length === 0) {
      lines.push(`- *No direct inter-module relationships found for this scope.*`);
    } else {
      for (const e of edges.slice(0, 30)) {
        lines.push(
          `- \`${e.sourceId}\` ──[${e.relation}]──> \`${e.targetId}\` *(${e.confidence})*`,
        );
      }
      if (edges.length > 30) {
        lines.push(`- *... and ${edges.length - 30} additional connections.*`);
      }
    }

    return lines.join('\n');
  }
}

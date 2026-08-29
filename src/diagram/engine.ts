import * as path from 'path';
import { GraphEngine, normalizePosixPath } from '../graph/engine';
import { getModuleLayer, LAYER_DEFINITIONS } from '../lint/engine';
import { FileStorageDriver, NodeFileSystem } from '../storage';
import { loadConfig } from '../config/schema';

export type DiagramType = 'architecture' | 'sequence' | 'slice' | 'domain';

export interface DiagramOptions {
  type?: DiagramType;
  domain?: string;
  groupBy?: 'layer' | 'domain' | 'none';
  syncPath?: string;
  outputPath?: string;
  configPath?: string;
  depth?: number;
}

export interface DiagramResult {
  diagramType: DiagramType;
  mermaidCode: string;
  target?: string;
  syncedPath?: string;
  writtenPath?: string;
  generatedAt: string;
}

export class DiagramEngine {
  private graphEngine: GraphEngine;
  private fsDriver: FileStorageDriver;

  constructor(options?: { graphEngine?: GraphEngine; fsDriver?: FileStorageDriver }) {
    if (options?.graphEngine) {
      this.graphEngine = options.graphEngine;
    } else {
      const config = loadConfig();
      this.graphEngine = new GraphEngine(config.paths?.db_path);
    }
    this.fsDriver = options?.fsDriver || new NodeFileSystem();
  }

  private sanitizeNodeId(filePath: string): string {
    return 'n_' + filePath.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  /**
   * Generates a Mermaid diagram based on requested type and options.
   */
  public async generateDiagram(
    target?: string,
    options: DiagramOptions = {},
  ): Promise<DiagramResult> {
    await this.graphEngine.initialize();

    let existingNodes = await this.graphEngine.getGraphNodes();
    if (existingNodes.length === 0) {
      const config = loadConfig(options.configPath);
      await this.graphEngine.indexCodeWorkspace(config.paths?.specs_dir || 'src');
      await this.graphEngine.indexWorkspace(config.paths?.specs_dir || 'src');
      existingNodes = await this.graphEngine.getGraphNodes();
    }

    const type: DiagramType = options.type || (target ? 'slice' : 'architecture');
    let mermaidCode = '';

    if (type === 'sequence' && target) {
      mermaidCode = await this.generateSequenceDiagram(target, options);
    } else if (type === 'slice' && target) {
      mermaidCode = await this.generateSliceDiagram(target, options);
    } else {
      mermaidCode = await this.generateArchitectureDiagram(options);
    }

    let syncedPath: string | undefined;
    if (options.syncPath) {
      const targetDoc = normalizePosixPath(options.syncPath);
      await this.syncDiagramToDocument(targetDoc, mermaidCode);
      syncedPath = targetDoc;
    }

    let writtenPath: string | undefined;
    if (options.outputPath) {
      writtenPath = normalizePosixPath(options.outputPath);
      const dir = path.dirname(writtenPath);
      await this.fsDriver.mkdir(dir, { recursive: true });
      await this.fsDriver.writeFile(writtenPath, mermaidCode);
    }

    return {
      diagramType: type,
      mermaidCode,
      target,
      syncedPath,
      writtenPath,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Generates top-down architecture diagram grouped by layer or domain.
   */
  public async generateArchitectureDiagram(options: DiagramOptions = {}): Promise<string> {
    const nodes = await this.graphEngine.getGraphNodes();
    const edges = await this.graphEngine.getGraphEdges();
    const groupBy = options.groupBy || 'layer';

    const lines: string[] = [];
    lines.push('```mermaid');
    lines.push('flowchart TD');

    // Filter file-level nodes (exclude fine-grained symbol-only nodes for readability)
    const fileNodes = nodes.filter(
      (n) => n.kind === 'file' || n.kind === 'sidecar' || !n.symbol_name,
    );

    if (groupBy === 'layer') {
      const CANONICAL_LAYERS: { layer: number; name: string }[] = [
        { layer: 0, name: 'Foundation' },
        { layer: 1, name: 'Storage' },
        { layer: 2, name: 'Parser' },
        { layer: 3, name: 'Compiler' },
        { layer: 4, name: 'Graph' },
        { layer: 5, name: 'Engines' },
        { layer: 6, name: 'Interface' },
      ];

      // Group by layer 0 through 6
      for (const layerInfo of CANONICAL_LAYERS) {
        const layerMembers = fileNodes.filter(
          (n) => getModuleLayer(n.file_path).layer === layerInfo.layer,
        );

        if (layerMembers.length === 0) continue;

        lines.push(
          `  subgraph L${layerInfo.layer} ["Layer ${layerInfo.layer}: ${layerInfo.name}"]`,
        );
        for (const n of layerMembers) {
          const nodeId = this.sanitizeNodeId(n.file_path);
          const label = path.basename(n.file_path);
          lines.push(`    ${nodeId}["${label}"]`);
        }
        lines.push('  end');
      }
    } else {
      // Group by domain
      const domains = new Set<string>();
      for (const n of fileNodes) {
        if (n.domain) domains.add(n.domain);
      }

      for (const dom of domains) {
        const domainMembers = fileNodes.filter((n) => n.domain === dom);
        lines.push(`  subgraph D_${dom} ["${dom.toUpperCase()} Domain"]`);
        for (const n of domainMembers) {
          const nodeId = this.sanitizeNodeId(n.file_path);
          const label = path.basename(n.file_path);
          lines.push(`    ${nodeId}["${label}"]`);
        }
        lines.push('  end');
      }
    }

    // Connect edges
    const nodeIds = new Set(fileNodes.map((n) => n.id));
    const addedEdges = new Set<string>();

    for (const edge of edges) {
      if (edge.source_id === edge.target_id) continue;
      if (!nodeIds.has(edge.source_id) || !nodeIds.has(edge.target_id)) continue;

      const srcId = this.sanitizeNodeId(edge.source_id);
      const tgtId = this.sanitizeNodeId(edge.target_id);
      const edgeKey = `${srcId}->${tgtId}`;

      if (addedEdges.has(edgeKey)) continue;
      addedEdges.add(edgeKey);

      if (edge.relation === 'calls') {
        lines.push(`  ${srcId} -.->|calls| ${tgtId}`);
      } else {
        lines.push(`  ${srcId} --> ${tgtId}`);
      }
    }

    lines.push('```');
    return lines.join('\n');
  }

  /**
   * Generates a sequence diagram tracing downstream call flows from a target file/symbol.
   */
  public async generateSequenceDiagram(
    targetFile: string,
    options: DiagramOptions = {},
  ): Promise<string> {
    const normalized = normalizePosixPath(targetFile);
    const edges = await this.graphEngine.getGraphEdges();

    const maxDepth = options.depth || 3;
    const participants = new Set<string>();
    const calls: { from: string; to: string; label: string }[] = [];

    const queue: { id: string; depth: number }[] = [{ id: normalized, depth: 0 }];
    const visited = new Set<string>([normalized]);

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;

      participants.add(id);

      const outgoing = edges.filter(
        (e) => e.source_id === id && (e.relation === 'calls' || e.relation === 'imports'),
      );

      for (const edge of outgoing) {
        participants.add(edge.target_id);
        calls.push({
          from: id,
          to: edge.target_id,
          label: edge.relation === 'calls' ? 'calls' : 'imports',
        });

        if (!visited.has(edge.target_id)) {
          visited.add(edge.target_id);
          queue.push({ id: edge.target_id, depth: depth + 1 });
        }
      }
    }

    const lines: string[] = [];
    lines.push('```mermaid');
    lines.push('sequenceDiagram');
    lines.push('  autonumber');

    for (const p of participants) {
      const alias = this.sanitizeNodeId(p);
      const label = path.basename(p);
      lines.push(`  participant ${alias} as ${label}`);
    }

    for (const c of calls) {
      const fromAlias = this.sanitizeNodeId(c.from);
      const toAlias = this.sanitizeNodeId(c.to);
      lines.push(`  ${fromAlias}->>${toAlias}: ${c.label}`);
    }

    lines.push('```');
    return lines.join('\n');
  }

  /**
   * Generates a focused slice diagram showing neighborhood of a target module.
   */
  public async generateSliceDiagram(
    targetFile: string,
    options: DiagramOptions = {},
  ): Promise<string> {
    const normalized = normalizePosixPath(targetFile);
    const edges = await this.graphEngine.getGraphEdges();

    const upstream = edges.filter((e) => e.target_id === normalized);
    const downstream = edges.filter((e) => e.source_id === normalized);

    const lines: string[] = [];
    lines.push('```mermaid');
    lines.push('flowchart LR');

    const centerId = this.sanitizeNodeId(normalized);
    lines.push(`  ${centerId}["★ ${path.basename(normalized)}"]:::target`);

    // Upstream callers
    if (upstream.length > 0) {
      lines.push('  subgraph Upstream ["Upstream Dependents"]');
      for (const u of upstream) {
        const uId = this.sanitizeNodeId(u.source_id);
        lines.push(`    ${uId}["${path.basename(u.source_id)}"]`);
      }
      lines.push('  end');

      for (const u of upstream) {
        const uId = this.sanitizeNodeId(u.source_id);
        lines.push(`  ${uId} --> ${centerId}`);
      }
    }

    // Downstream dependencies
    if (downstream.length > 0) {
      lines.push('  subgraph Downstream ["Downstream Dependencies"]');
      for (const d of downstream) {
        const dId = this.sanitizeNodeId(d.target_id);
        lines.push(`    ${dId}["${path.basename(d.target_id)}"]`);
      }
      lines.push('  end');

      for (const d of downstream) {
        const dId = this.sanitizeNodeId(d.target_id);
        lines.push(`  ${centerId} --> ${dId}`);
      }
    }

    lines.push('  classDef target fill:#4f46e5,stroke:#3730a3,stroke-width:2px,color:#fff;');
    lines.push('```');

    return lines.join('\n');
  }

  /**
   * Synchronizes Mermaid diagram inside a document between <!-- BEGIN STUBS DIAGRAM --> markers.
   */
  public async syncDiagramToDocument(docPath: string, diagramContent: string): Promise<boolean> {
    let content = '';
    if (await this.fsDriver.exists(docPath)) {
      content = await this.fsDriver.readFile(docPath);
    }

    const beginMarker = '<!-- BEGIN STUBS DIAGRAM -->';
    const endMarker = '<!-- END STUBS DIAGRAM -->';

    const block = `${beginMarker}\n${diagramContent}\n${endMarker}`;

    if (content.includes(beginMarker) && content.includes(endMarker)) {
      const regex = new RegExp(`${beginMarker}[\\s\\S]*?${endMarker}`, 'g');
      content = content.replace(regex, block);
    } else {
      content = content.trim() + `\n\n## System Architecture Diagram\n\n${block}\n`;
    }

    const dir = path.dirname(docPath);
    await this.fsDriver.mkdir(dir, { recursive: true });
    await this.fsDriver.writeFile(docPath, content);
    return true;
  }
}

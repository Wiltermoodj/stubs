import { GraphEngine, normalizePosixPath } from '../graph/engine';
import { TopologyEngine } from '../graph/topology';
import { FileStorageDriver, NodeFileSystem } from '../storage';
import { loadConfig } from '../config/schema';

export interface ExportOptions {
  outputDir?: string;
  configPath?: string;
}

export interface ExportResult {
  format: 'obsidian' | 'wiki';
  outputDir: string;
  filesGenerated: string[];
  totalNodesExported: number;
}

export class ExportEngine {
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
   * Exports the knowledge graph as an Obsidian Vault with [[wikilinks]].
   */
  public async toObsidian(outputDir: string = './obsidian-vault'): Promise<ExportResult> {
    await this.graphEngine.initialize();
    const allNodes = await this.graphEngine.getGraphNodes();
    const allEdges = await this.graphEngine.getGraphEdges();
    const topology = new TopologyEngine(allNodes, allEdges);
    const communities = topology.getCommunities();

    const normOut = normalizePosixPath(outputDir);
    await this.fsDriver.mkdir(normOut, { recursive: true });

    const filesGenerated: string[] = [];

    // Map of nodeId -> clean filename
    const nodeFileMap = new Map<string, string>();
    for (const node of allNodes) {
      const cleanName = node.id.replace(/[/\\#:]/g, '_').replace(/\.[^/.]+$/, '');
      nodeFileMap.set(node.id, cleanName);
    }

    // 1. Generate node markdown notes
    for (const node of allNodes) {
      const cleanName = nodeFileMap.get(node.id) || 'node';
      const filePath = `${normOut}/${cleanName}.md`;

      const outgoing = allEdges.filter((e) => e.source_id === node.id);
      const incoming = allEdges.filter((e) => e.target_id === node.id);

      const lines: string[] = [];
      lines.push('---');
      lines.push(`id: "${node.id}"`);
      lines.push(`kind: "${node.kind}"`);
      if (node.domain) lines.push(`domain: "${node.domain}"`);
      if (node.lifecycle_phase) lines.push(`phase: "${node.lifecycle_phase}"`);
      lines.push(`file_path: "${node.file_path}"`);
      lines.push('tags:');
      lines.push(`  - type/${node.kind}`);
      if (node.domain) lines.push(`  - domain/${node.domain}`);
      lines.push('---');
      lines.push('');

      lines.push(`# ${node.symbol_name || node.file_path}`);
      lines.push(`**File:** \`${node.file_path}\` | **Kind:** \`${node.kind}\``);
      lines.push('');

      if (outgoing.length > 0) {
        lines.push('## 📤 Outgoing Connections');
        for (const edge of outgoing) {
          const targetName = nodeFileMap.get(edge.target_id) || edge.target_id;
          lines.push(
            `- **${edge.relation}** → [[${targetName}|${edge.target_id}]] *(${edge.confidence || 'EXTRACTED'})*`,
          );
        }
        lines.push('');
      }

      if (incoming.length > 0) {
        lines.push('## 📥 Incoming Connections');
        for (const edge of incoming) {
          const srcName = nodeFileMap.get(edge.source_id) || edge.source_id;
          lines.push(
            `- **${edge.relation}** ← [[${srcName}|${edge.source_id}]] *(${edge.confidence || 'EXTRACTED'})*`,
          );
        }
        lines.push('');
      }

      await this.fsDriver.writeFile(filePath, lines.join('\n'));
      filesGenerated.push(filePath);
    }

    // 2. Generate Master Index.md
    const indexLines: string[] = [];
    indexLines.push('# 🏛️ Architecture Knowledge Graph Index');
    indexLines.push(`Generated: ${new Date().toISOString()}`);
    indexLines.push(
      `Total Nodes: **${allNodes.length}** | Total Relationships: **${allEdges.length}**`,
    );
    indexLines.push('');

    indexLines.push('## 🧩 Subsystems & Communities');
    for (const comm of communities.communityInfo) {
      indexLines.push(`### [#${comm.id}] ${comm.label}`);
      indexLines.push(
        `- **Hub Node:** [[${nodeFileMap.get(comm.hubNode) || comm.hubNode}|${comm.hubNode}]]`,
      );
      indexLines.push(
        `- **Cohesion:** ${(comm.cohesion * 100).toFixed(0)}% (${comm.nodes.length} members)`,
      );
      indexLines.push('- **Members:**');
      for (const member of comm.nodes.slice(0, 10)) {
        const cleanName = nodeFileMap.get(member) || member;
        indexLines.push(`  - [[${cleanName}|${member}]]`);
      }
      if (comm.nodes.length > 10) {
        indexLines.push(`  - *... and ${comm.nodes.length - 10} more*`);
      }
      indexLines.push('');
    }

    const indexFile = `${normOut}/Index.md`;
    await this.fsDriver.writeFile(indexFile, indexLines.join('\n'));
    filesGenerated.push(indexFile);

    return {
      format: 'obsidian',
      outputDir: normOut,
      filesGenerated,
      totalNodesExported: allNodes.length,
    };
  }

  /**
   * Exports the knowledge graph as structured, Wikipedia-style modular articles.
   */
  public async toWiki(outputDir: string = './wiki'): Promise<ExportResult> {
    await this.graphEngine.initialize();
    const allNodes = await this.graphEngine.getGraphNodes();
    const allEdges = await this.graphEngine.getGraphEdges();
    const topology = new TopologyEngine(allNodes, allEdges);
    const communities = topology.getCommunities();
    const smells = topology.detectArchitecturalSmells();
    const questions = topology.suggestArchitectureQuestions();

    const normOut = normalizePosixPath(outputDir);
    const commDir = `${normOut}/subsystems`;
    await this.fsDriver.mkdir(commDir, { recursive: true });

    const filesGenerated: string[] = [];

    // 1. Generate subsystem community articles
    for (const comm of communities.communityInfo) {
      const commSlug = comm.label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const filePath = `${commDir}/${comm.id}-${commSlug || 'subsystem'}.md`;

      const lines: string[] = [];
      lines.push(`# Subsystem: ${comm.label}`);
      lines.push(
        `**Community ID:** \`#${comm.id}\` | **Dominant Domain:** \`${comm.dominantDomain || 'General'}\``,
      );
      lines.push(
        `**Cohesion Score:** \`${(comm.cohesion * 100).toFixed(0)}%\` | **Members:** \`${comm.nodes.length}\``,
      );
      lines.push('');

      lines.push('## 🎯 Central Architectural Hub');
      lines.push(`The primary coordinator for this subsystem is **\`${comm.hubNode}\`**.`);
      lines.push('');

      lines.push('## 📦 Subsystem Members');
      for (const node of comm.nodes) {
        const gNode = allNodes.find((n) => n.id === node);
        const kindTag = gNode ? `*(${gNode.kind})*` : '';
        lines.push(`- **\`${node}\`** ${kindTag}`);
      }
      lines.push('');

      // Cross-boundary connections
      const crossEdges = allEdges.filter(
        (e) =>
          (comm.nodes.includes(e.source_id) && !comm.nodes.includes(e.target_id)) ||
          (!comm.nodes.includes(e.source_id) && comm.nodes.includes(e.target_id)),
      );

      if (crossEdges.length > 0) {
        lines.push('## 🌐 Cross-Subsystem Interfaces');
        for (const e of crossEdges.slice(0, 20)) {
          lines.push(
            `- \`${e.source_id}\` ──[${e.relation}]──> \`${e.target_id}\` *(${e.confidence || 'EXTRACTED'})*`,
          );
        }
        lines.push('');
      }

      await this.fsDriver.writeFile(filePath, lines.join('\n'));
      filesGenerated.push(filePath);
    }

    // 2. Generate Main index.md Wiki Portal
    const indexLines: string[] = [];
    indexLines.push('# 📖 Codebase Architecture Wiki');
    indexLines.push(`*Generated from AST Knowledge Graph on ${new Date().toLocaleDateString()}*`);
    indexLines.push('');

    indexLines.push('## 🗺️ Subsystems Map');
    for (const comm of communities.communityInfo) {
      const commSlug = comm.label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const link = `./subsystems/${comm.id}-${commSlug || 'subsystem'}.md`;
      indexLines.push(
        `- [**${comm.label}**](${link}) — Hub: \`${comm.hubNode}\` (${comm.nodes.length} entities, ${(comm.cohesion * 100).toFixed(0)}% cohesion)`,
      );
    }
    indexLines.push('');

    indexLines.push('## 🌟 Critical God Nodes (Central Bottlenecks)');
    for (const god of smells.godNodes.slice(0, 5)) {
      indexLines.push(
        `- **\`${god.id}\`** — Total Degree: ${god.totalDegree} (In: ${god.inDegree}, Out: ${god.outDegree})`,
      );
    }
    indexLines.push('');

    if (questions.length > 0) {
      indexLines.push('## ❓ Key Architecture Questions');
      for (const q of questions) {
        indexLines.push(`- **${q.entity}**: ${q.question} (*${q.rationale}*)`);
      }
      indexLines.push('');
    }

    const indexFile = `${normOut}/index.md`;
    await this.fsDriver.writeFile(indexFile, indexLines.join('\n'));
    filesGenerated.push(indexFile);

    return {
      format: 'wiki',
      outputDir: normOut,
      filesGenerated,
      totalNodesExported: allNodes.length,
    };
  }
}

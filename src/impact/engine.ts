import * as path from 'path';
import { GraphEngine, normalizePosixPath } from '../graph/engine';
import { TopologyEngine, BlastRadiusResult } from '../graph/topology';
import { loadConfig } from '../config/schema';
import { FileStorageDriver, NodeFileSystem } from '../storage';

export interface ImpactOptions {
  depth?: number;
  direction?: 'inbound' | 'outbound' | 'both';
  transitive?: boolean;
  configPath?: string;
}

export interface AffectedModuleInfo {
  id: string;
  filePath: string;
  kind: string;
  domain?: string;
  phase?: string;
  status?: string;
  statusFlag?: string;
  relation: string;
  depth: number;
}

export interface ImpactAnalysisResult {
  target: string;
  canonicalPath: string;
  totalAffected: number;
  maxDepth: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  domainsAffected: string[];
  affectedModules: AffectedModuleInfo[];
  staleRiskSidecars: string[];
  generatedAt: string;
}

export class ImpactEngine {
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
   * Calculates the blast radius and architectural impact of modifying the target module.
   */
  public async analyzeImpact(
    targetPath: string,
    options: ImpactOptions = {},
  ): Promise<ImpactAnalysisResult> {
    await this.graphEngine.initialize();

    let normalized = normalizePosixPath(targetPath);
    if (normalized.startsWith('./')) {
      normalized = normalized.substring(2);
    }

    // Ensure graph nodes exist
    const existingNodes = await this.graphEngine.getGraphNodes();
    if (existingNodes.length === 0) {
      const config = loadConfig();
      await this.graphEngine.indexCodeWorkspace(config.paths?.specs_dir || 'src');
    }

    const topology = await this.graphEngine.getTopologyEngine();
    const depth = options.depth !== undefined ? options.depth : options.transitive ? 5 : 3;
    const direction = options.direction || 'inbound'; // Default to inbound (dependents affected by target change)
    const topoDirection =
      direction === 'inbound' ? 'downstream' : direction === 'outbound' ? 'upstream' : 'both';

    const blast = topology.getBlastRadius(normalized, { depth, direction: topoDirection });

    const affectedModules: AffectedModuleInfo[] = [];
    const staleRiskSidecars: string[] = [];

    const flattenNodes = async (nodes: any[]) => {
      for (const node of nodes) {
        let sidecarInfo: any = null;
        try {
          sidecarInfo = await this.graphEngine.getSidecar(node.filePath);
          if (!sidecarInfo && node.filePath.endsWith('.ts')) {
            sidecarInfo = await this.graphEngine.getSidecar(`${node.filePath}.md`);
          }
        } catch {
          // Ignore
        }

        const info: AffectedModuleInfo = {
          id: node.id,
          filePath: node.filePath,
          kind: node.kind,
          domain: node.domain || sidecarInfo?.tags?.[0],
          phase: node.phase || sidecarInfo?.phase,
          status: sidecarInfo?.status,
          statusFlag: sidecarInfo?.status_flag,
          relation: node.relation,
          depth: node.depth,
        };

        affectedModules.push(info);

        if (sidecarInfo?.status_flag && sidecarInfo.status_flag !== 'clean') {
          staleRiskSidecars.push(node.filePath);
        }

        if (node.children && node.children.length > 0) {
          await flattenNodes(node.children);
        }
      }
    };

    await flattenNodes(blast.nodes);

    // Calculate Risk Level
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    const total = blast.totalAffected;
    const domainCount = blast.domainsAffected.length;

    if (total === 0) {
      riskLevel = 'LOW';
    } else if (total <= 2 && domainCount <= 1) {
      riskLevel = 'LOW';
    } else if (total <= 5 && domainCount <= 2) {
      riskLevel = 'MEDIUM';
    } else if (total <= 12 || domainCount <= 3) {
      riskLevel = 'HIGH';
    } else {
      riskLevel = 'CRITICAL';
    }

    return {
      target: targetPath,
      canonicalPath: normalized,
      totalAffected: blast.totalAffected,
      maxDepth: blast.maxDepthReached,
      riskLevel,
      domainsAffected: blast.domainsAffected,
      affectedModules,
      staleRiskSidecars: Array.from(new Set(staleRiskSidecars)),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Renders the impact analysis as human- and agent-readable Markdown.
   */
  public renderMarkdown(result: ImpactAnalysisResult): string {
    const lines: string[] = [];

    const riskBadges: Record<string, string> = {
      LOW: '🟢 LOW RISK',
      MEDIUM: '🟡 MEDIUM RISK',
      HIGH: '🟠 HIGH RISK',
      CRITICAL: '🔴 CRITICAL RISK',
    };

    lines.push(`# Impact & Blast-Radius Report: \`${result.canonicalPath}\``);
    lines.push(`> **Risk Assessment:** ${riskBadges[result.riskLevel] || result.riskLevel}`);
    lines.push(
      `> **Total Affected Dependents:** ${result.totalAffected} module(s) across ${result.domainsAffected.length} domain(s) (Max Depth: ${result.maxDepth})`,
    );
    lines.push('');

    if (result.domainsAffected.length > 0) {
      lines.push(`**Impacted Architectural Domains:** \`${result.domainsAffected.join('`, `')}\``);
      lines.push('');
    }

    if (result.affectedModules.length === 0) {
      lines.push(
        '✓ **Zero downstream dependents affected.** Modifying this leaf module poses no cascade regression risk.',
      );
      lines.push('');
    } else {
      lines.push('## Downstream Affected Callers & Dependents');
      lines.push('| Depth | Module / Symbol | Kind | Domain | Phase | Status Flag |');
      lines.push('| ----- | --------------- | ---- | ------ | ----- | ----------- |');
      for (const mod of result.affectedModules) {
        const flag =
          mod.statusFlag && mod.statusFlag !== 'clean' ? `⚠️ \`${mod.statusFlag}\`` : '`clean`';
        lines.push(
          `| ${mod.depth} | \`${mod.filePath}\` | \`${mod.kind}\` | ${mod.domain || '-'} | \`[${(mod.phase || 'unknown').toUpperCase()}]\` | ${flag} |`,
        );
      }
      lines.push('');
    }

    if (result.staleRiskSidecars.length > 0) {
      lines.push('## ⚠️ Pre-Existing Risk & Stale Sidecars in Blast Radius');
      lines.push(
        'The following downstream modules already have pending drift or unresolved flags:',
      );
      for (const s of result.staleRiskSidecars) {
        lines.push(`- \`${s}\``);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}

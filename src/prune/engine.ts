import { promises as fs } from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { GraphEngine, normalizePosixPath } from '../graph/engine';
import { parseOkfSpec } from '../parser/okf';
import { extractExportedSymbolNames } from '../parser/ast';
import { FileStorageDriver, NodeFileSystem } from '../storage';
import { loadConfig } from '../config/schema';

export type PruneIssueType =
  'PHANTOM_SIDECAR' | 'UNTRACKED_CODE' | 'ZOMBIE_EXPORT' | 'STALE_DB_NODE';

export interface PruneIssue {
  type: PruneIssueType;
  filePath: string;
  symbolName?: string;
  description: string;
  recommendation: string;
}

export interface PruneAuditSummary {
  phantomSidecars: number;
  untrackedCodeFiles: number;
  zombieExports: number;
  staleDbNodes: number;
  totalIssues: number;
  isClean: boolean;
}

export interface PruneAuditResult {
  summary: PruneAuditSummary;
  issues: PruneIssue[];
  generatedAt: string;
}

export interface PruneOptions {
  includeZombies?: boolean;
  fix?: boolean;
  configPath?: string;
  specsDir?: string;
}

export interface PruneFixResult {
  staleNodesRemoved: number;
  message: string;
}

export class PruneEngine {
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

  /**
   * Recursively discovers all files in a directory.
   */
  private async scanFiles(dir: string): Promise<string[]> {
    const results: string[] = [];
    if (!(await this.fsDriver.exists(dir))) return results;

    const entries = await this.fsDriver.readDir(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        if (entry !== 'node_modules' && entry !== '.git' && entry !== 'dist') {
          const sub = await this.scanFiles(fullPath);
          results.push(...sub);
        }
      } else if (stat.isFile()) {
        results.push(normalizePosixPath(fullPath));
      }
    }
    return results;
  }

  /**
   * Audits the workspace for phantom sidecars, untracked code, zombie exports, and stale database records.
   */
  public async auditWorkspace(options: PruneOptions = {}): Promise<PruneAuditResult> {
    await this.graphEngine.initialize();
    const config = loadConfig(options.configPath);
    const specsDir = options.specsDir || config.paths?.specs_dir || 'src';

    const physicalFiles = await this.scanFiles(specsDir);
    const issues: PruneIssue[] = [];

    const sidecarFiles = physicalFiles.filter(
      (f) => f.endsWith('.ts.md') || (f.endsWith('.md') && f !== 'src/INDEX.md'),
    );
    const codeFiles = physicalFiles.filter(
      (f) =>
        f.endsWith('.ts') &&
        !f.endsWith('.d.ts') &&
        !f.endsWith('.test.ts') &&
        !f.endsWith('.spec.ts'),
    );

    // 1. Check for Phantom Sidecars (sidecar points to non-existent target_code_file)
    for (const sidecar of sidecarFiles) {
      try {
        const content = await this.fsDriver.readFile(sidecar);
        const parsed = parseOkfSpec(content);
        let targetFile = parsed.frontmatter?.target_code_file;

        if (!targetFile) {
          const match = content.match(/^---\n([\s\S]*?)\n---/);
          if (match) {
            try {
              const rawYaml: any = yaml.load(match[1]);
              targetFile = rawYaml?.target_code_file;
            } catch {
              // Ignore
            }
          }
        }

        if (!targetFile && sidecar.endsWith('.ts.md')) {
          targetFile = './' + path.basename(sidecar, '.md');
        }

        if (targetFile) {
          const sidecarDir = path.dirname(sidecar);
          const resolvedCodePath = normalizePosixPath(path.resolve(sidecarDir, targetFile));
          const relCodePath = normalizePosixPath(path.relative(process.cwd(), resolvedCodePath));

          const exists =
            (await this.fsDriver.exists(resolvedCodePath)) ||
            (await this.fsDriver.exists(relCodePath));

          if (!exists) {
            issues.push({
              type: 'PHANTOM_SIDECAR',
              filePath: sidecar,
              description: `Sidecar points to missing code file "${targetFile}"`,
              recommendation: `Materialize implementation or remove orphaned sidecar ${sidecar}`,
            });
          }
        }
      } catch {
        // Skip unparseable sidecars
      }
    }

    // 2. Check for Untracked Code Files (code file exists without paired sidecar)
    const ignoredCodeFiles = new Set(['src/shims.ts', 'src/INDEX.ts']);
    for (const code of codeFiles) {
      if (ignoredCodeFiles.has(code)) continue;

      const pairedSidecar = `${code}.md`;
      const exists = await this.fsDriver.exists(pairedSidecar);

      if (!exists) {
        issues.push({
          type: 'UNTRACKED_CODE',
          filePath: code,
          description: `Source code file has no paired specification sidecar "${pairedSidecar}"`,
          recommendation: `Scaffold sidecar using "stubs concept scaffold" or "stubs sand ${code}"`,
        });
      }
    }

    // 3. Check for Stale Database Graph Nodes
    const dbNodes = await this.graphEngine.getGraphNodes();
    for (const node of dbNodes) {
      if (node.kind === 'file' || node.kind === 'sidecar') {
        const exists = await this.fsDriver.exists(node.file_path);
        if (!exists) {
          issues.push({
            type: 'STALE_DB_NODE',
            filePath: node.file_path,
            symbolName: node.symbol_name || undefined,
            description: `Graph database indexes node for deleted physical file "${node.file_path}"`,
            recommendation: `Run "stubs prune --fix" to clean stale graph entries`,
          });
        }
      }
    }

    // 4. Check for Zombie Exports (if enabled)
    if (options.includeZombies) {
      const edges = await this.graphEngine.getGraphEdges();
      const inDegreeMap = new Map<string, number>();

      for (const edge of edges) {
        inDegreeMap.set(edge.target_id, (inDegreeMap.get(edge.target_id) || 0) + 1);
      }

      // Check exported symbols
      const entrypointFiles = new Set(['src/index.ts', 'src/cli.ts', 'src/cli/router.ts']);
      for (const node of dbNodes) {
        if (node.symbol_name && node.kind !== 'file' && node.kind !== 'sidecar') {
          if (entrypointFiles.has(node.file_path)) continue;

          const inDegree = inDegreeMap.get(node.id) || inDegreeMap.get(node.file_path) || 0;
          if (inDegree === 0) {
            issues.push({
              type: 'ZOMBIE_EXPORT',
              filePath: node.file_path,
              symbolName: node.symbol_name,
              description: `Exported symbol "${node.symbol_name}" in ${node.file_path} is never imported or called across the codebase`,
              recommendation: `Unexport or remove dead symbol if unused outside the workspace`,
            });
          }
        }
      }
    }

    const summary: PruneAuditSummary = {
      phantomSidecars: issues.filter((i) => i.type === 'PHANTOM_SIDECAR').length,
      untrackedCodeFiles: issues.filter((i) => i.type === 'UNTRACKED_CODE').length,
      zombieExports: issues.filter((i) => i.type === 'ZOMBIE_EXPORT').length,
      staleDbNodes: issues.filter((i) => i.type === 'STALE_DB_NODE').length,
      totalIssues: issues.length,
      isClean: issues.length === 0,
    };

    return {
      summary,
      issues,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Cleans up stale graph database nodes and phantom references.
   */
  public async fixOrphans(auditResult: PruneAuditResult): Promise<PruneFixResult> {
    await this.graphEngine.initialize();
    let staleCount = 0;

    for (const issue of auditResult.issues) {
      if (issue.type === 'STALE_DB_NODE') {
        await this.graphEngine.deleteGraphNodesForFile(issue.filePath);
        await this.graphEngine.deleteSidecar(issue.filePath);
        staleCount++;
      }
    }

    return {
      staleNodesRemoved: staleCount,
      message: `Cleaned up ${staleCount} stale graph database records.`,
    };
  }

  /**
   * Renders a human-readable markdown report of the pruning audit.
   */
  public renderMarkdown(result: PruneAuditResult): string {
    const lines: string[] = [];
    lines.push('# Architectural Dead Code & Orphan Audit (`stubs prune`)');
    lines.push(
      `> **Status:** ${result.summary.isClean ? '🟢 CLEAN' : '🟡 ISSUES DETECTED'} (${result.summary.totalIssues} issues found)`,
    );
    lines.push('');

    lines.push('## Audit Summary');
    lines.push('| Category | Status | Count |');
    lines.push('| -------- | ------ | ----- |');
    lines.push(
      `| **Phantom Sidecars** | ${result.summary.phantomSidecars === 0 ? '✓ CLEAN' : '✗ FOUND'} | ${result.summary.phantomSidecars} |`,
    );
    lines.push(
      `| **Untracked Code Files** | ${result.summary.untrackedCodeFiles === 0 ? '✓ CLEAN' : '✗ FOUND'} | ${result.summary.untrackedCodeFiles} |`,
    );
    lines.push(
      `| **Zombie Exported Symbols** | ${result.summary.zombieExports === 0 ? '✓ CLEAN' : '✗ FOUND'} | ${result.summary.zombieExports} |`,
    );
    lines.push(
      `| **Stale Database Nodes** | ${result.summary.staleDbNodes === 0 ? '✓ CLEAN' : '✗ FOUND'} | ${result.summary.staleDbNodes} |`,
    );
    lines.push('');

    if (result.issues.length === 0) {
      lines.push(
        '✓ **No orphaned sidecars, untracked code files, or stale database entries found.**',
      );
    } else {
      lines.push('## Detected Issues');
      lines.push('');
      result.issues.forEach((issue, index) => {
        lines.push(
          `### ${index + 1}. [${issue.type}] \`${issue.filePath}\`${issue.symbolName ? ` (#${issue.symbolName})` : ''}`,
        );
        lines.push(`- **Problem:** ${issue.description}`);
        lines.push(`- **Action:** ${issue.recommendation}`);
        lines.push('');
      });
    }

    return lines.join('\n');
  }
}

import * as path from 'path';
import { GraphEngine, TieredNeighborhood, normalizePosixPath } from '../graph/engine';
import { parseOkfSpec, ParsedOkfSpec } from '../parser/okf';
import { extractDistilledSignatures, extractExportedSymbolNames } from '../parser/ast';
import { FileStorageDriver, NodeFileSystem } from '../storage';
import { loadConfig } from '../config/schema';

export interface ContextOptions {
  depth?: number;
  includeCode?: boolean;
  maxTokens?: number;
  configPath?: string;
}

export interface Tier0TargetContext {
  filePath: string;
  sidecarPath: string;
  codePath?: string;
  title: string;
  type: string;
  phase: string;
  status: string;
  statusFlag: string;
  description: string;
  decisions: Array<{ adrId: string; summary: string; date: string }>;
  contractsText?: string;
  sidecarContent?: string;
  sourceCode?: string;
}

export interface Tier1DependencyContext {
  filePath: string;
  sidecarPath?: string;
  codePath?: string;
  title?: string;
  description?: string;
  phase?: string;
  decisions: Array<{ adrId: string; summary: string; date: string }>;
  contractsText?: string;
  distilledSignatures?: string;
  exportedSymbols: string[];
}

export interface Tier1DependentContext {
  filePath: string;
  title?: string;
  phase?: string;
  status?: string;
  statusFlag?: string;
}

export interface Tier2BoundaryContext {
  filePath: string;
  title?: string;
  description?: string;
  exportedSymbols: string[];
}

export interface ContextPackage {
  target: Tier0TargetContext;
  tier1Dependencies: Tier1DependencyContext[];
  tier1Dependents: Tier1DependentContext[];
  tier2Boundary: Tier2BoundaryContext[];
  generatedAt: string;
}

export class ContextEngine {
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
   * Generates a tiered topological context package for a target file.
   */
  public async generateContextPackage(
    targetPath: string,
    options: ContextOptions = {},
  ): Promise<ContextPackage> {
    await this.graphEngine.initialize();

    let normalized = normalizePosixPath(targetPath);
    if (normalized.startsWith('./')) {
      normalized = normalized.substring(2);
    }

    const depth = options.depth !== undefined ? options.depth : 2;
    const includeCode = options.includeCode !== false;

    // Get neighborhood from graph
    const neighborhood = await this.graphEngine.getTieredNeighborhood(normalized, depth);

    // Resolve target paths
    let sidecarPath = normalized;
    let codePath = normalized;
    if (normalized.endsWith('.ts.md')) {
      codePath = normalized.replace(/\.md$/, '');
    } else if (normalized.endsWith('.ts')) {
      sidecarPath = `${normalized}.md`;
    }

    // Read Target Sidecar
    let sidecarContent = '';
    let parsedSidecar: ParsedOkfSpec | null = null;
    try {
      if (await this.fsDriver.exists(sidecarPath)) {
        sidecarContent = await this.fsDriver.readFile(sidecarPath);
        parsedSidecar = parseOkfSpec(sidecarContent);
      }
    } catch {
      // Graceful fallback
    }

    // Read Target Code
    let sourceCode = '';
    if (includeCode) {
      try {
        if (await this.fsDriver.exists(codePath)) {
          sourceCode = await this.fsDriver.readFile(codePath);
        }
      } catch {
        // Graceful fallback
      }
    }

    const targetSidecar = neighborhood.targetSidecar;
    const targetDecisions = targetSidecar?.decisions
      ? targetSidecar.decisions.map((d: any) => ({
          adrId: d.id || d.adr_id || d.adrId,
          summary: d.summary,
          date: d.date,
        }))
      : [];

    const tier0: Tier0TargetContext = {
      filePath: normalized,
      sidecarPath,
      codePath: sourceCode ? codePath : undefined,
      title: parsedSidecar?.frontmatter?.title || targetSidecar?.title || path.basename(normalized),
      type: parsedSidecar?.frontmatter?.type || targetSidecar?.type || 'module',
      phase: parsedSidecar?.frontmatter?.phase || targetSidecar?.phase || 'unknown',
      status: parsedSidecar?.frontmatter?.status || targetSidecar?.status || 'unknown',
      statusFlag: parsedSidecar?.frontmatter?.status_flag || targetSidecar?.status_flag || 'clean',
      description: parsedSidecar?.frontmatter?.description || targetSidecar?.description || '',
      decisions: targetDecisions,
      contractsText: targetSidecar?.interfaces_text || undefined,
      sidecarContent: sidecarContent || undefined,
      sourceCode: sourceCode || undefined,
    };

    // Build Tier 1 Dependencies
    const tier1Dependencies: Tier1DependencyContext[] = [];
    for (const dep of neighborhood.tier1Dependencies) {
      const depPath = dep.filePath;
      let depSidecarPath = depPath;
      let depCodePath = depPath;
      if (depPath.endsWith('.ts.md')) {
        depCodePath = depPath.replace(/\.md$/, '');
      } else if (depPath.endsWith('.ts')) {
        depSidecarPath = `${depPath}.md`;
      }

      let depCode = '';
      try {
        if (await this.fsDriver.exists(depCodePath)) {
          depCode = await this.fsDriver.readFile(depCodePath);
        }
      } catch {
        // Fallback
      }

      const distilled = depCode ? extractDistilledSignatures(depCode, depCodePath) : '';
      const symbols = depCode
        ? extractExportedSymbolNames(depCode, depCodePath)
        : dep.sidecar?.exports
          ? dep.sidecar.exports.map((e: any) => (typeof e === 'string' ? e : e.export_name))
          : [];

      const decisions = dep.sidecar?.decisions
        ? dep.sidecar.decisions.map((d: any) => ({
            adrId: d.id || d.adr_id || d.adrId,
            summary: d.summary,
            date: d.date,
          }))
        : [];

      tier1Dependencies.push({
        filePath: depPath,
        sidecarPath: depSidecarPath !== depPath ? depSidecarPath : undefined,
        codePath: depCodePath !== depPath ? depCodePath : undefined,
        title: dep.sidecar?.title,
        description: dep.sidecar?.description,
        phase: dep.sidecar?.phase,
        decisions,
        contractsText: dep.sidecar?.interfaces_text || undefined,
        distilledSignatures: distilled || undefined,
        exportedSymbols: symbols,
      });
    }

    // Build Tier 1 Dependents
    const tier1Dependents: Tier1DependentContext[] = neighborhood.tier1Dependents.map(
      (dep: { filePath: string; sidecar: any | null }) => ({
        filePath: dep.filePath,
        title: dep.sidecar?.title,
        phase: dep.sidecar?.phase,
        status: dep.sidecar?.status,
        statusFlag: dep.sidecar?.status_flag,
      }),
    );

    // Build Tier 2 Transitive Boundary
    const tier2Boundary: Tier2BoundaryContext[] = [];
    for (const t2 of neighborhood.tier2Dependencies) {
      const t2CodePath = t2.filePath.endsWith('.ts.md')
        ? t2.filePath.replace(/\.md$/, '')
        : t2.filePath;

      let symbols: string[] = [];
      try {
        if (await this.fsDriver.exists(t2CodePath)) {
          const t2Code = await this.fsDriver.readFile(t2CodePath);
          symbols = extractExportedSymbolNames(t2Code, t2CodePath);
        }
      } catch {
        // Ignore
      }

      if (symbols.length === 0 && t2.sidecar?.exports) {
        symbols = t2.sidecar.exports.map((e: any) => (typeof e === 'string' ? e : e.export_name));
      }

      tier2Boundary.push({
        filePath: t2.filePath,
        title: t2.sidecar?.title,
        description: t2.sidecar?.description,
        exportedSymbols: symbols,
      });
    }

    return {
      target: tier0,
      tier1Dependencies,
      tier1Dependents,
      tier2Boundary,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Formats a ContextPackage into token-dense, agent-friendly Markdown.
   */
  public renderMarkdown(pkg: ContextPackage): string {
    const lines: string[] = [];

    lines.push(`# Context Briefing: ${pkg.target.title}`);
    lines.push(
      `> **Target:** \`${pkg.target.filePath}\` | **Phase:** \`[${pkg.target.phase.toUpperCase()}]\` | **Status:** \`${pkg.target.status}\` (\`${pkg.target.statusFlag}\`)`,
    );
    if (pkg.target.description) {
      lines.push(`> **Description:** ${pkg.target.description}`);
    }
    lines.push('');

    // Section 1: Target Module
    lines.push('## 1. Target Module (Full Specification & Implementation)');
    if (pkg.target.sidecarContent) {
      lines.push('### Sidecar Specification');
      lines.push('```markdown');
      lines.push(pkg.target.sidecarContent.trim());
      lines.push('```');
      lines.push('');
    }

    if (pkg.target.sourceCode) {
      lines.push('### Active Implementation Code');
      lines.push('```typescript');
      lines.push(pkg.target.sourceCode.trim());
      lines.push('```');
      lines.push('');
    }

    // Section 2: Direct Dependencies (Tier 1)
    lines.push('## 2. Direct Dependencies (Contracts, ADRs & Export Signatures)');
    if (pkg.tier1Dependencies.length === 0) {
      lines.push('*No direct dependencies detected in graph.*');
      lines.push('');
    } else {
      for (const dep of pkg.tier1Dependencies) {
        lines.push(`### \`${dep.filePath}\`${dep.title ? ` — ${dep.title}` : ''}`);
        if (dep.phase) {
          lines.push(`- **Phase:** \`[${dep.phase.toUpperCase()}]\``);
        }
        if (dep.description) {
          lines.push(`- **Purpose:** ${dep.description}`);
        }
        if (dep.decisions.length > 0) {
          lines.push('- **Architectural Decisions (ADRs):**');
          for (const adr of dep.decisions) {
            lines.push(`  - **${adr.adrId}:** ${adr.summary}`);
          }
        }
        if (dep.contractsText) {
          lines.push('- **Interface Contracts:**');
          lines.push(dep.contractsText.trim());
        }
        if (dep.distilledSignatures) {
          lines.push('```typescript');
          lines.push('// Distilled Public Signatures (Implementation stripped)');
          lines.push(dep.distilledSignatures.trim());
          lines.push('```');
        } else if (dep.exportedSymbols.length > 0) {
          lines.push(`- **Exported Symbols:** \`${dep.exportedSymbols.join('`, `')}\``);
        }
        lines.push('');
      }
    }

    // Section 3: Direct Dependents (Callers)
    lines.push('## 3. Direct Dependents (Upstream Callers & Consumers)');
    if (pkg.tier1Dependents.length === 0) {
      lines.push('*No upstream dependents currently reference this module.*');
      lines.push('');
    } else {
      lines.push('| Dependent Module | Title | Phase | Status |');
      lines.push('| ---------------- | ----- | ----- | ------ |');
      for (const caller of pkg.tier1Dependents) {
        lines.push(
          `| \`${caller.filePath}\` | ${caller.title || '-'} | \`[${(caller.phase || 'unknown').toUpperCase()}]\` | \`${caller.statusFlag || 'clean'}\` |`,
        );
      }
      lines.push('');
    }

    // Section 4: 2-Hop Transitive Boundary
    if (pkg.tier2Boundary.length > 0) {
      lines.push('## 4. Transitive Boundary Symbols (2-Hop Neighborhood)');
      lines.push('| Module | Symbols | Description |');
      lines.push('| ------ | ------- | ----------- |');
      for (const t2 of pkg.tier2Boundary) {
        const symList =
          t2.exportedSymbols.length > 0
            ? `\`${t2.exportedSymbols.slice(0, 5).join('`, `')}\`${t2.exportedSymbols.length > 5 ? ` (+${t2.exportedSymbols.length - 5} more)` : ''}`
            : '-';
        lines.push(`| \`${t2.filePath}\` | ${symList} | ${t2.description || t2.title || '-'} |`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}

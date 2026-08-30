import { GraphEngine, normalizePosixPath } from '../graph/engine';
import { TopologyEngine } from '../graph/topology';
import { FileStorageDriver, NodeFileSystem } from '../storage';
import { loadConfig } from '../config/schema';

export type ArchRuleType =
  'LAYER_VIOLATION' | 'CIRCULAR_DEPENDENCY' | 'UNMANIFESTED_DEPENDENCY' | 'DOMAIN_LEAK';

export interface ArchViolation {
  rule: ArchRuleType;
  severity: 'ERROR' | 'WARNING';
  sourceFile: string;
  targetFile?: string;
  sourceLayer?: number;
  targetLayer?: number;
  message: string;
  recommendation: string;
}

export interface ArchLintOptions {
  strict?: boolean;
  rules?: ArchRuleType[];
  configPath?: string;
}

export interface ArchLintSummary {
  totalFilesChecked: number;
  totalDependenciesChecked: number;
  layerViolations: number;
  circularCycles: number;
  unmanifestedDependencies: number;
  domainLeaks: number;
  totalViolations: number;
  passed: boolean;
}

export interface ArchLintResult {
  summary: ArchLintSummary;
  violations: ArchViolation[];
  generatedAt: string;
}

// Canonical Architectural Layer Mapping
export const LAYER_DEFINITIONS: Record<string, { layer: number; name: string }> = {
  config: { layer: 0, name: '0 — Foundation' },
  storage: { layer: 1, name: '1 — Storage' },
  parser: { layer: 2, name: '2 — Parser' },
  compiler: { layer: 3, name: '3 — Compiler' },
  graph: { layer: 4, name: '4 — Graph' },
  grill: { layer: 5, name: '5 — Engines' },
  materializer: { layer: 5, name: '5 — Engines' },
  sanding: { layer: 5, name: '5 — Engines' },
  autonomy: { layer: 5, name: '5 — Engines' },
  templates: { layer: 5, name: '5 — Engines' },
  concept: { layer: 5, name: '5 — Engines' },
  phase: { layer: 5, name: '5 — Engines' },
  context: { layer: 5, name: '5 — Engines' },
  impact: { layer: 5, name: '5 — Engines' },
  lint: { layer: 5, name: '5 — Engines' },
  mock: { layer: 5, name: '5 — Engines' },
  diagram: { layer: 5, name: '5 — Engines' },
  prune: { layer: 5, name: '5 — Engines' },
  changelog: { layer: 5, name: '5 — Engines' },
  cli: { layer: 6, name: '6 — Interface' },
  server: { layer: 6, name: '6 — Interface' },
  web: { layer: 6, name: '6 — Interface' },
};

export function getModuleLayer(filePath: string): { layer: number; name: string; domain: string } {
  const normalized = normalizePosixPath(filePath);
  const parts = normalized.split('/');

  let domain = 'unknown';
  if (parts.length > 1 && parts[0] === 'src') {
    domain = parts[1].replace(/\.(ts|js|md)$/, '');
  } else if (parts.length === 1 || (parts.length === 2 && parts[0] === 'src')) {
    const filename = parts[parts.length - 1];
    if (filename.startsWith('cli.')) domain = 'cli';
    else if (filename.startsWith('index.')) domain = 'cli';
  }

  const def = LAYER_DEFINITIONS[domain];
  if (def) {
    return { layer: def.layer, name: def.name, domain };
  }

  // Default interface tier for entry points or unknown top-level modules
  return { layer: 6, name: '6 — Interface / Root', domain };
}

export class ArchLintEngine {
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
   * Lints the entire workspace against architectural rules and invariants.
   */
  public async lintWorkspace(options: ArchLintOptions = {}): Promise<ArchLintResult> {
    await this.graphEngine.initialize();

    const violations: ArchViolation[] = [];
    const enabledRules = options.rules || [
      'LAYER_VIOLATION',
      'CIRCULAR_DEPENDENCY',
      'UNMANIFESTED_DEPENDENCY',
      'DOMAIN_LEAK',
    ];

    // Ensure graph has indexed nodes and sidecars
    const config = loadConfig(options.configPath);
    let existingNodes = await this.graphEngine.getGraphNodes();
    if (existingNodes.length === 0) {
      await this.graphEngine.indexCodeWorkspace(config.paths?.specs_dir || 'src');
      existingNodes = await this.graphEngine.getGraphNodes();
    }

    let indexedFiles = await this.graphEngine.getFilesIndexed();
    if (indexedFiles.length === 0) {
      await this.graphEngine.indexWorkspace(config.paths?.specs_dir || 'src');
      indexedFiles = await this.graphEngine.getFilesIndexed();
    }

    const allEdges = await this.graphEngine.getGraphEdges();

    // Pre-index nodes & edges for O(1) linter lookups
    const nodeMap = new Map<string, (typeof existingNodes)[0]>();
    for (const node of existingNodes) {
      nodeMap.set(node.id, node);
      if (!nodeMap.has(node.file_path)) {
        nodeMap.set(node.file_path, node);
      }
    }

    const codeEdgesBySource = new Map<string, typeof allEdges>();
    for (const edge of allEdges) {
      if (edge.relation === 'imports' || edge.relation === 'calls') {
        const srcPrefix = edge.source_id.split('#')[0];
        if (!codeEdgesBySource.has(srcPrefix)) codeEdgesBySource.set(srcPrefix, []);
        codeEdgesBySource.get(srcPrefix)!.push(edge);
      }
    }

    // Lazily load topology engine once if needed by rules
    let topologyEngine: TopologyEngine | null = null;
    const getTopology = async (): Promise<TopologyEngine> => {
      if (!topologyEngine) {
        topologyEngine = new TopologyEngine(existingNodes, allEdges);
      }
      return topologyEngine;
    };

    // 1. Check Layer Invariants
    if (enabledRules.includes('LAYER_VIOLATION')) {
      for (const edge of allEdges) {
        if (edge.relation !== 'imports' && edge.relation !== 'depends_on') {
          continue;
        }

        const srcNode = nodeMap.get(edge.source_id);
        const tgtNode = nodeMap.get(edge.target_id);

        if (!srcNode || !tgtNode) continue;

        const srcLayer = getModuleLayer(srcNode.file_path);
        const tgtLayer = getModuleLayer(tgtNode.file_path);

        // Disallow lower-layer modules importing from higher-layer modules
        // Exception: modules within same layer can import each other
        if (srcLayer.layer < tgtLayer.layer) {
          violations.push({
            rule: 'LAYER_VIOLATION',
            severity: 'ERROR',
            sourceFile: srcNode.file_path,
            targetFile: tgtNode.file_path,
            sourceLayer: srcLayer.layer,
            targetLayer: tgtLayer.layer,
            message: `Layer inversion: [${srcLayer.name}] "${srcNode.file_path}" imports from higher tier [${tgtLayer.name}] "${tgtNode.file_path}".`,
            recommendation: `Refactor "${srcNode.file_path}" to depend only on lower architectural layers (Layer <= ${srcLayer.layer}) or pull common abstractions downward.`,
          });
        }
      }
    }

    // 2. Check Circular Dependencies
    if (enabledRules.includes('CIRCULAR_DEPENDENCY')) {
      const topology = await getTopology();
      const smells = topology.detectSmells();

      for (const cycle of smells.cycles) {
        if (cycle.cycleLength < 2) continue; // Ignore self-references or sidecar-to-target links
        violations.push({
          rule: 'CIRCULAR_DEPENDENCY',
          severity: 'ERROR',
          sourceFile: cycle.nodes[0] || 'unknown',
          message: `Circular dependency cycle of length ${cycle.cycleLength} detected: ${cycle.nodes.join(' -> ')} -> ${cycle.nodes[0]}`,
          recommendation:
            'Break the cyclic import chain by extracting shared types/interfaces to a lower foundation layer.',
        });
      }
    }

    // 3. Check Sidecar Manifest Parity (depends_on frontmatter vs actual code imports)
    if (enabledRules.includes('UNMANIFESTED_DEPENDENCY')) {
      for (const filePath of indexedFiles) {
        if (!filePath.endsWith('.ts.md')) continue;

        const sidecar = await this.graphEngine.getSidecar(filePath);
        if (!sidecar) continue;

        const codePath = filePath.replace(/\.md$/, '');
        if (await this.fsDriver.exists(codePath)) {
          const codeEdges = codeEdgesBySource.get(codePath) || [];
          const declaredDeps = (sidecar.depends_on || []).map((d: string) => normalizePosixPath(d));

          for (const edge of codeEdges) {
            const tgtNode = nodeMap.get(edge.target_id);
            if (!tgtNode) continue;

            const targetFilePath = normalizePosixPath(tgtNode.file_path);
            const targetSidecarPath = targetFilePath.endsWith('.ts')
              ? `${targetFilePath}.md`
              : targetFilePath;

            // Ignore self-imports or external libraries
            if (
              targetFilePath === normalizePosixPath(codePath) ||
              !targetFilePath.startsWith('src/')
            ) {
              continue;
            }

            const isDeclared = declaredDeps.some(
              (d: string) =>
                d === targetFilePath || d === targetSidecarPath || targetFilePath.includes(d),
            );

            if (!isDeclared) {
              violations.push({
                rule: 'UNMANIFESTED_DEPENDENCY',
                severity: options.strict ? 'ERROR' : 'WARNING',
                sourceFile: filePath,
                targetFile: targetFilePath,
                message: `Sidecar "${filePath}" does not list code import "${targetFilePath}" in its "depends_on" frontmatter.`,
                recommendation: `Run "stubs sand ${filePath}" to auto-heal depends_on frontmatter, or manually add "${targetSidecarPath}" to depends_on.`,
              });
            }
          }
        }
      }
    }

    // 4. Check Domain Leaks
    if (enabledRules.includes('DOMAIN_LEAK')) {
      const topology = await getTopology();
      const smells = topology.detectSmells();

      for (const leak of smells.domainLeaks) {
        violations.push({
          rule: 'DOMAIN_LEAK',
          severity: 'WARNING',
          sourceFile: leak.sourceId,
          targetFile: leak.targetId,
          message: `Domain boundary leak: "${leak.sourceDomain}" directly accesses internal symbol "${leak.targetId}" in domain "${leak.targetDomain}".`,
          recommendation: `Route calls to domain "${leak.targetDomain}" through its public subsystem index or module interface instead of direct private internals.`,
        });
      }
    }

    const layerViolations = violations.filter((v) => v.rule === 'LAYER_VIOLATION').length;
    const circularCycles = violations.filter((v) => v.rule === 'CIRCULAR_DEPENDENCY').length;
    const unmanifested = violations.filter((v) => v.rule === 'UNMANIFESTED_DEPENDENCY').length;
    const domainLeaks = violations.filter((v) => v.rule === 'DOMAIN_LEAK').length;

    const errorCount = violations.filter((v) => v.severity === 'ERROR').length;
    const passed = errorCount === 0;

    return {
      summary: {
        totalFilesChecked: indexedFiles.length,
        totalDependenciesChecked: allEdges.length,
        layerViolations,
        circularCycles,
        unmanifestedDependencies: unmanifested,
        domainLeaks,
        totalViolations: violations.length,
        passed,
      },
      violations,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Renders the lint result into structured Markdown.
   */
  public renderMarkdown(result: ArchLintResult): string {
    const lines: string[] = [];

    lines.push('# Architectural Lint Report (`stubs lint-arch`)');
    const statusBadge = result.summary.passed
      ? '🟢 PASSED (0 Blocking Violations)'
      : '🔴 FAILED (Architectural Invariants Breached)';
    lines.push(`> **Status:** ${statusBadge}`);
    lines.push(
      `> **Metrics:** ${result.summary.totalFilesChecked} files & ${result.summary.totalDependenciesChecked} relations inspected.`,
    );
    lines.push('');

    // Summary Table
    lines.push('## Rule Checklist');
    lines.push('| Rule Name | Status | Violations Count |');
    lines.push('| --------- | ------ | ---------------- |');
    lines.push(
      `| **Downward Layer Hierarchy** | ${result.summary.layerViolations === 0 ? '✓ CLEAN' : '✗ FAILED'} | ${result.summary.layerViolations} |`,
    );
    lines.push(
      `| **Circular Dependency Ban** | ${result.summary.circularCycles === 0 ? '✓ CLEAN' : '✗ FAILED'} | ${result.summary.circularCycles} |`,
    );
    lines.push(
      `| **Sidecar Manifest Parity** | ${result.summary.unmanifestedDependencies === 0 ? '✓ CLEAN' : '⚠️ WARNING'} | ${result.summary.unmanifestedDependencies} |`,
    );
    lines.push(
      `| **Domain Encapsulation** | ${result.summary.domainLeaks === 0 ? '✓ CLEAN' : '⚠️ WARNING'} | ${result.summary.domainLeaks} |`,
    );
    lines.push('');

    if (result.violations.length === 0) {
      lines.push('✓ **All architectural rules and layer invariants are strictly satisfied.**');
      lines.push('');
      return lines.join('\n');
    }

    lines.push('## Detected Violations');
    lines.push('');

    for (let i = 0; i < result.violations.length; i++) {
      const v = result.violations[i];
      const badge = v.severity === 'ERROR' ? '🔴 ERROR' : '🟡 WARNING';
      lines.push(`### ${i + 1}. [${badge}] \`${v.rule}\``);
      lines.push(`- **Source:** \`${v.sourceFile}\``);
      if (v.targetFile) {
        lines.push(`- **Target:** \`${v.targetFile}\``);
      }
      lines.push(`- **Message:** ${v.message}`);
      lines.push(`- **Fix:** ${v.recommendation}`);
      lines.push('');
    }

    return lines.join('\n');
  }
}

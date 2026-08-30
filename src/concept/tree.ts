import * as path from 'path';
import { GraphEngine, normalizePosixPath, PlannedFileRow } from '../graph/engine';
import { FileStorageDriver, NodeFileSystem } from '../storage';
import { extractFileTreeBlocks, parseFileTreeEntries } from '../parser/okf';

export interface VisualTreeOptions {
  rootDir?: string;
  includePlanned?: boolean;
  plannedOnly?: boolean;
  showStatus?: boolean;
  showGraph?: boolean;
  maxDepth?: number;
  ignorePatterns?: string[];
}

interface TreeNode {
  name: string;
  fullPath: string;
  isDir: boolean;
  isPlanned?: boolean;
  existsOnDisk?: boolean;
  phase?: string;
  status?: string;
  statusFlag?: string;
  description?: string;
  graphDegree?: {
    inDegree: number;
    outDegree: number;
    isHub: boolean;
  };
  children: Map<string, TreeNode>;
}

export class TreeEngine {
  private fsDriver: FileStorageDriver;
  private graphEngine?: GraphEngine;

  constructor(options: { fsDriver?: FileStorageDriver; graphEngine?: GraphEngine } = {}) {
    this.fsDriver = options.fsDriver || new NodeFileSystem();
    this.graphEngine = options.graphEngine;
  }

  /**
   * Generates a formatted ASCII/Unicode visual file tree with optional planned file annotations and phase status badges.
   */
  public async generateVisualTree(options: VisualTreeOptions = {}): Promise<string> {
    const rootDir = options.rootDir ? normalizePosixPath(options.rootDir) : '.';
    const includePlanned = options.includePlanned !== undefined ? options.includePlanned : true;
    const plannedOnly = options.plannedOnly || false;
    const showStatus = options.showStatus !== undefined ? options.showStatus : true;
    const maxDepth = options.maxDepth || 10;
    const ignorePatterns = options.ignorePatterns || [
      'node_modules',
      '.git',
      '.stubs',
      'dist',
      'build',
      '.DS_Store',
    ];

    const rootNode: TreeNode = {
      name: rootDir === '.' ? path.basename(process.cwd()) : path.basename(rootDir),
      fullPath: rootDir,
      isDir: true,
      existsOnDisk: true,
      children: new Map(),
    };

    // 1. Scan physical disk
    if (!plannedOnly) {
      await this.scanDisk(rootDir, rootNode, 0, maxDepth, ignorePatterns);
    }

    // 2. Fetch or scan planned files
    if (includePlanned || plannedOnly) {
      await this.integratePlannedFiles(rootDir, rootNode);
    }

    // 3. Annotate with GraphEngine metadata if available
    if (this.graphEngine && (showStatus || options.showGraph)) {
      let centralities: Map<string, any> | undefined;
      if (options.showGraph) {
        try {
          const topo = await this.graphEngine.getTopologyEngine();
          centralities = topo.getNodeCentralities();
        } catch {
          // Ignore graph centrality load errors
        }
      }

      let indexedFiles: string[] = [];
      const sidecarLookup = new Map<string, any>();
      try {
        const allSidecars = await this.graphEngine.getAllSidecars();
        indexedFiles = allSidecars.map((s) => s.filePath);
        for (const sidecar of allSidecars) {
          sidecarLookup.set(sidecar.filePath, sidecar);
          if (sidecar.targetCodeFile || sidecar.target_code_file) {
            sidecarLookup.set(
              normalizePosixPath(sidecar.targetCodeFile || sidecar.target_code_file),
              sidecar,
            );
          }
          sidecarLookup.set(sidecar.filePath.replace(/\.md$/, ''), sidecar);
        }
      } catch {
        // Ignore pre-fetch error
      }

      await this.annotateMetadata(rootNode, centralities, sidecarLookup, indexedFiles);
    }

    // 4. Render to string
    const lines: string[] = [];
    lines.push(rootNode.name + '/');
    this.renderNode(rootNode, '', lines, showStatus, options.showGraph || false, true);

    return lines.join('\n');
  }

  private async scanDisk(
    currentDir: string,
    parentNode: TreeNode,
    currentDepth: number,
    maxDepth: number,
    ignorePatterns: string[],
  ): Promise<void> {
    if (currentDepth >= maxDepth) return;

    try {
      const entries = await this.fsDriver.readDir(currentDir);
      entries.sort((a, b) => a.localeCompare(b));

      for (const entry of entries) {
        if (ignorePatterns.includes(entry)) continue;

        const fullPath = currentDir === '.' ? entry : `${currentDir}/${entry}`;
        const normalized = normalizePosixPath(fullPath);

        let isDir = false;
        try {
          const sub = await this.fsDriver.readDir(normalized);
          if (sub) isDir = true;
        } catch {
          isDir = false;
        }

        const node: TreeNode = {
          name: entry,
          fullPath: normalized,
          isDir,
          existsOnDisk: true,
          children: new Map(),
        };

        parentNode.children.set(entry, node);

        if (isDir) {
          await this.scanDisk(normalized, node, currentDepth + 1, maxDepth, ignorePatterns);
        }
      }
    } catch {
      // Ignore directory scan error
    }
  }

  private async integratePlannedFiles(rootDir: string, rootNode: TreeNode): Promise<void> {
    let planned: PlannedFileRow[] = [];
    if (this.graphEngine) {
      try {
        planned = await this.graphEngine.getPlannedFiles();
      } catch {
        // Fallback to scanning concept docs directly
      }
    }

    // If no planned files found in database, scan concept docs directly
    if (planned.length === 0) {
      const conceptDir = 'knowledge/planning';
      const exists = await this.fsDriver.exists(conceptDir);
      if (exists) {
        try {
          const files = await this.fsDriver.readDir(conceptDir);
          for (const file of files) {
            if (file.endsWith('.md')) {
              const f = `${conceptDir}/${file}`;
              try {
                const content = await this.fsDriver.readFile(f);
                const trees = extractFileTreeBlocks(content);
                for (const t of trees) {
                  const entries = parseFileTreeEntries(t);
                  for (const entry of entries) {
                    planned.push({
                      id: `manual-${entry.path}`,
                      source_doc: f,
                      path: entry.path,
                      type: entry.type,
                      description: entry.description || null,
                      status: 'planned',
                    });
                  }
                }
              } catch {
                // Ignore file read error
              }
            }
          }
        } catch {
          // Ignore directory read error
        }
      }
    }

    for (const item of planned) {
      let relPath = item.path;
      if (rootDir !== '.' && relPath.startsWith(rootDir + '/')) {
        relPath = relPath.substring(rootDir.length + 1);
      } else if (rootDir !== '.' && relPath === rootDir) {
        continue;
      }

      const parts = relPath.split('/').filter(Boolean);
      let curr = rootNode;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLast = i === parts.length - 1;
        const isDir = isLast ? item.type === 'dir' : true;

        if (!curr.children.has(part)) {
          const nodePath = curr.fullPath === '.' ? part : `${curr.fullPath}/${part}`;
          const exists = await this.fsDriver.exists(nodePath);
          const newNode: TreeNode = {
            name: part,
            fullPath: nodePath,
            isDir,
            isPlanned: !exists,
            existsOnDisk: exists,
            description: isLast ? item.description || undefined : undefined,
            children: new Map(),
          };
          curr.children.set(part, newNode);
        } else {
          const existing = curr.children.get(part)!;
          if (isLast && item.description && !existing.description) {
            existing.description = item.description;
          }
        }
        curr = curr.children.get(part)!;
      }
    }
  }

  private async annotateMetadata(
    node: TreeNode,
    centralities?: Map<string, any>,
    sidecarLookup?: Map<string, any>,
    indexedFiles?: string[],
  ): Promise<void> {
    if (!this.graphEngine) return;

    if (!node.isDir) {
      try {
        let sidecar = sidecarLookup?.get(node.fullPath);
        if (!sidecar && indexedFiles) {
          const match = indexedFiles.find(
            (f) =>
              f === node.fullPath ||
              f.endsWith('/' + node.fullPath) ||
              node.fullPath.endsWith('/' + f) ||
              path.basename(f) === path.basename(node.fullPath),
          );
          if (match) {
            sidecar = sidecarLookup?.get(match);
          }
        }
        if (sidecar) {
          node.phase = sidecar.phase || sidecar.frontmatter?.phase || 'spec';
          node.status = sidecar.status || sidecar.frontmatter?.status;
          node.statusFlag =
            sidecar.statusFlag || sidecar.status_flag || sidecar.frontmatter?.status_flag;
        }

        if (centralities) {
          const norm = normalizePosixPath(node.fullPath);
          const c = centralities.get(norm);
          if (c) {
            node.graphDegree = {
              inDegree: c.inDegree,
              outDegree: c.outDegree,
              isHub: c.isHub,
            };
          }
        }
      } catch {
        // Ignore metadata fetch error
      }
    }

    for (const child of node.children.values()) {
      await this.annotateMetadata(child, centralities, sidecarLookup, indexedFiles);
    }
  }

  private renderNode(
    node: TreeNode,
    prefix: string,
    lines: string[],
    showStatus: boolean,
    showGraph: boolean,
    _isRoot: boolean = false,
  ): void {
    const children = Array.from(node.children.values());
    // Sort directories first, then files alphabetically
    children.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });

    children.forEach((child, index) => {
      const isLast = index === children.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const subPrefix = isLast ? '    ' : '│   ';

      let line = `${prefix}${connector}${child.name}${child.isDir ? '/' : ''}`;

      if (showGraph && child.graphDegree) {
        const hubMarker = child.graphDegree.isHub ? ' 🔥 (Hub)' : '';
        line += `  [In: ${child.graphDegree.inDegree} | Out: ${child.graphDegree.outDegree}]${hubMarker}`;
      }

      if (showStatus) {
        if (child.isPlanned && !child.existsOnDisk) {
          line += '  [PLANNED]';
        } else if (child.phase) {
          line += `  [${child.phase.toUpperCase()}${child.statusFlag ? ` · ${child.statusFlag}` : ''}]`;
        }
        if (child.description) {
          line += `  # ${child.description}`;
        }
      }

      lines.push(line);

      if (child.isDir) {
        this.renderNode(child, prefix + subPrefix, lines, showStatus, showGraph, false);
      }
    });
  }
}

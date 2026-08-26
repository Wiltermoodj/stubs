import * as path from 'path';
import { GraphEngine, normalizePosixPath } from '../graph/engine';
import { FileStorageDriver, NodeFileSystem } from '../storage';
import { extractFileTreeBlocks, parseFileTreeEntries } from '../parser/okf';

export interface VisualTreeOptions {
  rootDir?: string;
  includePlanned?: boolean;
  plannedOnly?: boolean;
  showStatus?: boolean;
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
    if (this.graphEngine && showStatus) {
      await this.annotateMetadata(rootNode);
    }

    // 4. Render to string
    const lines: string[] = [];
    lines.push(rootNode.name + '/');
    this.renderNode(rootNode, '', lines, showStatus, true);

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

    let entries: string[];
    try {
      entries = await this.fsDriver.readDir(currentDir);
    } catch {
      return;
    }

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
  }

  private async integratePlannedFiles(rootDir: string, rootNode: TreeNode): Promise<void> {
    const plannedItems: Array<{ path: string; type: string; description?: string }> = [];

    if (this.graphEngine) {
      try {
        const rows = await this.graphEngine.getPlannedFiles();
        for (const row of rows) {
          plannedItems.push({
            path: row.path,
            type: row.type,
            description: row.description || undefined,
          });
        }
      } catch {
        // Fallback to disk scan
      }
    }

    // Direct scan fallback if no items from graph engine
    if (plannedItems.length === 0) {
      const scanForBlueprints = async (dir: string) => {
        try {
          const files = await this.fsDriver.readDir(dir);
          for (const file of files) {
            if (['node_modules', '.git', '.stubs', 'dist'].includes(file)) continue;
            const fullPath = dir === '.' ? file : `${dir}/${file}`;
            try {
              const sub = await this.fsDriver.readDir(fullPath);
              if (sub) await scanForBlueprints(fullPath);
            } catch {
              if (file.endsWith('.md')) {
                try {
                  const content = await this.fsDriver.readFile(fullPath);
                  const blocks = extractFileTreeBlocks(content);
                  for (const b of blocks) {
                    plannedItems.push(...parseFileTreeEntries(b));
                  }
                } catch {
                  // Ignore read error
                }
              }
            }
          }
        } catch {
          // Ignore directory scan error
        }
      };
      await scanForBlueprints(rootDir);
    }

    for (const item of plannedItems) {
      const normalized = normalizePosixPath(item.path);
      const parts = normalized.split('/');
      let curr = rootNode;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLast = i === parts.length - 1;
        const isDir = isLast ? item.type === 'dir' : true;

        if (!curr.children.has(part)) {
          const nodePath = parts.slice(0, i + 1).join('/');
          const exists = await this.fsDriver.exists(nodePath);
          const newNode: TreeNode = {
            name: part,
            fullPath: nodePath,
            isDir,
            isPlanned: !exists,
            existsOnDisk: exists,
            description: isLast ? item.description : undefined,
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

  private async annotateMetadata(node: TreeNode): Promise<void> {
    if (!this.graphEngine) return;

    if (!node.isDir) {
      try {
        let sidecar = await this.graphEngine.getSidecar(node.fullPath);
        if (!sidecar) {
          const files = await this.graphEngine.getFilesIndexed();
          const match = files.find(
            (f) =>
              f === node.fullPath ||
              f.endsWith('/' + node.fullPath) ||
              node.fullPath.endsWith('/' + f) ||
              path.basename(f) === path.basename(node.fullPath),
          );
          if (match) {
            sidecar = await this.graphEngine.getSidecar(match);
          }
        }
        if (sidecar) {
          node.phase = sidecar.phase || sidecar.frontmatter?.phase || 'spec';
          node.status = sidecar.status || sidecar.frontmatter?.status;
          node.statusFlag =
            sidecar.statusFlag || sidecar.status_flag || sidecar.frontmatter?.status_flag;
        }
      } catch {
        // Ignore metadata fetch error
      }
    }

    for (const child of node.children.values()) {
      await this.annotateMetadata(child);
    }
  }

  private renderNode(
    node: TreeNode,
    prefix: string,
    lines: string[],
    showStatus: boolean,
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
        this.renderNode(child, prefix + subPrefix, lines, showStatus, false);
      }
    });
  }
}

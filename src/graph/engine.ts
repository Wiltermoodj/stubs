import * as path from 'path';
import * as crypto from 'crypto';
import {
  OkfFrontmatter,
  parseOkfSpec,
  FileTreeEntry,
  extractMarkdownChecklists,
  extractFileTreeBlocks,
  parseFileTreeEntries,
} from '../parser/okf';
import { loadConfig } from '../config/schema';
import {
  FileStorageDriver,
  DatabaseDriver,
  NodeFileSystem,
  BetterSqliteDriver,
  VirtualFileSystem,
  WasmSqliteDriver,
} from '../storage';
import { GraphNode, GraphEdge, extractFileGraph } from './extractor';
import { TopologyEngine } from './topology';

export { GraphNode, GraphEdge, extractFileGraph } from './extractor';
export { TopologyEngine } from './topology';

export function normalizePosixPath(p: string): string {
  if (!p) return '';
  let normalized = p.replace(/\\/g, '/');
  normalized = normalized.replace(/\/{2,}/g, '/');

  let drivePrefix = '';
  const driveMatch = normalized.match(/^([a-zA-Z]:)/);
  if (driveMatch) {
    drivePrefix = driveMatch[1];
    normalized = normalized.substring(drivePrefix.length);
  }

  const parts = normalized.split('/');
  const result: string[] = [];
  for (const part of parts) {
    if (part === '.' || part === '') {
      continue;
    }
    if (part === '..') {
      if (result.length > 0 && result[result.length - 1] !== '..') {
        result.pop();
      } else {
        result.push('..');
      }
    } else {
      result.push(part);
    }
  }

  const isAbsolute = normalized.startsWith('/');
  let prefix = drivePrefix;
  if (isAbsolute || drivePrefix) {
    prefix += '/';
  }
  const joined = prefix + result.join('/');
  if (!joined) {
    return isAbsolute ? '/' : '.';
  }
  return joined;
}

export function resolvePosixPath(p: string): string {
  let normalized = p.replace(/\\/g, '/');
  const isAbsolute = normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized);
  if (!isAbsolute) {
    const cwd =
      typeof process !== 'undefined' && typeof process.cwd === 'function'
        ? process.cwd().replace(/\\/g, '/')
        : '/';
    normalized = cwd + '/' + normalized;
  }
  return normalizePosixPath(normalized);
}

async function fallbackGlob(fsDriver: FileStorageDriver, pattern: string): Promise<string[]> {
  const results: string[] = [];
  const normalizedPattern = pattern.replace(/\\/g, '/');
  const isWildcard = normalizedPattern.includes('*') || normalizedPattern.includes('?');

  let regex: RegExp | null = null;
  let baseDir = normalizedPattern;
  if (isWildcard) {
    const firstWildcard = normalizedPattern.search(/[*?]/);
    const partBefore = normalizedPattern.substring(0, firstWildcard);
    const lastSlash = partBefore.lastIndexOf('/');
    if (lastSlash !== -1) {
      baseDir = partBefore.substring(0, lastSlash);
    } else {
      baseDir = '.';
    }

    const regexStr = normalizedPattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\//g, '([^/]*/)*')
      .replace(/\*/g, '[^/]*');
    regex = new RegExp(`^${regexStr}$`);
  }

  const recurse = async (currDir: string) => {
    try {
      const entries = await fsDriver.readDir(currDir);
      for (const entry of entries) {
        const fullPath = currDir === '.' || currDir === '' ? entry : `${currDir}/${entry}`;
        const normalizedPath = fullPath.replace(/\\/g, '/');

        if (
          entry === 'node_modules' ||
          entry === '.git' ||
          entry === '.stubs' ||
          entry === 'dist' ||
          entry === 'build'
        ) {
          continue;
        }

        let isDir = false;
        try {
          const subEntries = await fsDriver.readDir(normalizedPath);
          if (subEntries && subEntries.length > 0) {
            isDir = true;
          }
        } catch {
          isDir = false;
        }

        if (isDir) {
          await recurse(normalizedPath);
        } else {
          if (regex) {
            if (regex.test(normalizedPath)) {
              results.push(normalizedPath);
            }
          } else {
            results.push(normalizedPath);
          }
        }
      }
    } catch {
      // Ignore directory read errors
    }
  };

  await recurse(baseDir);
  return results;
}

export interface IndexSummary {
  scanned: number;
  indexed: number;
  pruned: number;
  errors: Array<{ filePath: string; error: string }>;
}

export interface SidecarInput {
  filePath: string;
  frontmatter: OkfFrontmatter;
  body: string;
  fileHash?: string;
}

export interface SearchOptions {
  bounds?: string[];
  tags?: string[];
  limit?: number;
  candidateFiles?: Set<string>;
}

export interface SearchResult {
  filePath: string;
  title: string;
  description: string;
  type: string;
  status: string;
  status_flag: string;
  rank?: number;
}

export interface TaskRow {
  id: string;
  sidecar_path: string;
  text: string;
  completed: number;
  line_number: number | null;
  initiative: string | null;
}

export interface PlannedFileRow {
  id: string;
  source_doc: string;
  path: string;
  type: 'file' | 'dir' | 'spec';
  description: string | null;
  status: string;
}

export interface PlanningHubSummary {
  initiatives: Array<{
    filePath: string;
    title: string;
    type: string;
    phase: string;
    status: string;
    status_flag: string;
    totalTasks: number;
    completedTasks: number;
  }>;
  concepts: Array<{
    filePath: string;
    title: string;
    type: string;
    phase: string;
    description: string;
  }>;
  tasks: Array<{
    id: string;
    sidecar_path: string;
    text: string;
    completed: boolean;
    line_number: number | null;
    initiative: string | null;
  }>;
  plannedFiles: Array<{
    id: string;
    source_doc: string;
    path: string;
    type: string;
    description: string | null;
    status: string;
  }>;
  summary: {
    totalInitiatives: number;
    totalConcepts: number;
    totalTasks: number;
    completedTasks: number;
    pendingTasks: number;
    taskCompletionRate: number;
  };
}

export interface PhaseStatusReport {
  matrix: Record<string, string>;
  summary: Record<string, number>;
  sidecars: Array<{
    filePath: string;
    title: string;
    type: string;
    phase: string;
    status: string;
    status_flag: string;
  }>;
}

export interface TieredNeighborhood {
  targetPath: string;
  targetSidecar: any | null;
  tier1Dependencies: Array<{
    filePath: string;
    sidecar: any | null;
  }>;
  tier1Dependents: Array<{
    filePath: string;
    sidecar: any | null;
  }>;
  tier2Dependencies: Array<{
    filePath: string;
    sidecar: any | null;
  }>;
}

export class GraphEngine {
  private dbPath: string;
  public fsDriver!: FileStorageDriver;
  public dbDriver!: DatabaseDriver;

  constructor(
    dbPathOrOptions?:
      string | { fsDriver?: FileStorageDriver; dbDriver?: DatabaseDriver; dbPath?: string },
  ) {
    let resolvedDbPath: string | undefined;

    if (typeof dbPathOrOptions === 'string') {
      resolvedDbPath = dbPathOrOptions;
    } else if (dbPathOrOptions && typeof dbPathOrOptions === 'object') {
      this.fsDriver = dbPathOrOptions.fsDriver!;
      this.dbDriver = dbPathOrOptions.dbDriver!;
      resolvedDbPath = dbPathOrOptions.dbPath;
    }

    if (resolvedDbPath) {
      this.dbPath = resolvedDbPath;
    } else {
      const config = loadConfig();
      this.dbPath = config.paths.db_path || '.stubs/graph.sqlite';
    }

    if (!this.fsDriver) {
      this.fsDriver = new NodeFileSystem();
    }
    if (!this.dbDriver) {
      let sqlite3Available = false;
      try {
        require('sqlite3');
        sqlite3Available = true;
      } catch {
        // Fallback to WASM if native module missing
      }

      if (sqlite3Available) {
        this.dbDriver = new BetterSqliteDriver(this.dbPath);
      } else {
        this.dbDriver = new WasmSqliteDriver({
          dbPath: this.dbPath,
          fsDriver: this.fsDriver,
        });
      }
    }
  }

  /**
   * Initializes the database connection and creates tables if they do not exist.
   */
  public async initialize(): Promise<void> {
    await this.dbDriver.initialize();
    await this.createSchema();
  }

  private async createSchema(): Promise<void> {
    // Enable foreign keys
    await this.run('PRAGMA foreign_keys = ON;');

    // 1. Create sidecars physical table
    await this.run(`
      CREATE TABLE IF NOT EXISTS sidecars (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT UNIQUE NOT NULL,
        title TEXT,
        type TEXT,
        description TEXT,
        module_depth TEXT,
        context_object TEXT,
        template_source TEXT,
        template_version TEXT,
        status TEXT,
        version INTEGER,
        phase TEXT,
        initiative TEXT,
        target_code_file TEXT,
        status_flag TEXT,
        stale_details TEXT,
        last_sync_timestamp TEXT,
        sidecar_hash TEXT,
        code_hash TEXT,
        interfaces_text TEXT,
        decisions_text TEXT,
        raw_content TEXT,
        tags TEXT,
        exports TEXT,
        file_hash TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Migrations for existing databases
    try {
      await this.run('ALTER TABLE sidecars ADD COLUMN phase TEXT;');
    } catch {
      // Column may already exist
    }
    try {
      await this.run('ALTER TABLE sidecars ADD COLUMN initiative TEXT;');
    } catch {
      // Column may already exist
    }

    // 2. Create index on file_path for fast lookups
    await this.run(`CREATE INDEX IF NOT EXISTS idx_sidecars_file_path ON sidecars(file_path);`);

    // 3. Create dependencies table
    await this.run(`
      CREATE TABLE IF NOT EXISTS dependencies (
        source_file_path TEXT NOT NULL,
        target_file_path TEXT NOT NULL,
        type TEXT NOT NULL,
        PRIMARY KEY (source_file_path, target_file_path, type)
      );
    `);
    await this.run(
      `CREATE INDEX IF NOT EXISTS idx_dependencies_source ON dependencies(source_file_path);`,
    );
    await this.run(
      `CREATE INDEX IF NOT EXISTS idx_dependencies_target ON dependencies(target_file_path);`,
    );

    // 4. Create tags table
    await this.run(`
      CREATE TABLE IF NOT EXISTS tags (
        file_path TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (file_path, tag),
        FOREIGN KEY (file_path) REFERENCES sidecars(file_path) ON DELETE CASCADE
      );
    `);

    // 5. Create exports table
    await this.run(`
      CREATE TABLE IF NOT EXISTS exports (
        file_path TEXT NOT NULL,
        export_name TEXT NOT NULL,
        PRIMARY KEY (file_path, export_name),
        FOREIGN KEY (file_path) REFERENCES sidecars(file_path) ON DELETE CASCADE
      );
    `);

    // 6. Create decisions table
    await this.run(`
      CREATE TABLE IF NOT EXISTS decisions (
        file_path TEXT NOT NULL,
        adr_id TEXT NOT NULL,
        summary TEXT,
        date TEXT,
        PRIMARY KEY (file_path, adr_id),
        FOREIGN KEY (file_path) REFERENCES sidecars(file_path) ON DELETE CASCADE
      );
    `);

    // 7. Create user_notes table
    await this.run(`
      CREATE TABLE IF NOT EXISTS user_notes (
        file_path TEXT NOT NULL,
        note_id TEXT NOT NULL,
        timestamp TEXT,
        text TEXT,
        status TEXT,
        PRIMARY KEY (file_path, note_id),
        FOREIGN KEY (file_path) REFERENCES sidecars(file_path) ON DELETE CASCADE
      );
    `);

    // 8. Create tasks table
    await this.run(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        sidecar_path TEXT NOT NULL,
        text TEXT NOT NULL,
        completed INTEGER NOT NULL,
        line_number INTEGER,
        initiative TEXT
      );
    `);
    await this.run(`CREATE INDEX IF NOT EXISTS idx_tasks_sidecar ON tasks(sidecar_path);`);
    await this.run(`CREATE INDEX IF NOT EXISTS idx_tasks_initiative ON tasks(initiative);`);

    // 9. Create planned_files table
    await this.run(`
      CREATE TABLE IF NOT EXISTS planned_files (
        id TEXT PRIMARY KEY,
        source_doc TEXT NOT NULL,
        path TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'planned'
      );
    `);
    await this.run(
      `CREATE INDEX IF NOT EXISTS idx_planned_files_source ON planned_files(source_doc);`,
    );
    await this.run(`CREATE INDEX IF NOT EXISTS idx_planned_files_path ON planned_files(path);`);

    // 10. Create virtual FTS5 table with external content and configure tokenizer
    await this.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS sidecar_fts USING fts5(
        file_path,
        title,
        description,
        tags,
        exports,
        interfaces_text,
        decisions_text,
        content='sidecars',
        content_rowid='id',
        tokenize='unicode61 remove_diacritics 1'
      );
    `);

    // 11. Create index_meta table for index-wide metadata/status
    await this.run(`
      CREATE TABLE IF NOT EXISTS index_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    // 12. Create sidecar_embeddings table for pluggable vector search engines
    await this.run(`
      CREATE TABLE IF NOT EXISTS sidecar_embeddings (
        file_path TEXT,
        engine TEXT,
        embedding TEXT, -- JSON array of floats
        PRIMARY KEY (file_path, engine)
      );
    `);

    // 13. Create graph_nodes table for symbol & file level topological traversal
    await this.run(`
      CREATE TABLE IF NOT EXISTS graph_nodes (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        symbol_name TEXT,
        kind TEXT NOT NULL,
        domain TEXT,
        lifecycle_phase TEXT,
        loc_start INTEGER,
        loc_end INTEGER
      );
    `);
    await this.run(`CREATE INDEX IF NOT EXISTS idx_graph_nodes_file ON graph_nodes(file_path);`);
    await this.run(`CREATE INDEX IF NOT EXISTS idx_graph_nodes_domain ON graph_nodes(domain);`);

    // 13b. Create file_meta table for incremental JIT delta sync
    await this.run(`
      CREATE TABLE IF NOT EXISTS file_meta (
        file_path TEXT PRIMARY KEY,
        file_hash TEXT NOT NULL,
        indexed_at INTEGER NOT NULL
      );
    `);

    // 14. Create graph_edges table for AST imports, calls, depends_on relationships
    await this.run(`
      CREATE TABLE IF NOT EXISTS graph_edges (
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        PRIMARY KEY (source_id, target_id, relation)
      );
    `);
    await this.run(
      `CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_id, relation);`,
    );
    await this.run(
      `CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_id, relation);`,
    );
  }

  private async ensureInitialized(): Promise<void> {
    await this.initialize();
  }

  public async run(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
    return await this.dbDriver.run(sql, params);
  }

  public async get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    return await this.dbDriver.get(sql, params);
  }

  public async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return await this.dbDriver.all(sql, params);
  }

  /**
   * Helper to extract TS blocks
   */
  private extractTypeScriptBlocks(body: string): string {
    const regex = /```typescript\n([\s\S]*?)\n```/g;
    const blocks: string[] = [];
    let match;
    while ((match = regex.exec(body)) !== null) {
      blocks.push(match[1]);
    }
    return blocks.join('\n\n');
  }

  /**
   * Index (insert/update) a sidecar specification into the database and FTS5 search index.
   */
  public async upsertSidecar(input: SidecarInput): Promise<void> {
    await this.ensureInitialized();

    const { filePath, frontmatter, body, fileHash } = input;
    const {
      title,
      type,
      description,
      module_depth,
      context_object,
      template_source,
      template_version,
      status,
      version,
      phase,
      initiative,
      target_code_file,
      status_flag,
      stale_details,
      sync_state,
      tags = [],
      exports = [],
      depends_on = [],
      used_by = [],
      decisions = [],
      user_notes = [],
    } = frontmatter;

    const tagsStr = tags.join(' ');
    const exportsStr = exports.join(' ');
    const lastSyncTimestamp = sync_state?.last_sync_timestamp || null;
    const sidecarHash = sync_state?.sidecar_hash || null;
    const codeHash = sync_state?.code_hash || null;
    const phaseVal = phase || 'spec';
    const initiativeVal = initiative || null;

    const interfacesText = this.extractTypeScriptBlocks(body);
    const decisionsText = decisions.map((d) => `${d.id}: ${d.summary}`).join('\n');

    await this.run('BEGIN TRANSACTION;');

    try {
      // 1. Check if sidecar already exists and delete its references from physical + FTS5
      const existing = await this.get<{
        id: number;
        tags: string;
        exports: string;
        interfaces_text: string;
        decisions_text: string;
      }>(
        'SELECT id, tags, exports, interfaces_text, decisions_text FROM sidecars WHERE file_path = ?;',
        [filePath],
      );

      if (existing) {
        // Delete from FTS5
        await this.run(
          `INSERT INTO sidecar_fts(sidecar_fts, rowid, file_path, title, description, tags, exports, interfaces_text, decisions_text)
           VALUES('delete', ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            existing.id,
            filePath,
            title,
            description,
            existing.tags,
            existing.exports,
            existing.interfaces_text,
            existing.decisions_text,
          ],
        );

        // Delete from detail tables
        await this.run(
          'DELETE FROM dependencies WHERE source_file_path = ? OR target_file_path = ?;',
          [filePath, filePath],
        );
        await this.run('DELETE FROM tags WHERE file_path = ?;', [filePath]);
        await this.run('DELETE FROM exports WHERE file_path = ?;', [filePath]);
        await this.run('DELETE FROM decisions WHERE file_path = ?;', [filePath]);
        await this.run('DELETE FROM user_notes WHERE file_path = ?;', [filePath]);
        await this.run('DELETE FROM tasks WHERE sidecar_path = ?;', [filePath]);
        await this.run('DELETE FROM planned_files WHERE source_doc = ?;', [filePath]);
        await this.run('DELETE FROM sidecars WHERE file_path = ?;', [filePath]);
      }

      // 2. Insert into sidecars table
      const insertResult = await this.run(
        `INSERT INTO sidecars (
          file_path, title, type, description, module_depth, context_object,
          template_source, template_version, status, version, phase, initiative, target_code_file,
          status_flag, stale_details, last_sync_timestamp, sidecar_hash, code_hash,
          interfaces_text, decisions_text, raw_content, tags, exports, file_hash, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP);`,
        [
          filePath,
          title,
          type,
          description,
          module_depth || null,
          context_object || null,
          template_source || null,
          template_version !== undefined ? String(template_version) : null,
          status,
          version,
          phaseVal,
          initiativeVal,
          target_code_file,
          status_flag,
          stale_details || null,
          lastSyncTimestamp,
          sidecarHash,
          codeHash,
          interfacesText,
          decisionsText,
          body,
          tagsStr,
          exportsStr,
          fileHash || null,
        ],
      );

      const sidecarId = insertResult.lastID;

      // 3. Insert dependencies
      for (const dep of depends_on) {
        await this.run(
          'INSERT OR IGNORE INTO dependencies (source_file_path, target_file_path, type) VALUES (?, ?, ?);',
          [filePath, dep, 'depends_on'],
        );
      }
      for (const user of used_by) {
        await this.run(
          'INSERT OR IGNORE INTO dependencies (source_file_path, target_file_path, type) VALUES (?, ?, ?);',
          [filePath, user, 'used_by'],
        );
      }

      // 4. Insert tags
      for (const tag of tags) {
        await this.run('INSERT OR IGNORE INTO tags (file_path, tag) VALUES (?, ?);', [
          filePath,
          tag,
        ]);
      }

      // 5. Insert exports
      for (const exp of exports) {
        await this.run('INSERT OR IGNORE INTO exports (file_path, export_name) VALUES (?, ?);', [
          filePath,
          exp,
        ]);
      }

      // 6. Insert decisions
      for (const dec of decisions) {
        await this.run(
          'INSERT OR IGNORE INTO decisions (file_path, adr_id, summary, date) VALUES (?, ?, ?, ?);',
          [filePath, dec.id, dec.summary, dec.date],
        );
      }

      // 7. Insert user notes
      for (const note of user_notes) {
        await this.run(
          'INSERT OR IGNORE INTO user_notes (file_path, note_id, timestamp, text, status) VALUES (?, ?, ?, ?, ?);',
          [filePath, note.id, note.timestamp, note.text, note.status],
        );
      }

      // 8. Insert tasks (from body markdown checklist and frontmatter tasks)
      const bodyTasks = extractMarkdownChecklists(body);
      const fmTasks = frontmatter.tasks || [];
      const allTasks = [
        ...bodyTasks,
        ...fmTasks.map((t, idx) => ({
          text: t.text,
          completed: t.completed,
          line: t.line || idx + 1,
        })),
      ];

      let taskIdx = 0;
      for (const task of allTasks) {
        const taskId = `${filePath}#task-${taskIdx++}`;
        await this.run(
          'INSERT OR REPLACE INTO tasks (id, sidecar_path, text, completed, line_number, initiative) VALUES (?, ?, ?, ?, ?, ?);',
          [taskId, filePath, task.text, task.completed ? 1 : 0, task.line || null, initiativeVal],
        );
      }

      // 9. Insert planned files (from body filetree blocks and frontmatter planned_files)
      const treeBlocks = extractFileTreeBlocks(body);
      const plannedEntries: FileTreeEntry[] = [];
      for (const block of treeBlocks) {
        plannedEntries.push(...parseFileTreeEntries(block));
      }
      if (frontmatter.planned_files) {
        for (const pf of frontmatter.planned_files) {
          if (typeof pf === 'string') {
            plannedEntries.push({ path: pf, type: pf.endsWith('.md') ? 'spec' : 'file' });
          } else if (pf && typeof pf === 'object') {
            plannedEntries.push({
              path: pf.path,
              type: (pf.type || (pf.path.endsWith('.md') ? 'spec' : 'file')) as
                'file' | 'dir' | 'spec',
              description: pf.description,
            });
          }
        }
      }

      let pfIdx = 0;
      for (const entry of plannedEntries) {
        const pfId = `${filePath}#pf-${pfIdx++}`;
        await this.run(
          'INSERT OR REPLACE INTO planned_files (id, source_doc, path, type, description, status) VALUES (?, ?, ?, ?, ?, ?);',
          [pfId, filePath, entry.path, entry.type, entry.description || null, 'planned'],
        );
      }

      // 10. Insert into FTS5 virtual table
      await this.run(
        `INSERT INTO sidecar_fts(rowid, file_path, title, description, tags, exports, interfaces_text, decisions_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          sidecarId,
          filePath,
          title,
          description,
          tagsStr,
          exportsStr,
          interfacesText,
          decisionsText,
        ],
      );

      // 11. Extract and update graph_nodes & graph_edges for this sidecar
      const rawFull = input.body ? `---\n${input.body}` : '';
      const graphData = extractFileGraph(filePath, rawFull, {
        domain: (frontmatter as any).domain,
        phase: phaseVal,
      });
      for (const dep of depends_on) {
        if (!dep) continue;
        const normDep = normalizePosixPath(dep);
        graphData.edges.push({
          source_id: filePath,
          target_id: normDep,
          relation: 'depends_on',
          weight: 1.0,
        });
      }
      for (const user of used_by) {
        if (!user) continue;
        const normUser = normalizePosixPath(user);
        graphData.edges.push({
          source_id: normUser,
          target_id: filePath,
          relation: 'depends_on',
          weight: 1.0,
        });
      }
      if (target_code_file) {
        const normTarget = normalizePosixPath(target_code_file);
        graphData.edges.push({
          source_id: filePath,
          target_id: normTarget,
          relation: 'implements',
          weight: 1.0,
        });
      }

      await this.run(
        'DELETE FROM graph_edges WHERE source_id = ? OR target_id = ? OR source_id LIKE ? OR target_id LIKE ?;',
        [filePath, filePath, `${filePath}#%`, `${filePath}#%`],
      );
      await this.run('DELETE FROM graph_nodes WHERE file_path = ? OR id = ?;', [
        filePath,
        filePath,
      ]);

      for (const node of graphData.nodes) {
        await this.run(
          `INSERT OR REPLACE INTO graph_nodes (id, file_path, symbol_name, kind, domain, lifecycle_phase, loc_start, loc_end)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            node.id,
            node.file_path,
            node.symbol_name || null,
            node.kind,
            node.domain || null,
            node.lifecycle_phase || null,
            node.loc_start || null,
            node.loc_end || null,
          ],
        );
      }
      for (const edge of graphData.edges) {
        await this.run(
          `INSERT OR REPLACE INTO graph_edges (source_id, target_id, relation, weight)
           VALUES (?, ?, ?, ?);`,
          [edge.source_id, edge.target_id, edge.relation, edge.weight || 1.0],
        );
      }

      await this.run('COMMIT;');

      const config = loadConfig();
      const activeEngine = config.search.engine;
      const textToEmbed = `
File: ${filePath}
Title: ${title}
Description: ${description}
Tags: ${tags.join(', ')}
Exports: ${exports.join(', ')}
Interfaces: ${interfacesText}
Decisions: ${decisionsText}
`.trim();

      if (activeEngine === 'plugin-level-2') {
        const { Level2SearchPlugin } = await import('./plugins/level2');
        const plugin = new Level2SearchPlugin(this);
        await plugin.indexSidecar(filePath, textToEmbed);
      } else if (activeEngine === 'plugin-level-3') {
        const { Level3SearchPlugin } = await import('./plugins/level3');
        const plugin = new Level3SearchPlugin(this);
        await plugin.indexSidecar(filePath, textToEmbed);
      }
    } catch (err) {
      await this.run('ROLLBACK;');
      throw err;
    }
  }

  /**
   * Delete a sidecar from physical tables and the FTS5 search index.
   */
  public async deleteSidecar(filePath: string): Promise<void> {
    await this.ensureInitialized();

    const existing = await this.get<{
      id: number;
      title: string;
      description: string;
      tags: string;
      exports: string;
      interfaces_text: string;
      decisions_text: string;
    }>(
      'SELECT id, title, description, tags, exports, interfaces_text, decisions_text FROM sidecars WHERE file_path = ?;',
      [filePath],
    );

    if (!existing) return;

    await this.run('BEGIN TRANSACTION;');
    try {
      await this.run(
        `INSERT INTO sidecar_fts(sidecar_fts, rowid, file_path, title, description, tags, exports, interfaces_text, decisions_text)
         VALUES('delete', ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          existing.id,
          filePath,
          existing.title,
          existing.description,
          existing.tags,
          existing.exports,
          existing.interfaces_text,
          existing.decisions_text,
        ],
      );

      await this.run(
        'DELETE FROM dependencies WHERE source_file_path = ? OR target_file_path = ?;',
        [filePath, filePath],
      );
      await this.run('DELETE FROM tags WHERE file_path = ?;', [filePath]);
      await this.run('DELETE FROM exports WHERE file_path = ?;', [filePath]);
      await this.run('DELETE FROM decisions WHERE file_path = ?;', [filePath]);
      await this.run('DELETE FROM user_notes WHERE file_path = ?;', [filePath]);
      await this.run('DELETE FROM tasks WHERE sidecar_path = ?;', [filePath]);
      await this.run('DELETE FROM planned_files WHERE source_doc = ?;', [filePath]);
      await this.run('DELETE FROM sidecars WHERE file_path = ?;', [filePath]);
      await this.run(
        'DELETE FROM graph_edges WHERE source_id = ? OR target_id = ? OR source_id LIKE ? OR target_id LIKE ?;',
        [filePath, filePath, `${filePath}#%`, `${filePath}#%`],
      );
      await this.run('DELETE FROM graph_nodes WHERE file_path = ? OR id = ?;', [
        filePath,
        filePath,
      ]);

      await this.run('COMMIT;');
    } catch (err) {
      await this.run('ROLLBACK;');
      throw err;
    }
  }

  /**
   * Upserts extracted graph nodes into the database.
   */
  public async upsertGraphNodes(nodes: GraphNode[]): Promise<void> {
    await this.ensureInitialized();
    for (const node of nodes) {
      await this.run(
        `INSERT OR REPLACE INTO graph_nodes (id, file_path, symbol_name, kind, domain, lifecycle_phase, loc_start, loc_end)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          node.id,
          node.file_path,
          node.symbol_name || null,
          node.kind,
          node.domain || null,
          node.lifecycle_phase || null,
          node.loc_start || null,
          node.loc_end || null,
        ],
      );
    }
  }

  /**
   * Upserts extracted graph edges into the database.
   */
  public async upsertGraphEdges(edges: GraphEdge[]): Promise<void> {
    await this.ensureInitialized();
    for (const edge of edges) {
      await this.run(
        `INSERT OR REPLACE INTO graph_edges (source_id, target_id, relation, weight)
         VALUES (?, ?, ?, ?);`,
        [edge.source_id, edge.target_id, edge.relation, edge.weight || 1.0],
      );
    }
  }

  /**
   * Deletes all graph nodes and edges associated with a specific file path.
   */
  public async deleteGraphNodesForFile(filePath: string): Promise<void> {
    await this.ensureInitialized();
    const norm = normalizePosixPath(filePath);
    await this.run(
      'DELETE FROM graph_edges WHERE source_id = ? OR target_id = ? OR source_id LIKE ? OR target_id LIKE ?;',
      [norm, norm, `${norm}#%`, `${norm}#%`],
    );
    await this.run('DELETE FROM graph_nodes WHERE file_path = ? OR id = ?;', [norm, norm]);
  }

  /**
   * Queries graph nodes matching optional filters.
   */
  public async getGraphNodes(filter: Partial<GraphNode> = {}): Promise<GraphNode[]> {
    await this.ensureInitialized();
    let sql = 'SELECT * FROM graph_nodes WHERE 1=1';
    const params: any[] = [];

    if (filter.file_path) {
      sql += ' AND file_path = ?';
      params.push(filter.file_path);
    }
    if (filter.kind) {
      sql += ' AND kind = ?';
      params.push(filter.kind);
    }
    if (filter.domain) {
      sql += ' AND domain = ?';
      params.push(filter.domain);
    }
    if (filter.lifecycle_phase) {
      sql += ' AND lifecycle_phase = ?';
      params.push(filter.lifecycle_phase);
    }
    if (filter.symbol_name) {
      sql += ' AND symbol_name = ?';
      params.push(filter.symbol_name);
    }

    return await this.all<GraphNode>(sql, params);
  }

  /**
   * Queries graph edges matching optional filters.
   */
  public async getGraphEdges(
    filter: { source_id?: string; target_id?: string; relation?: string } = {},
  ): Promise<GraphEdge[]> {
    await this.ensureInitialized();
    let sql = 'SELECT * FROM graph_edges WHERE 1=1';
    const params: any[] = [];

    if (filter.source_id) {
      sql += ' AND source_id = ?';
      params.push(filter.source_id);
    }
    if (filter.target_id) {
      sql += ' AND target_id = ?';
      params.push(filter.target_id);
    }
    if (filter.relation) {
      sql += ' AND relation = ?';
      params.push(filter.relation);
    }

    return await this.all<GraphEdge>(sql, params);
  }

  /**
   * Extracts AST/pattern graph from a source code or markdown file and indexes its nodes and edges.
   */
  public async indexCodeFile(
    filePath: string,
    content?: string,
    options: { domain?: string; phase?: string } = {},
  ): Promise<void> {
    await this.ensureInitialized();
    const norm = normalizePosixPath(filePath);
    let codeContent = content;
    if (codeContent === undefined) {
      codeContent = await this.fsDriver.readFile(norm);
    }

    // Determine domain and phase from existing sidecars or options if available
    const domain = options.domain;
    let phase = options.phase;
    if (!phase) {
      const sidecar = await this.get<{ phase?: string }>(
        'SELECT phase FROM sidecars WHERE target_code_file = ? OR file_path = ?;',
        [norm, norm],
      );
      if (sidecar) {
        phase = sidecar.phase;
      }
    }

    const { nodes, edges } = extractFileGraph(norm, codeContent, { domain, phase });
    await this.deleteGraphNodesForFile(norm);
    await this.upsertGraphNodes(nodes);
    await this.upsertGraphEdges(edges);

    const hash = this.calculateHash(codeContent);
    await this.run(
      `INSERT OR REPLACE INTO file_meta (file_path, file_hash, indexed_at) VALUES (?, ?, ?);`,
      [norm, hash, Date.now()],
    );
  }

  /**
   * Performs high-speed lazy JIT incremental sync across workspace files.
   * Compares disk hashes with SQLite file_meta and updates only modified/added files.
   */
  public async syncWorkspaceFiles(rootDir: string = '.'): Promise<{
    added: number;
    updated: number;
    removed: number;
  }> {
    await this.ensureInitialized();
    const result = { added: 0, updated: 0, removed: 0 };

    let files: string[];
    try {
      if (typeof (this.fsDriver as any).glob === 'function') {
        files = await (this.fsDriver as any).glob(rootDir);
      } else {
        files = await fallbackGlob(this.fsDriver, rootDir);
      }
    } catch {
      return result;
    }

    const codeExts = ['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.md'];
    const matchedFiles = files.filter((f) => codeExts.includes(path.extname(f).toLowerCase()));

    const cachedMetaRows = await this.all<{ file_path: string; file_hash: string }>(
      'SELECT file_path, file_hash FROM file_meta;',
    );
    const cachedMetaMap = new Map<string, string>();
    for (const r of cachedMetaRows) {
      cachedMetaMap.set(r.file_path, r.file_hash);
    }

    const currentNormFiles = new Set<string>();

    for (const f of matchedFiles) {
      const norm = normalizePosixPath(f);
      currentNormFiles.add(norm);

      try {
        const content = await this.fsDriver.readFile(norm);
        const currentHash = this.calculateHash(content);
        const cachedHash = cachedMetaMap.get(norm);

        if (!cachedHash) {
          await this.indexCodeFile(norm, content);
          if (norm.endsWith('.md') && !norm.endsWith('.tpl') && content.trim().startsWith('---')) {
            try {
              await this.indexFile(norm);
            } catch {}
          }
          result.added++;
        } else if (cachedHash !== currentHash) {
          await this.indexCodeFile(norm, content);
          if (norm.endsWith('.md') && !norm.endsWith('.tpl') && content.trim().startsWith('---')) {
            try {
              await this.indexFile(norm);
            } catch {}
          }
          result.updated++;
        }
      } catch {
        // Skip unreadable files
      }
    }

    // Purge deleted files only within rootDir
    for (const cachedPath of cachedMetaMap.keys()) {
      if (
        (rootDir === '.' || cachedPath.startsWith(rootDir.replace(/^\.\//, ''))) &&
        !currentNormFiles.has(cachedPath)
      ) {
        await this.deleteGraphNodesForFile(cachedPath);
        await this.run('DELETE FROM file_meta WHERE file_path = ?;', [cachedPath]);
        await this.run('DELETE FROM sidecars WHERE file_path = ?;', [cachedPath]);
        result.removed++;
      }
    }

    return result;
  }

  /**
   * Indexes all source code and markdown files under a directory into the graph database.
   */
  public async indexCodeWorkspace(
    rootDir: string = '.',
    _options: { force?: boolean } = {},
  ): Promise<{
    scanned: number;
    indexed: number;
    errors: Array<{ filePath: string; error: string }>;
  }> {
    await this.ensureInitialized();
    const summary = {
      scanned: 0,
      indexed: 0,
      errors: [] as Array<{ filePath: string; error: string }>,
    };

    let files: string[];
    try {
      if (typeof (this.fsDriver as any).glob === 'function') {
        files = await (this.fsDriver as any).glob(rootDir);
      } else {
        files = await fallbackGlob(this.fsDriver, rootDir);
      }
    } catch (err: any) {
      summary.errors.push({ filePath: rootDir, error: err.message });
      return summary;
    }

    const codeExts = ['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.md'];
    for (const f of files) {
      const ext = path.extname(f).toLowerCase();
      if (!codeExts.includes(ext)) continue;

      summary.scanned++;
      try {
        await this.indexCodeFile(f);
        summary.indexed++;
      } catch (err: any) {
        summary.errors.push({ filePath: f, error: err.message });
      }
    }

    return summary;
  }

  /**
   * Instantiates a TopologyEngine loaded with all current graph nodes and edges.
   */
  public async getTopologyEngine(): Promise<TopologyEngine> {
    await this.ensureInitialized();
    const nodes = await this.getGraphNodes();
    const edges = await this.getGraphEdges();
    return new TopologyEngine(nodes, edges);
  }

  /**
   * Reads and parses a single specification file from disk and upserts it.
   */
  public async indexFile(filePath: string): Promise<void> {
    const content = await this.fsDriver.readFile(filePath);
    const parseResult = parseOkfSpec(content);
    if (!parseResult.isValid) {
      throw new Error(
        `Failed to parse OKF specification at ${filePath}:\n${parseResult.errors.join('\n')}`,
      );
    }
    const fileHash = this.calculateHash(content);
    await this.upsertSidecar({
      filePath,
      frontmatter: parseResult.frontmatter!,
      body: parseResult.body,
      fileHash,
    });
  }

  /**
   * Retrieves complete sidecar details including dependencies, tags, exports, decisions, and user notes.
   */
  public async getSidecar(filePath: string): Promise<any | null> {
    await this.ensureInitialized();

    const row = await this.get<any>('SELECT * FROM sidecars WHERE file_path = ?;', [filePath]);
    if (!row) return null;

    const deps = await this.all<{ target_file_path: string; type: string }>(
      'SELECT target_file_path, type FROM dependencies WHERE source_file_path = ?;',
      [filePath],
    );
    const tags = await this.all<{ tag: string }>('SELECT tag FROM tags WHERE file_path = ?;', [
      filePath,
    ]);
    const exportsList = await this.all<{ export_name: string }>(
      'SELECT export_name FROM exports WHERE file_path = ?;',
      [filePath],
    );
    const decisions = await this.all<{ adr_id: string; summary: string; date: string }>(
      'SELECT adr_id, summary, date FROM decisions WHERE file_path = ?;',
      [filePath],
    );
    const userNotes = await this.all<{
      note_id: string;
      timestamp: string;
      text: string;
      status: string;
    }>('SELECT note_id, timestamp, text, status FROM user_notes WHERE file_path = ?;', [filePath]);
    const tasks = await this.all<TaskRow>(
      'SELECT id, sidecar_path, text, completed, line_number, initiative FROM tasks WHERE sidecar_path = ? ORDER BY line_number ASC;',
      [filePath],
    );
    const plannedFiles = await this.all<PlannedFileRow>(
      'SELECT id, source_doc, path, type, description, status FROM planned_files WHERE source_doc = ? ORDER BY path ASC;',
      [filePath],
    );

    const frontmatter: OkfFrontmatter = {
      title: row.title,
      type: row.type,
      description: row.description,
      module_depth: row.module_depth,
      context_object: row.context_object,
      template_source: row.template_source,
      template_version: row.template_version,
      status: row.status,
      version: row.version,
      phase: row.phase,
      initiative: row.initiative,
      target_code_file: row.target_code_file,
      status_flag: row.status_flag,
      stale_details: row.stale_details,
      sync_state:
        row.last_sync_timestamp || row.sidecar_hash || row.code_hash
          ? {
              last_sync_timestamp: row.last_sync_timestamp,
              sidecar_hash: row.sidecar_hash,
              code_hash: row.code_hash,
            }
          : undefined,
      depends_on: deps.filter((d) => d.type === 'depends_on').map((d) => d.target_file_path),
      used_by: deps.filter((d) => d.type === 'used_by').map((d) => d.target_file_path),
      tags: tags.map((t) => t.tag),
      exports: exportsList.map((e) => e.export_name),
      decisions: decisions.map((d) => ({ id: d.adr_id, summary: d.summary, date: d.date })),
      user_notes: userNotes.map((n) => ({
        id: n.note_id,
        timestamp: n.timestamp,
        text: n.text,
        status: n.status,
      })),
      tasks: tasks.map((t) => ({
        text: t.text,
        completed: t.completed === 1,
        line: t.line_number || undefined,
      })),
      planned_files: plannedFiles.map((p) => ({
        path: p.path,
        type: p.type as any,
        description: p.description || undefined,
      })),
    };

    return {
      filePath: row.file_path,
      frontmatter,
      body: row.raw_content,
      title: row.title,
      type: row.type,
      description: row.description,
      moduleDepth: row.module_depth,
      contextObject: row.context_object,
      templateSource: row.template_source,
      templateVersion: row.template_version,
      status: row.status,
      version: row.version,
      phase: row.phase,
      initiative: row.initiative,
      targetCodeFile: row.target_code_file,
      statusFlag: row.status_flag,
      staleDetails: row.stale_details,
      lastSyncTimestamp: row.last_sync_timestamp,
      sidecarHash: row.sidecar_hash,
      codeHash: row.code_hash,
      rawContent: row.raw_content,
      updatedAt: row.updated_at,
      dependsOn: frontmatter.depends_on,
      usedBy: frontmatter.used_by,
      tags: frontmatter.tags,
      exports: frontmatter.exports,
      decisions: frontmatter.decisions,
      userNotes: frontmatter.user_notes,
      tasks: tasks.map((t) => ({
        id: t.id,
        sidecarPath: t.sidecar_path,
        text: t.text,
        completed: t.completed === 1,
        lineNumber: t.line_number,
        initiative: t.initiative,
      })),
      plannedFiles,
    };
  }

  /**
   * Retrieves 1-hop inbound and/or outbound neighbor file paths for a sidecar.
   */
  public async getNeighbors(
    filePath: string,
    direction: 'inbound' | 'outbound' | 'dependencies' | 'dependents' | 'both' = 'both',
  ): Promise<string[]> {
    await this.ensureInitialized();
    const results: string[] = [];

    const isOutbound =
      direction === 'outbound' || direction === 'dependencies' || direction === 'both';
    const isInbound = direction === 'inbound' || direction === 'dependents' || direction === 'both';

    if (isOutbound) {
      const outbound = await this.all<{ target_file_path: string }>(
        "SELECT target_file_path FROM dependencies WHERE source_file_path = ? AND type = 'depends_on';",
        [filePath],
      );
      results.push(...outbound.map((r) => r.target_file_path));
    }

    if (isInbound) {
      const inbound = await this.all<{ source_file_path: string }>(
        "SELECT source_file_path FROM dependencies WHERE target_file_path = ? AND type = 'depends_on';",
        [filePath],
      );
      results.push(...inbound.map((r) => r.source_file_path));
    }

    return Array.from(new Set(results));
  }

  /**
   * Retrieves a tiered topological neighborhood for agent context slicing:
   * - Tier 0: Target module sidecar
   * - Tier 1: 1-hop direct dependencies and direct dependents
   * - Tier 2: 2-hop transitive dependencies
   */
  public async getTieredNeighborhood(filePath: string, depth = 2): Promise<TieredNeighborhood> {
    await this.ensureInitialized();
    let normalized = normalizePosixPath(filePath);
    if (normalized.startsWith('./')) {
      normalized = normalized.substring(2);
    }

    let targetSidecar = await this.getSidecar(normalized);
    let canonicalPath = normalized;
    if (!targetSidecar && normalized.endsWith('.ts')) {
      const sidecarPath = `${normalized}.md`;
      const s = await this.getSidecar(sidecarPath);
      if (s) {
        canonicalPath = sidecarPath;
        targetSidecar = s;
      }
    } else if (!targetSidecar && normalized.endsWith('.ts.md')) {
      const codePath = normalized.replace(/\.md$/, '');
      const s = await this.getSidecar(codePath);
      if (s) {
        canonicalPath = codePath;
        targetSidecar = s;
      }
    }

    // 1-Hop direct dependencies (outbound)
    const tier1DepPaths = await this.getNeighbors(canonicalPath, 'dependencies');
    const tier1Dependencies = await Promise.all(
      tier1DepPaths.map(async (depPath) => ({
        filePath: depPath,
        sidecar: await this.getSidecar(depPath),
      })),
    );

    // 1-Hop direct dependents (inbound)
    const tier1CallerPaths = await this.getNeighbors(canonicalPath, 'dependents');
    const tier1Dependents = await Promise.all(
      tier1CallerPaths.map(async (callerPath) => ({
        filePath: callerPath,
        sidecar: await this.getSidecar(callerPath),
      })),
    );

    // 2-Hop transitive dependencies
    const tier2Dependencies: Array<{ filePath: string; sidecar: any | null }> = [];
    if (depth >= 2) {
      const tier1Set = new Set([canonicalPath, ...tier1DepPaths]);
      const tier2Paths = new Set<string>();

      for (const depPath of tier1DepPaths) {
        const subDeps = await this.getNeighbors(depPath, 'dependencies');
        for (const subDep of subDeps) {
          if (!tier1Set.has(subDep)) {
            tier2Paths.add(subDep);
          }
        }
      }

      for (const t2Path of tier2Paths) {
        tier2Dependencies.push({
          filePath: t2Path,
          sidecar: await this.getSidecar(t2Path),
        });
      }
    }

    return {
      targetPath: canonicalPath,
      targetSidecar,
      tier1Dependencies,
      tier1Dependents,
      tier2Dependencies,
    };
  }

  /**
   * Computes a topological ordering of sidecars based on dependency relationships.
   */
  public async getTopologicalSort(): Promise<string[]> {
    await this.ensureInitialized();
    const allNodes = await this.getFilesIndexed();
    if (allNodes.length === 0) return [];

    const inDegree: Map<string, number> = new Map();
    const adjList: Map<string, string[]> = new Map();

    for (const node of allNodes) {
      inDegree.set(node, 0);
      adjList.set(node, []);
    }

    const allEdges = await this.all<{ source_file_path: string; target_file_path: string }>(
      "SELECT source_file_path, target_file_path FROM dependencies WHERE type = 'depends_on';",
    );

    for (const edge of allEdges) {
      const src = edge.source_file_path;
      const tgt = edge.target_file_path;
      if (inDegree.has(src) && inDegree.has(tgt)) {
        inDegree.set(src, (inDegree.get(src) || 0) + 1);
        adjList.get(tgt)!.push(src);
      }
    }

    const queue: string[] = [];
    for (const [node, deg] of inDegree.entries()) {
      if (deg === 0) {
        queue.push(node);
      }
    }

    const result: string[] = [];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      result.push(curr);

      const neighbors = adjList.get(curr) || [];
      for (const neighbor of neighbors) {
        const newDeg = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) {
          queue.push(neighbor);
        }
      }
    }

    for (const node of allNodes) {
      if (!result.includes(node)) {
        result.push(node);
      }
    }

    return result;
  }

  /**
   * Retrieves pending directive notes across the whole repository.
   */
  public async getPendingDirectives(): Promise<
    Array<{ filePath: string; id: string; timestamp: string; text: string; status: string }>
  > {
    await this.ensureInitialized();
    const rows = await this.all<any>(
      `SELECT file_path as filePath, note_id as id, timestamp, text, status
       FROM user_notes
       WHERE status = 'pending'
       ORDER BY timestamp DESC;`,
    );
    return rows;
  }

  /**
   * Prunes search candidates using depends_on, used_by, and subsystem boundary scopes (src/auth).
   */
  private async getCandidateFilesFromBounds(bounds: string[]): Promise<Set<string>> {
    const candidates: Set<string> = new Set();

    for (const bound of bounds) {
      const normalizedBound = bound.replace(/\\/g, '/');

      if (normalizedBound.endsWith('.md') || normalizedBound.endsWith('.ts')) {
        const visited: Set<string> = new Set();
        const queue: string[] = [normalizedBound];

        while (queue.length > 0) {
          const curr = queue.shift()!;
          if (visited.has(curr)) continue;
          visited.add(curr);
          candidates.add(curr);

          const neighbors = await this.getNeighbors(curr, 'both');
          for (const n of neighbors) {
            if (!visited.has(n)) {
              queue.push(n);
            }
          }
        }
      } else {
        const dirPrefix = normalizedBound.endsWith('/') ? normalizedBound : `${normalizedBound}/`;
        const rows = await this.all<{ file_path: string }>(
          'SELECT file_path FROM sidecars WHERE file_path = ? OR file_path LIKE ?;',
          [normalizedBound, `${dirPrefix}%`],
        );
        rows.forEach((r) => candidates.add(r.file_path));
      }
    }

    return candidates;
  }

  /**
   * Filters candidate files by tags (exact matches of all tags).
   */
  private async getFilesByTags(tags: string[]): Promise<Set<string>> {
    const result: Set<string> = new Set();
    if (tags.length === 0) return result;

    const placeholders = tags.map(() => '?').join(', ');
    const sql = `SELECT file_path FROM tags WHERE tag IN (${placeholders}) GROUP BY file_path HAVING COUNT(DISTINCT tag) = ?;`;
    const rows = await this.all<{ file_path: string }>(sql, [...tags, tags.length]);
    rows.forEach((r) => result.add(r.file_path));
    return result;
  }

  /**
   * Search execution combining:
   * 1. Topological Graph Bounds pruning.
   * 2. Metadata Tag filtering.
   * 3. FTS5 BM25 ranking.
   */
  public async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    await this.ensureInitialized();

    const config = loadConfig();
    const activeEngine = config.search.engine;

    const { bounds, tags, limit } = options;

    let boundsSet: Set<string> | null = null;
    if (bounds && bounds.length > 0) {
      boundsSet = await this.getCandidateFilesFromBounds(bounds);
    }

    let tagsSet: Set<string> | null = null;
    if (tags && tags.length > 0) {
      tagsSet = await this.getFilesByTags(tags);
    }

    // Compute intersection of bounds and tags
    let finalCandidateSet: Set<string> | null = null;
    if (boundsSet && tagsSet) {
      finalCandidateSet = new Set([...boundsSet].filter((x) => tagsSet!.has(x)));
    } else if (boundsSet) {
      finalCandidateSet = boundsSet;
    } else if (tagsSet) {
      finalCandidateSet = tagsSet;
    }

    if (activeEngine === 'plugin-level-2') {
      const { Level2SearchPlugin } = await import('./plugins/level2');
      const plugin = new Level2SearchPlugin(this);
      const pluginOptions: SearchOptions = {
        ...options,
        candidateFiles: finalCandidateSet || undefined,
      };
      return await plugin.search(query, pluginOptions);
    } else if (activeEngine === 'plugin-level-3') {
      const { Level3SearchPlugin } = await import('./plugins/level3');
      const plugin = new Level3SearchPlugin(this);
      const pluginOptions: SearchOptions = {
        ...options,
        candidateFiles: finalCandidateSet || undefined,
      };
      return await plugin.search(query, pluginOptions);
    }

    let rows: any[];
    if (query && query.trim().length > 0) {
      try {
        rows = await this.all(
          `SELECT sidecars.file_path, sidecars.title, sidecars.description, sidecars.type, sidecars.status, sidecars.status_flag, bm25(sidecar_fts) as rank
           FROM sidecar_fts
           JOIN sidecars ON sidecars.id = sidecar_fts.rowid
           WHERE sidecar_fts MATCH ?
           ORDER BY rank ASC;`,
          [query],
        );
      } catch {
        // Fallback safely to LIKE if FTS5 syntax has issues
        const safeQuery = `%${query.replace(/%/g, '\\%')}%`;
        rows = await this.all(
          `SELECT file_path, title, description, type, status, status_flag, 0 as rank
           FROM sidecars
           WHERE title LIKE ? OR description LIKE ? OR file_path LIKE ?
           ORDER BY updated_at DESC;`,
          [safeQuery, safeQuery, safeQuery],
        );
      }
    } else {
      rows = await this.all(
        `SELECT file_path, title, description, type, status, status_flag, 0 as rank
         FROM sidecars
         ORDER BY updated_at DESC;`,
      );
    }

    // Filter by final candidate set
    let results: SearchResult[] = rows.map((row) => ({
      filePath: row.file_path,
      title: row.title || '',
      description: row.description || '',
      type: row.type || '',
      status: row.status || '',
      status_flag: row.status_flag || '',
      rank: row.rank !== undefined ? Number(row.rank) : undefined,
    }));

    if (finalCandidateSet) {
      results = results.filter((r) => finalCandidateSet!.has(r.filePath));
    }

    if (limit && limit > 0) {
      results = results.slice(0, limit);
    }

    return results;
  }

  /**
   * Scans, parses, and indexes the specified workspace specifications directory recursively.
   * Only indexes files that have changed (using SHA-256 hash comparison) unless force option is set.
   * Cleans up (prunes) database entries for files that no longer exist on disk.
   */
  public async indexWorkspace(
    specsDir: string,
    options: { force?: boolean } = {},
  ): Promise<IndexSummary> {
    await this.ensureInitialized();

    const summary: IndexSummary = {
      scanned: 0,
      indexed: 0,
      pruned: 0,
      errors: [],
    };

    if (!(await this.fsDriver.exists(specsDir))) {
      return summary;
    }

    let scannedFiles: string[];
    try {
      if (typeof (this.fsDriver as any).glob === 'function') {
        scannedFiles = await (this.fsDriver as any).glob(specsDir);
      } else {
        scannedFiles = await fallbackGlob(this.fsDriver, specsDir);
      }
    } catch (err: any) {
      summary.errors.push({
        filePath: specsDir,
        error: `Failed to scan directory: ${err.message}`,
      });
      return summary;
    }

    summary.scanned = scannedFiles.length;

    const processedFiles: Set<string> = new Set();

    for (const relativePath of scannedFiles) {
      try {
        if (!relativePath.endsWith('.md') || relativePath.endsWith('.tpl')) {
          continue;
        }

        const content = await this.fsDriver.readFile(relativePath);

        // Ignore files that don't start with YAML frontmatter marker
        if (!content.trim().startsWith('---')) {
          continue;
        }

        const fileHash = this.calculateHash(content);
        processedFiles.add(relativePath);

        if (!options.force) {
          const existing = await this.get<{ file_hash: string }>(
            'SELECT file_hash FROM sidecars WHERE file_path = ?;',
            [relativePath],
          );
          if (existing && existing.file_hash === fileHash) {
            continue;
          }
        }

        const parseResult = parseOkfSpec(content);
        if (!parseResult.isValid) {
          summary.errors.push({
            filePath: relativePath,
            error: `Validation errors:\n${parseResult.errors.join('\n')}`,
          });
          continue;
        }

        await this.upsertSidecar({
          filePath: relativePath,
          frontmatter: parseResult.frontmatter!,
          body: parseResult.body,
          fileHash,
        });

        summary.indexed++;
      } catch (err: any) {
        summary.errors.push({
          filePath: relativePath,
          error: `Error during indexing: ${err.message || err}`,
        });
      }
    }

    try {
      const dbFiles = await this.getFilesIndexed();
      for (const dbFile of dbFiles) {
        const absoluteDbFile = resolvePosixPath(dbFile);
        const absoluteSpecsDir = resolvePosixPath(specsDir);
        const prefix = absoluteSpecsDir.endsWith('/') ? absoluteSpecsDir : `${absoluteSpecsDir}/`;

        if (absoluteDbFile.startsWith(prefix) || absoluteDbFile === absoluteSpecsDir) {
          if (!processedFiles.has(dbFile) && !(await this.fsDriver.exists(dbFile))) {
            await this.deleteSidecar(dbFile);
            summary.pruned++;
          }
        }
      }

      const indexedCount = await this.all<{ count: number }>(
        'SELECT COUNT(*) as count FROM sidecars;',
      );
      const total = indexedCount[0]?.count || 0;
      await this.setMetadata('total_files_indexed', String(total));
      await this.setMetadata('last_indexed_at', new Date().toISOString());
    } catch {
      // Best-effort cleanup
    }

    return summary;
  }

  /**
   * Retrieves centralized Planning Hub state and aggregated task metrics.
   */
  public async getPlanningHub(): Promise<PlanningHubSummary> {
    await this.ensureInitialized();
    const initiativesRows = await this.all<any>(
      "SELECT file_path, title, type, phase, status, status_flag, initiative FROM sidecars WHERE type IN ('initiative-plan', 'planning-map') ORDER BY file_path ASC;",
    );
    const conceptsRows = await this.all<any>(
      "SELECT file_path, title, type, phase, description FROM sidecars WHERE type = 'concept-doc' ORDER BY file_path ASC;",
    );
    const taskRows = await this.all<TaskRow>(
      'SELECT id, sidecar_path, text, completed, line_number, initiative FROM tasks ORDER BY sidecar_path ASC, line_number ASC;',
    );
    const plannedFileRows = await this.all<PlannedFileRow>(
      'SELECT id, source_doc, path, type, description, status FROM planned_files ORDER BY source_doc ASC, path ASC;',
    );

    const initiatives = initiativesRows.map((row) => {
      const docTasks = taskRows.filter((t) => t.sidecar_path === row.file_path);
      const completedCount = docTasks.filter((t) => t.completed === 1).length;
      return {
        filePath: row.file_path,
        title: row.title || row.file_path,
        type: row.type,
        phase: row.phase || 'conceptualize',
        status: row.status,
        status_flag: row.status_flag,
        totalTasks: docTasks.length,
        completedTasks: completedCount,
      };
    });

    const concepts = conceptsRows.map((row) => ({
      filePath: row.file_path,
      title: row.title || row.file_path,
      type: row.type,
      phase: row.phase || 'conceptualize',
      description: row.description || '',
    }));

    const tasks = taskRows.map((r) => ({
      id: r.id,
      sidecar_path: r.sidecar_path,
      text: r.text,
      completed: r.completed === 1,
      line_number: r.line_number,
      initiative: r.initiative,
    }));

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((t) => t.completed).length;
    const pendingTasks = totalTasks - completedTasks;
    const taskCompletionRate =
      totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 100;

    return {
      initiatives,
      concepts,
      tasks,
      plannedFiles: plannedFileRows,
      summary: {
        totalInitiatives: initiatives.length,
        totalConcepts: concepts.length,
        totalTasks,
        completedTasks,
        pendingTasks,
        taskCompletionRate,
      },
    };
  }

  /**
   * Retrieves repository-wide 5-Phase Lifecycle status matrix and summary counts.
   */
  public async getPhaseStatus(): Promise<PhaseStatusReport> {
    await this.ensureInitialized();
    const rows = await this.all<any>(
      'SELECT file_path, title, type, phase, status, status_flag FROM sidecars ORDER BY file_path ASC;',
    );

    const matrix: Record<string, string> = {};
    const summary: Record<string, number> = {
      conceptualize: 0,
      grill: 0,
      spec: 0,
      materialize: 0,
      sand: 0,
      total: rows.length,
    };

    const sidecars = rows.map((r) => {
      const rawPhase = (r.phase || 'spec').toLowerCase();
      let normalizedPhase = 'spec';
      if (rawPhase.includes('concept')) normalizedPhase = 'conceptualize';
      else if (rawPhase.includes('grill')) normalizedPhase = 'grill';
      else if (rawPhase.includes('spec') || rawPhase.includes('scaffold')) normalizedPhase = 'spec';
      else if (rawPhase.includes('mat')) normalizedPhase = 'materialize';
      else if (
        rawPhase.includes('sand') ||
        rawPhase.includes('clean') ||
        rawPhase.includes('audit')
      )
        normalizedPhase = 'sand';

      matrix[r.file_path] = normalizedPhase;
      if (summary[normalizedPhase] !== undefined) {
        summary[normalizedPhase]++;
      } else {
        summary[normalizedPhase] = 1;
      }

      return {
        filePath: r.file_path,
        title: r.title || r.file_path,
        type: r.type,
        phase: normalizedPhase,
        status: r.status,
        status_flag: r.status_flag,
      };
    });

    return {
      matrix,
      summary,
      sidecars,
    };
  }

  /**
   * Query structured tasks with optional filters.
   */
  public async getTasks(filter?: {
    initiative?: string;
    sidecarPath?: string;
    completed?: boolean;
  }): Promise<
    Array<{
      id: string;
      sidecar_path: string;
      text: string;
      completed: boolean;
      line_number: number | null;
      initiative: string | null;
    }>
  > {
    await this.ensureInitialized();
    let sql =
      'SELECT id, sidecar_path, text, completed, line_number, initiative FROM tasks WHERE 1=1';
    const params: any[] = [];
    if (filter?.initiative) {
      sql += ' AND initiative = ?';
      params.push(filter.initiative);
    }
    if (filter?.sidecarPath) {
      sql += ' AND sidecar_path = ?';
      params.push(filter.sidecarPath);
    }
    if (filter?.completed !== undefined) {
      sql += ' AND completed = ?';
      params.push(filter.completed ? 1 : 0);
    }
    sql += ' ORDER BY sidecar_path ASC, line_number ASC;';
    const rows = await this.all<TaskRow>(sql, params);
    return rows.map((r) => ({
      id: r.id,
      sidecar_path: r.sidecar_path,
      text: r.text,
      completed: r.completed === 1,
      line_number: r.line_number,
      initiative: r.initiative,
    }));
  }

  /**
   * Query planned files extracted from blueprints.
   */
  public async getPlannedFiles(filter?: {
    sourceDoc?: string;
    status?: string;
  }): Promise<PlannedFileRow[]> {
    await this.ensureInitialized();
    let sql = 'SELECT id, source_doc, path, type, description, status FROM planned_files WHERE 1=1';
    const params: any[] = [];
    if (filter?.sourceDoc) {
      sql += ' AND source_doc = ?';
      params.push(filter.sourceDoc);
    }
    if (filter?.status) {
      sql += ' AND status = ?';
      params.push(filter.status);
    }
    sql += ' ORDER BY source_doc ASC, path ASC;';
    return await this.all<PlannedFileRow>(sql, params);
  }

  /**
   * Retrieves unified project file tree representation merging existing and planned files.
   */
  public async getProjectFileTree(
    options: {
      includePlanned?: boolean;
      plannedOnly?: boolean;
      rootDir?: string;
    } = {},
  ): Promise<{
    existing: Array<{ path: string; title: string; phase: string; status: string }>;
    planned: PlannedFileRow[];
  }> {
    await this.ensureInitialized();
    const { includePlanned = true, plannedOnly = false } = options;

    let existing: Array<{ path: string; title: string; phase: string; status: string }> = [];
    if (!plannedOnly) {
      const rows = await this.all<any>(
        'SELECT file_path, title, phase, status FROM sidecars ORDER BY file_path ASC;',
      );
      existing = rows.map((r) => ({
        path: r.file_path,
        title: r.title || r.file_path,
        phase: r.phase || 'spec',
        status: r.status,
      }));
    }

    let planned: PlannedFileRow[] = [];
    if (includePlanned || plannedOnly) {
      planned = await this.getPlannedFiles();
    }

    return { existing, planned };
  }

  private calculateHash(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  /**
   * Retrieves all sidecar file paths currently in the database.
   */
  public async getFilesIndexed(): Promise<string[]> {
    await this.ensureInitialized();
    const rows = await this.all<{ file_path: string }>('SELECT file_path FROM sidecars;');
    return rows.map((r) => r.file_path);
  }

  /**
   * Retrieves metadata value by key from index_meta.
   */
  public async getMetadata(key: string): Promise<string | null> {
    await this.ensureInitialized();
    const row = await this.get<{ value: string }>('SELECT value FROM index_meta WHERE key = ?;', [
      key,
    ]);
    return row ? row.value : null;
  }

  /**
   * Sets metadata value for key in index_meta.
   */
  public async setMetadata(key: string, value: string): Promise<void> {
    await this.ensureInitialized();
    await this.run('INSERT OR REPLACE INTO index_meta (key, value) VALUES (?, ?);', [key, value]);
  }

  /**
   * Completely clears the persistent database index.
   */
  public async clearIndex(): Promise<void> {
    await this.ensureInitialized();
    await this.run('BEGIN TRANSACTION;');
    try {
      await this.run('DELETE FROM dependencies;');
      await this.run('DELETE FROM tags;');
      await this.run('DELETE FROM exports;');
      await this.run('DELETE FROM decisions;');
      await this.run('DELETE FROM user_notes;');
      await this.run('DELETE FROM tasks;');
      await this.run('DELETE FROM planned_files;');
      await this.run('DELETE FROM sidecars;');
      await this.run('DELETE FROM index_meta;');
      await this.run('DELETE FROM sidecar_fts;');
      await this.run('COMMIT;');
    } catch (err) {
      await this.run('ROLLBACK;');
      throw err;
    }
  }

  /**
   * Closes the database connection.
   */
  public async close(): Promise<void> {
    await this.dbDriver.close();
  }
}

/**
 * Factory function to create a GraphEngine instance based on execution environment.
 */
export function createGraphEngine(
  options: {
    fsDriver?: FileStorageDriver;
    dbDriver?: DatabaseDriver;
    dbPath?: string;
  } = {},
): GraphEngine {
  const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

  let fsDriver = options.fsDriver;
  let dbDriver = options.dbDriver;
  let dbPath = options.dbPath;

  if (!dbPath) {
    const config = loadConfig();
    dbPath = config.paths.db_path || '.stubs/graph.sqlite';
  }

  if (isNode) {
    if (!fsDriver) fsDriver = new NodeFileSystem();
    if (!dbDriver) {
      let sqlite3Available = false;
      try {
        require('sqlite3');
        sqlite3Available = true;
      } catch {
        // Fallback to WASM if native module missing
      }

      if (sqlite3Available) {
        dbDriver = new BetterSqliteDriver(dbPath);
      } else {
        dbDriver = new WasmSqliteDriver({
          dbPath: dbPath,
          fsDriver: fsDriver,
        });
      }
    }
  } else {
    if (!fsDriver) fsDriver = new VirtualFileSystem();
    if (!dbDriver) dbDriver = new WasmSqliteDriver();
  }

  return new GraphEngine({ fsDriver, dbDriver, dbPath });
}

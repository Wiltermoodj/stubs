import * as crypto from 'crypto';
import * as path from 'path';
import { OkfFrontmatter, parseOkfSpec } from '../parser/okf';
import { loadConfig } from '../config/schema';
import {
  FileSystemDriver,
  DatabaseDriver,
  NodeFileSystem,
  BetterSqliteDriver,
  VirtualFileSystem,
  WasmSqliteDriver,
} from '../storage';

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

export class GraphEngine {
  private dbPath: string;
  public fsDriver!: FileSystemDriver;
  public dbDriver!: DatabaseDriver;

  constructor(
    dbPathOrOptions?:
      | string
      | { fsDriver?: FileSystemDriver; dbDriver?: DatabaseDriver; dbPath?: string },
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
      this.dbDriver = new BetterSqliteDriver(this.dbPath);
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

    // 8. Create virtual FTS5 table with external content and configure tokenizer
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

    // 9. Create index_meta table for index-wide metadata/status
    await this.run(`
      CREATE TABLE IF NOT EXISTS index_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    // 10. Create sidecar_embeddings table for pluggable vector search engines
    await this.run(`
      CREATE TABLE IF NOT EXISTS sidecar_embeddings (
        file_path TEXT,
        engine TEXT,
        embedding TEXT, -- JSON array of floats
        PRIMARY KEY (file_path, engine)
      );
    `);
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
        await this.run('DELETE FROM sidecars WHERE file_path = ?;', [filePath]);
      }

      // 2. Insert into sidecars table
      const insertResult = await this.run(
        `INSERT INTO sidecars (
          file_path, title, type, description, module_depth, context_object,
          template_source, template_version, status, version, target_code_file,
          status_flag, stale_details, last_sync_timestamp, sidecar_hash, code_hash,
          interfaces_text, decisions_text, raw_content, tags, exports, file_hash, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP);`,
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

      // 8. Insert into FTS5 virtual table
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
      // 1. Delete from FTS5
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

      // 2. Delete from other detail tables
      await this.run(
        'DELETE FROM dependencies WHERE source_file_path = ? OR target_file_path = ?;',
        [filePath, filePath],
      );
      await this.run('DELETE FROM tags WHERE file_path = ?;', [filePath]);
      await this.run('DELETE FROM exports WHERE file_path = ?;', [filePath]);
      await this.run('DELETE FROM decisions WHERE file_path = ?;', [filePath]);
      await this.run('DELETE FROM user_notes WHERE file_path = ?;', [filePath]);
      await this.run('DELETE FROM sidecar_embeddings WHERE file_path = ?;', [filePath]);
      await this.run('DELETE FROM sidecars WHERE file_path = ?;', [filePath]);

      await this.run('COMMIT;');
    } catch (err) {
      await this.run('ROLLBACK;');
      throw err;
    }
  }

  /**
   * Retrieves single sidecar with parsed frontmatter.
   */
  public async getSidecar(filePath: string): Promise<any | null> {
    await this.ensureInitialized();
    const sidecar = await this.get('SELECT * FROM sidecars WHERE file_path = ?;', [filePath]);
    if (!sidecar) return null;

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
      'SELECT adr_id as id, summary, date FROM decisions WHERE file_path = ?;',
      [filePath],
    );
    const userNotes = await this.all<{
      note_id: string;
      timestamp: string;
      text: string;
      status: string;
    }>('SELECT note_id as id, timestamp, text, status FROM user_notes WHERE file_path = ?;', [
      filePath,
    ]);

    const depends_on = deps.filter((d) => d.type === 'depends_on').map((d) => d.target_file_path);
    const used_by = deps.filter((d) => d.type === 'used_by').map((d) => d.target_file_path);

    return {
      filePath: sidecar.file_path,
      frontmatter: {
        title: sidecar.title,
        type: sidecar.type,
        description: sidecar.description,
        tags: tags.map((t) => t.tag),
        exports: exportsList.map((e) => e.export_name),
        module_depth: sidecar.module_depth,
        context_object: sidecar.context_object,
        template_source: sidecar.template_source,
        template_version: sidecar.template_version,
        status: sidecar.status,
        version: sidecar.version,
        target_code_file: sidecar.target_code_file,
        status_flag: sidecar.status_flag,
        stale_details: sidecar.stale_details,
        sync_state: sidecar.last_sync_timestamp
          ? {
              last_sync_timestamp: sidecar.last_sync_timestamp,
              sidecar_hash: sidecar.sidecar_hash,
              code_hash: sidecar.code_hash,
            }
          : undefined,
        depends_on,
        used_by,
        decisions,
        user_notes: userNotes,
      },
      body: sidecar.raw_content,
    };
  }

  /**
   * Retrieves adjacent nodes in the graph.
   */
  public async getNeighbors(
    filePath: string,
    direction: 'dependencies' | 'dependents' | 'both' = 'both',
  ): Promise<string[]> {
    await this.ensureInitialized();

    const deps: Set<string> = new Set();

    if (direction === 'dependencies' || direction === 'both') {
      const res1 = await this.all<{ target_file_path: string }>(
        "SELECT target_file_path FROM dependencies WHERE source_file_path = ? AND type = 'depends_on';",
        [filePath],
      );
      res1.forEach((r) => deps.add(r.target_file_path));

      const res2 = await this.all<{ source_file_path: string }>(
        "SELECT source_file_path FROM dependencies WHERE target_file_path = ? AND type = 'used_by';",
        [filePath],
      );
      res2.forEach((r) => deps.add(r.source_file_path));
    }

    if (direction === 'dependents' || direction === 'both') {
      const res1 = await this.all<{ source_file_path: string }>(
        "SELECT source_file_path FROM dependencies WHERE target_file_path = ? AND type = 'depends_on';",
        [filePath],
      );
      res1.forEach((r) => deps.add(r.source_file_path));

      const res2 = await this.all<{ target_file_path: string }>(
        "SELECT target_file_path FROM dependencies WHERE source_file_path = ? AND type = 'used_by';",
        [filePath],
      );
      res2.forEach((r) => deps.add(r.target_file_path));
    }

    deps.delete(filePath);

    return Array.from(deps);
  }

  /**
   * Topological sorting of the indexed files (dependencies resolved before dependents).
   */
  public async getTopologicalSort(): Promise<string[]> {
    await this.ensureInitialized();

    const allFiles = await this.all<{ file_path: string }>('SELECT file_path FROM sidecars;');
    const filesList = allFiles.map((f) => f.file_path);

    const visited: Set<string> = new Set();
    const tempMark: Set<string> = new Set();
    const sorted: string[] = [];

    const visit = async (file: string) => {
      if (tempMark.has(file)) {
        // Cycle detected! Define errors out of existence: break the cycle silently and return.
        return;
      }
      if (!visited.has(file)) {
        tempMark.add(file);

        const dependencies = await this.getNeighbors(file, 'dependencies');
        for (const dep of dependencies) {
          await visit(dep);
        }

        tempMark.delete(file);
        visited.add(file);
        sorted.push(file);
      }
    };

    for (const file of filesList) {
      if (!visited.has(file)) {
        await visit(file);
      }
    }

    return sorted;
  }

  /**
   * Retrieves all pending user notes (directives) from the database across all sidecars.
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
      rank: row.rank !== undefined ? Number(row.rank) : 0,
    }));

    if (finalCandidateSet) {
      results = results.filter((r) => finalCandidateSet!.has(r.filePath));
    }

    if (limit !== undefined && limit > 0) {
      results = results.slice(0, limit);
    }

    return results;
  }

  /**
   * Calculates a SHA-256 hash of the content string.
   */
  private calculateHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
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
      scannedFiles = await this.fsDriver.glob(specsDir);
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
        const absoluteDbFile = path.resolve(dbFile).replace(/\\/g, '/');
        const absoluteSpecsDir = path.resolve(specsDir).replace(/\\/g, '/');
        const prefix = absoluteSpecsDir.endsWith('/') ? absoluteSpecsDir : `${absoluteSpecsDir}/`;

        if (absoluteDbFile.startsWith(prefix) || absoluteDbFile === absoluteSpecsDir) {
          if (!processedFiles.has(dbFile)) {
            await this.deleteSidecar(dbFile);
            summary.pruned++;
          }
        }
      }
    } catch (err: any) {
      summary.errors.push({
        filePath: '',
        error: `Error pruning stale database entries: ${err.message || err}`,
      });
    }

    try {
      const totalIndexed = await this.getFilesIndexed();
      await this.setMetadata('last_indexed_at', new Date().toISOString());
      await this.setMetadata('total_files_indexed', String(totalIndexed.length));
    } catch {
      // Ignore metadata saving errors
    }

    return summary;
  }

  /**
   * Returns a list of all indexed file paths.
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
    fsDriver?: FileSystemDriver;
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
    if (!dbDriver) dbDriver = new BetterSqliteDriver(dbPath);
  } else {
    if (!fsDriver) fsDriver = new VirtualFileSystem();
    if (!dbDriver) dbDriver = new WasmSqliteDriver();
  }

  return new GraphEngine({ fsDriver, dbDriver, dbPath });
}

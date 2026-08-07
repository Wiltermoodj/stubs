import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import sqlite3 from 'sqlite3';
import initSqlJs, { Database } from 'sql.js';

// --- Interfaces ---

export interface FileSystemDriver {
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  readDir(dirPath: string): Promise<string[]>;
  exists(filePath: string): Promise<boolean>;
  glob(pattern: string): Promise<string[]>;
}

export interface PreparedStatement {
  run(params?: any[]): Promise<{ lastID: number; changes: number }>;
  get<T = any>(params?: any[]): Promise<T | undefined>;
  all<T = any>(params?: any[]): Promise<T[]>;
  finalize(): Promise<void>;
}

export interface DatabaseDriver {
  initialize(): Promise<void>;
  exec(sql: string): Promise<void>;
  run(sql: string, params?: any[]): Promise<{ lastID: number; changes: number }>;
  get<T = any>(sql: string, params?: any[]): Promise<T | undefined>;
  all<T = any>(sql: string, params?: any[]): Promise<T[]>;
  prepare(sql: string): Promise<PreparedStatement>;
  close(): Promise<void>;
}

// --- Node.js Drivers ---

export class NodeFileSystem implements FileSystemDriver {
  public async readFile(filePath: string): Promise<string> {
    return await fs.readFile(filePath, 'utf8');
  }

  public async writeFile(filePath: string, content: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
  }

  public async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  public async readDir(dirPath: string): Promise<string[]> {
    return await fs.readdir(dirPath);
  }

  public async glob(pattern: string): Promise<string[]> {
    const results: string[] = [];
    const isWildcard = pattern.includes('*') || pattern.includes('?');
    let baseDir = pattern;
    const extensionPattern = /.*\.ts\.md|.*\.md$/;

    if (isWildcard) {
      const firstWildcard = pattern.search(/[*?]/);
      const partBefore = pattern.substring(0, firstWildcard);
      const lastSlash = partBefore.lastIndexOf('/');
      if (lastSlash !== -1) {
        baseDir = partBefore.substring(0, lastSlash);
      } else {
        baseDir = '.';
      }
    }

    const absBaseDir = path.resolve(baseDir);
    const recurse = async (currDir: string) => {
      try {
        const entries = await fs.readdir(currDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currDir, entry.name);
          const relativePath = path.relative(process.cwd(), fullPath).replace(/\\/g, '/');

          if (entry.isDirectory()) {
            if (
              entry.name === 'node_modules' ||
              entry.name === '.git' ||
              entry.name === '.stubs' ||
              entry.name === 'dist' ||
              entry.name === 'build'
            ) {
              continue;
            }
            await recurse(fullPath);
          } else if (entry.isFile()) {
            if (extensionPattern.test(entry.name)) {
              results.push(relativePath);
            }
          }
        }
      } catch {
        // Skip missing dirs
      }
    };

    if (fsSync.existsSync(absBaseDir)) {
      await recurse(absBaseDir);
    }
    return results;
  }
}

export class BetterSqliteDriver implements DatabaseDriver {
  private db: sqlite3.Database | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  public async initialize(): Promise<void> {
    if (this.db) return;

    const dir = path.dirname(this.dbPath);
    if (!fsSync.existsSync(dir)) {
      fsSync.mkdirSync(dir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  public async exec(sql: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    return new Promise((resolve, reject) => {
      this.db!.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public async run(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
    if (!this.db) throw new Error('Database not initialized');
    return new Promise((resolve, reject) => {
      this.db!.run(sql, params, function (this: sqlite3.RunResult, err: Error | null) {
        if (err) {
          reject(err);
        } else {
          resolve({ lastID: this.lastID, changes: this.changes });
        }
      });
    });
  }

  public async get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    if (!this.db) throw new Error('Database not initialized');
    return new Promise((resolve, reject) => {
      this.db!.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row as T | undefined);
      });
    });
  }

  public async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    if (!this.db) throw new Error('Database not initialized');
    return new Promise((resolve, reject) => {
      this.db!.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows as T[]);
      });
    });
  }

  public async prepare(sql: string): Promise<PreparedStatement> {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare(sql);
    return {
      run: (params: any[] = []) => {
        return new Promise((resolve, reject) => {
          stmt.run(params, function (this: sqlite3.RunResult, err: Error | null) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
          });
        });
      },
      get: <T = any>(params: any[] = []): Promise<T | undefined> => {
        return new Promise<T | undefined>((resolve, reject) => {
          stmt.get(params, (err, row) => {
            if (err) reject(err);
            else resolve(row as T | undefined);
          });
        });
      },
      all: <T = any>(params: any[] = []): Promise<T[]> => {
        return new Promise<T[]>((resolve, reject) => {
          stmt.all(params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows as T[]);
          });
        });
      },
      finalize: () => {
        return new Promise((resolve, reject) => {
          stmt.finalize((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      },
    };
  }

  public async close(): Promise<void> {
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      this.db!.close((err) => {
        if (err) reject(err);
        else {
          this.db = null;
          resolve();
        }
      });
    });
  }
}

// --- Virtual & WASM Drivers ---

export class VirtualFileSystem implements FileSystemDriver {
  private files = new Map<string, string>();

  constructor(initialFiles?: Record<string, string>) {
    if (initialFiles) {
      for (const [p, content] of Object.entries(initialFiles)) {
        this.files.set(this.normalizePath(p), content);
      }
    }
  }

  private normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
  }

  public async readFile(filePath: string): Promise<string> {
    const norm = this.normalizePath(filePath);
    const content = this.files.get(norm);
    if (content === undefined) {
      throw new Error(`File not found: ${filePath}`);
    }
    return content;
  }

  public async writeFile(filePath: string, content: string): Promise<void> {
    const norm = this.normalizePath(filePath);
    this.files.set(norm, content);
  }

  public async exists(filePath: string): Promise<boolean> {
    const norm = this.normalizePath(filePath);
    if (this.files.has(norm)) {
      return true;
    }
    const dirPrefix = norm.endsWith('/') ? norm : `${norm}/`;
    for (const key of this.files.keys()) {
      if (key.startsWith(dirPrefix)) {
        return true;
      }
    }
    return false;
  }

  public async readDir(dirPath: string): Promise<string[]> {
    const normDir = this.normalizePath(dirPath);
    const prefix = normDir.endsWith('/') ? normDir : `${normDir}/`;
    const results = new Set<string>();
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        const relative = key.slice(prefix.length);
        const firstSegment = relative.split('/')[0];
        if (firstSegment) {
          results.add(firstSegment);
        }
      }
    }
    return Array.from(results);
  }

  public async glob(pattern: string): Promise<string[]> {
    const results: string[] = [];
    const normPattern = this.normalizePath(pattern);
    const isWildcard = normPattern.includes('*');

    if (!isWildcard) {
      const prefix = normPattern.endsWith('/') ? normPattern : `${normPattern}/`;
      for (const key of this.files.keys()) {
        if (key.startsWith(prefix) && (key.endsWith('.md') || key.endsWith('.ts.md'))) {
          results.push(key);
        }
      }
    } else {
      const regexStr = normPattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\//g, '([^/]*/)*')
        .replace(/\*/g, '[^/]*');
      const regex = new RegExp(`^${regexStr}$`);

      for (const key of this.files.keys()) {
        if (regex.test(key)) {
          results.push(key);
        }
      }
    }
    return results;
  }
}

export class WasmSqliteDriver implements DatabaseDriver {
  private db: Database | null = null;
  private isFts5Supported = false;

  public async initialize(): Promise<void> {
    if (this.db) return;
    const SQL = await initSqlJs();
    this.db = new SQL.Database();

    try {
      this.db.run('CREATE VIRTUAL TABLE fts_test USING fts5(x); DROP TABLE fts_test;');
      this.isFts5Supported = true;
    } catch {
      this.isFts5Supported = false;
    }
  }

  private preprocessSql(sql: string, params: any[]): { sql: string; params: any[] } {
    if (this.isFts5Supported) {
      return { sql, params };
    }

    let outSql = sql;
    let outParams = params;

    if (outSql.includes('CREATE VIRTUAL TABLE') && outSql.includes('USING fts5')) {
      outSql = `
        CREATE TABLE IF NOT EXISTS sidecar_fts (
          rowid INTEGER PRIMARY KEY,
          file_path TEXT,
          title TEXT,
          description TEXT,
          tags TEXT,
          exports TEXT,
          interfaces_text TEXT,
          decisions_text TEXT
        );
      `;
      outParams = [];
    }

    if (outSql.includes('INSERT INTO sidecar_fts(sidecar_fts, rowid')) {
      outSql = 'DELETE FROM sidecar_fts WHERE rowid = ?;';
      outParams = [params[0]];
    }

    return { sql: outSql, params: outParams };
  }

  public async exec(sql: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const prep = this.preprocessSql(sql, []);
    this.db.exec(prep.sql);
  }

  public async run(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
    if (!this.db) throw new Error('Database not initialized');
    const prep = this.preprocessSql(sql, params);

    const stmt = this.db.prepare(prep.sql);
    if (prep.params.length > 0) {
      stmt.bind(prep.params);
    }
    stmt.step();
    stmt.free();

    const res = this.db.exec('SELECT last_insert_rowid() as id, changes() as changes;');
    let lastID = 0;
    let changes = 0;
    if (res && res[0]) {
      lastID = Number(res[0].values[0][0]);
      changes = Number(res[0].values[0][1]);
    }

    return { lastID, changes };
  }

  public async get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    if (!this.db) throw new Error('Database not initialized');
    const prep = this.preprocessSql(sql, params);
    const stmt = this.db.prepare(prep.sql);
    let result: T | undefined;
    if (prep.params.length > 0) {
      stmt.bind(prep.params);
    }
    if (stmt.step()) {
      result = stmt.getAsObject() as any as T;
    }
    stmt.free();
    return result;
  }

  public async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    if (!this.db) throw new Error('Database not initialized');
    const prep = this.preprocessSql(sql, params);
    const stmt = this.db.prepare(prep.sql);
    const results: T[] = [];

    if (prep.params.length > 0) {
      stmt.bind(prep.params);
    }
    while (stmt.step()) {
      results.push(stmt.getAsObject() as any as T);
    }
    stmt.free();
    return results;
  }

  public async prepare(sql: string): Promise<PreparedStatement> {
    if (!this.db) throw new Error('Database not initialized');

    const self = this;

    return {
      run: async (params: any[] = []) => {
        const prep = self.preprocessSql(sql, params);
        const stmt = self.db!.prepare(prep.sql);
        if (prep.params.length > 0) {
          stmt.bind(prep.params);
        }
        stmt.step();
        stmt.free();

        const res = self.db!.exec('SELECT last_insert_rowid() as id, changes() as changes;');
        let lastID = 0;
        let changes = 0;
        if (res && res[0]) {
          lastID = Number(res[0].values[0][0]);
          changes = Number(res[0].values[0][1]);
        }
        return { lastID, changes };
      },
      get: async <T = any>(params: any[] = []): Promise<T | undefined> => {
        const prep = self.preprocessSql(sql, params);
        const stmt = self.db!.prepare(prep.sql);
        let result: T | undefined;
        if (prep.params.length > 0) {
          stmt.bind(prep.params);
        }
        if (stmt.step()) {
          result = stmt.getAsObject() as any as T;
        }
        stmt.free();
        return result;
      },
      all: async <T = any>(params: any[] = []): Promise<T[]> => {
        const prep = self.preprocessSql(sql, params);
        const stmt = self.db!.prepare(prep.sql);
        const results: T[] = [];
        if (prep.params.length > 0) {
          stmt.bind(prep.params);
        }
        while (stmt.step()) {
          results.push(stmt.getAsObject() as any as T);
        }
        stmt.free();
        return results;
      },
      finalize: async () => {}
    };
  }

  public async close(): Promise<void> {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }
}

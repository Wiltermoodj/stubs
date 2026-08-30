import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import initSqlJs, { Database } from 'sql.js';

let sqlite3: any;
try {
  sqlite3 = require('sqlite3');
} catch {
  // Ignored, fallback handles loading
}

// --- Interfaces ---

export interface FileStorageDriver {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readFileBuffer?(path: string): Promise<Uint8Array | Buffer>;
  writeFileBuffer?(path: string, content: Uint8Array | Buffer): Promise<void>;
  exists(path: string): Promise<boolean>;
  readDir(path: string): Promise<string[]>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
}

export interface FileSystemDriver extends FileStorageDriver {
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
  transaction?<T>(fn: () => Promise<T>): Promise<T>;
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

  public async readFileBuffer(filePath: string): Promise<Buffer> {
    return await fs.readFile(filePath);
  }

  public async writeFileBuffer(filePath: string, content: Uint8Array | Buffer): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, content);
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

  public async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.mkdir(dirPath, options || { recursive: true });
  }

  public async glob(pattern: string): Promise<string[]> {
    const results: string[] = [];
    const isWildcard = pattern.includes('*') || pattern.includes('?');
    let baseDir = pattern;

    let regex: RegExp | null = null;
    if (isWildcard) {
      const normalizedPattern = pattern.replace(/\\/g, '/');
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
            if (regex) {
              if (regex.test(relativePath)) {
                results.push(relativePath);
              }
            } else {
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

export class NodeFileSystemDriver extends NodeFileSystem implements FileStorageDriver {}

export class BetterSqliteDriver implements DatabaseDriver {
  private db: any = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  public async initialize(): Promise<void> {
    if (this.db) return;
    if (!sqlite3) {
      throw new Error('Native sqlite3 module is not available.');
    }

    const dir = path.dirname(this.dbPath);
    if (!fsSync.existsSync(dir)) {
      fsSync.mkdirSync(dir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err: any) => {
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
      this.db!.exec(sql, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public async run(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
    if (!this.db) throw new Error('Database not initialized');
    return new Promise((resolve, reject) => {
      this.db!.run(sql, params, function (this: any, err: Error | null) {
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
      this.db!.get(sql, params, (err: any, row: any) => {
        if (err) reject(err);
        else resolve(row as T | undefined);
      });
    });
  }

  public async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    if (!this.db) throw new Error('Database not initialized');
    return new Promise((resolve, reject) => {
      this.db!.all(sql, params, (err: any, rows: any) => {
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
          stmt.run(params, function (this: any, err: Error | null) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
          });
        });
      },
      get: <T = any>(params: any[] = []): Promise<T | undefined> => {
        return new Promise<T | undefined>((resolve, reject) => {
          stmt.get(params, (err: any, row: any) => {
            if (err) reject(err);
            else resolve(row as T | undefined);
          });
        });
      },
      all: <T = any>(params: any[] = []): Promise<T[]> => {
        return new Promise<T[]>((resolve, reject) => {
          stmt.all(params, (err: any, rows: any) => {
            if (err) reject(err);
            else resolve(rows as T[]);
          });
        });
      },
      finalize: () => {
        return new Promise((resolve, reject) => {
          stmt.finalize((err: any) => {
            if (err) reject(err);
            else resolve();
          });
        });
      },
    };
  }

  public async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.exec('BEGIN TRANSACTION;');
    try {
      const res = await fn();
      await this.exec('COMMIT;');
      return res;
    } catch (err) {
      await this.exec('ROLLBACK;');
      throw err;
    }
  }

  public async close(): Promise<void> {
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      this.db!.close((err: any) => {
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
  private bufferFiles = new Map<string, Uint8Array>();

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
    if (content !== undefined) {
      return content;
    }
    const buf = this.bufferFiles.get(norm);
    if (buf !== undefined) {
      return Buffer.from(buf).toString('utf8');
    }
    throw new Error(`File not found: ${filePath}`);
  }

  public async writeFile(filePath: string, content: string): Promise<void> {
    const norm = this.normalizePath(filePath);
    this.files.set(norm, content);
    this.bufferFiles.delete(norm);
  }

  public async readFileBuffer(filePath: string): Promise<Uint8Array> {
    const norm = this.normalizePath(filePath);
    const buf = this.bufferFiles.get(norm);
    if (buf !== undefined) {
      return buf;
    }
    const content = this.files.get(norm);
    if (content !== undefined) {
      return Buffer.from(content, 'utf8');
    }
    throw new Error(`File not found: ${filePath}`);
  }

  public async writeFileBuffer(filePath: string, content: Uint8Array | Buffer): Promise<void> {
    const norm = this.normalizePath(filePath);
    const copy = new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
    this.bufferFiles.set(norm, copy);
    this.files.delete(norm);
  }

  public async exists(filePath: string): Promise<boolean> {
    const norm = this.normalizePath(filePath);
    if (this.files.has(norm) || this.bufferFiles.has(norm)) {
      return true;
    }
    const dirPrefix = norm.endsWith('/') ? norm : `${norm}/`;
    for (const key of this.files.keys()) {
      if (key.startsWith(dirPrefix)) {
        return true;
      }
    }
    for (const key of this.bufferFiles.keys()) {
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

  public async mkdir(_dirPath: string, _options?: { recursive?: boolean }): Promise<void> {
    // Virtual file system manages paths implicitly
  }

  public async glob(pattern: string): Promise<string[]> {
    const results: string[] = [];
    const normPattern = this.normalizePath(pattern);
    const isWildcard = normPattern.includes('*') || normPattern.includes('?');

    if (!isWildcard) {
      const prefix = normPattern.endsWith('/') ? normPattern : `${normPattern}/`;
      for (const key of this.files.keys()) {
        if (key.startsWith(prefix) || key === normPattern) {
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

export class MemoryVirtualFileSystemDriver extends VirtualFileSystem implements FileStorageDriver {}

export class WasmSqliteDriver implements DatabaseDriver {
  private db: Database | null = null;
  private isFts5Supported = false;
  private dbPath?: string;
  private fsDriver?: FileStorageDriver;
  private initialData?: Uint8Array;

  constructor(options?: {
    dbPath?: string;
    fsDriver?: FileStorageDriver;
    initialData?: Uint8Array;
  }) {
    this.dbPath = options?.dbPath;
    this.fsDriver = options?.fsDriver;
    this.initialData = options?.initialData;
  }

  public async initialize(): Promise<void> {
    if (this.db) return;
    const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
    const SQL = await initSqlJs({
      locateFile: (file) => {
        if (isNode) {
          const possiblePaths = [
            path.join(__dirname, file),
            path.join(__dirname, '../../node_modules/sql.js/dist', file),
            path.join(process.cwd(), 'node_modules/sql.js/dist', file),
            path.join(process.cwd(), '.agents/skills/stubs/dist', file),
          ];
          for (const p of possiblePaths) {
            if (fsSync.existsSync(p)) {
              return p;
            }
          }
          return path.join(__dirname, file);
        }
        return file;
      },
    });

    let data: Uint8Array | undefined = this.initialData;

    if (!data && this.dbPath && this.fsDriver) {
      try {
        if (await this.fsDriver.exists(this.dbPath)) {
          if (typeof this.fsDriver.readFileBuffer === 'function') {
            const buf = await this.fsDriver.readFileBuffer(this.dbPath);
            data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
          } else {
            const content = await this.fsDriver.readFile(this.dbPath);
            if (content) {
              data = new Uint8Array(content.length);
              for (let i = 0; i < content.length; i++) {
                data[i] = content.charCodeAt(i) & 0xff;
              }
            }
          }
        }
      } catch {
        // Fall back to empty database if reading fails
      }
    }

    if (data) {
      this.db = new SQL.Database(data);
    } else {
      this.db = new SQL.Database();
    }

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

    return {
      run: async (params: any[] = []) => {
        const prep = this.preprocessSql(sql, params);
        const stmt = this.db!.prepare(prep.sql);
        if (prep.params.length > 0) {
          stmt.bind(prep.params);
        }
        stmt.step();
        stmt.free();

        const res = this.db!.exec('SELECT last_insert_rowid() as id, changes() as changes;');
        let lastID = 0;
        let changes = 0;
        if (res && res[0]) {
          lastID = Number(res[0].values[0][0]);
          changes = Number(res[0].values[0][1]);
        }
        return { lastID, changes };
      },
      get: async <T = any>(params: any[] = []): Promise<T | undefined> => {
        const prep = this.preprocessSql(sql, params);
        const stmt = this.db!.prepare(prep.sql);
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
        const prep = this.preprocessSql(sql, params);
        const stmt = this.db!.prepare(prep.sql);
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
      finalize: async () => {},
    };
  }

  public async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.exec('BEGIN TRANSACTION;');
    try {
      const res = await fn();
      await this.exec('COMMIT;');
      return res;
    } catch (err) {
      await this.exec('ROLLBACK;');
      throw err;
    }
  }

  public async close(): Promise<void> {
    if (!this.db) return;

    if (this.dbPath && this.fsDriver) {
      try {
        const data = this.db.export();
        if (typeof this.fsDriver.writeFileBuffer === 'function') {
          await this.fsDriver.writeFileBuffer(this.dbPath, data);
        } else {
          let content = '';
          const batchSize = 8192;
          for (let i = 0; i < data.length; i += batchSize) {
            content += String.fromCharCode.apply(null, data.subarray(i, i + batchSize) as any);
          }
          await this.fsDriver.writeFile(this.dbPath, content);
        }
      } catch {
        // Ignore persist errors
      }
    }

    this.db.close();
    this.db = null;
  }
}

import * as fs from 'fs';
import * as path from 'path';
import { GraphEngine, SidecarInput } from '../src/graph/engine';
import { OkfFrontmatter } from '../src/parser/okf';

describe('Graph Adjacency & SQLite Search Engine', () => {
  const dbPath = path.resolve(__dirname, 'temp_test_graph.sqlite');
  const workspacePath = path.resolve(__dirname, 'temp_workspace_for_index');
  let engine: GraphEngine;

  beforeEach(async () => {
    // Ensure clean state before each test
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    if (fs.existsSync(workspacePath)) {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }
    engine = new GraphEngine(dbPath);
    await engine.initialize();
  });

  afterEach(async () => {
    if (engine) {
      await engine.close();
    }
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    if (fs.existsSync(workspacePath)) {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  test('should successfully initialize all schema tables and FTS5 index', async () => {
    // Query sqlite_master to verify tables exist
    const tables = await engine.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' OR type='view';",
    );
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain('sidecars');
    expect(tableNames).toContain('dependencies');
    expect(tableNames).toContain('tags');
    expect(tableNames).toContain('exports');
    expect(tableNames).toContain('decisions');
    expect(tableNames).toContain('user_notes');
    expect(tableNames).toContain('sidecar_fts');
  });

  test('should support getPendingDirectives to retrieve pending user notes across sidecars', async () => {
    const specWithDirectives: OkfFrontmatter = {
      title: 'Directives Spec',
      type: 'sidecar-spec',
      description: 'Spec with some user notes',
      tags: [],
      status: 'spec',
      version: 1,
      target_code_file: './dir.ts',
      status_flag: 'clean',
      user_notes: [
        {
          id: 'NOTE-1',
          timestamp: '2026-08-05T12:00:00Z',
          text: 'This is pending',
          status: 'pending',
        },
        {
          id: 'NOTE-2',
          timestamp: '2026-08-05T13:00:00Z',
          text: 'This is completed',
          status: 'completed',
        },
      ],
    };

    await engine.upsertSidecar({
      filePath: 'src/directives.ts.md',
      frontmatter: specWithDirectives,
      body: '',
    });

    const pending = await engine.getPendingDirectives();
    expect(pending.length).toBe(1);
    expect(pending[0]).toEqual({
      filePath: 'src/directives.ts.md',
      id: 'NOTE-1',
      timestamp: '2026-08-05T12:00:00Z',
      text: 'This is pending',
      status: 'pending',
    });
  });

  test('should support the full indexing CRUD lifecycle of a sidecar specification', async () => {
    const testFrontmatter: OkfFrontmatter = {
      title: 'JWT Authentication Spec',
      type: 'sidecar-spec',
      description: 'Handles JWT validation and signing',
      tags: ['auth', 'security', 'jwt'],
      module_depth: 'deep',
      context_object: 'AuthContext',
      status: 'spec',
      version: 1,
      target_code_file: './jwt.ts',
      status_flag: 'clean',
      depends_on: ['src/config/env.ts.md'],
      used_by: ['src/middleware/authGuard.ts.md'],
      decisions: [
        {
          id: 'DEC-001',
          summary: 'Use ES256 key signing',
          date: '2026-08-05',
        },
      ],
      user_notes: [
        {
          id: 'NOTE-01',
          timestamp: '2026-08-05T18:00:00Z',
          text: 'Handle TokenExpiredError internally',
          status: 'pending',
        },
      ],
    };

    const testBody = `
# JWT Specification

## Interfaces & Types
\`\`\`typescript
export interface AuthContext {
  userId: string;
  roles: string[];
}
\`\`\`
`;

    const input: SidecarInput = {
      filePath: 'src/auth/jwt.ts.md',
      frontmatter: testFrontmatter,
      body: testBody,
    };

    // 1. Create (Upsert)
    await engine.upsertSidecar(input);

    // 2. Read
    const retrieved = await engine.getSidecar('src/auth/jwt.ts.md');
    expect(retrieved).not.toBeNull();
    expect(retrieved.filePath).toBe('src/auth/jwt.ts.md');
    expect(retrieved.frontmatter.title).toBe('JWT Authentication Spec');
    expect(retrieved.frontmatter.tags.sort()).toEqual(['auth', 'security', 'jwt'].sort());
    expect(retrieved.frontmatter.depends_on.sort()).toEqual(['src/config/env.ts.md'].sort());
    expect(retrieved.frontmatter.used_by.sort()).toEqual(['src/middleware/authGuard.ts.md'].sort());
    expect(retrieved.frontmatter.decisions).toEqual([
      { id: 'DEC-001', summary: 'Use ES256 key signing', date: '2026-08-05' },
    ]);
    expect(retrieved.frontmatter.user_notes).toEqual([
      {
        id: 'NOTE-01',
        timestamp: '2026-08-05T18:00:00Z',
        text: 'Handle TokenExpiredError internally',
        status: 'pending',
      },
    ]);
    expect(retrieved.body).toBe(testBody);

    // 3. Update (Upsert again with changes)
    const updatedFrontmatter: OkfFrontmatter = {
      ...testFrontmatter,
      title: 'JWT Spec V2',
      tags: ['auth', 'jwt-updated'], // changed tags
      depends_on: [], // cleared dependencies
    };
    await engine.upsertSidecar({
      filePath: 'src/auth/jwt.ts.md',
      frontmatter: updatedFrontmatter,
      body: testBody,
    });

    const retrievedUpdated = await engine.getSidecar('src/auth/jwt.ts.md');
    expect(retrievedUpdated.frontmatter.title).toBe('JWT Spec V2');
    expect(retrievedUpdated.frontmatter.tags.sort()).toEqual(['auth', 'jwt-updated'].sort());
    expect(retrievedUpdated.frontmatter.depends_on).toEqual([]);

    // Check that old tags were cleaned up from the physical tags table
    const tagsInDb = await engine.all<{ tag: string }>(
      'SELECT tag FROM tags WHERE file_path = ?;',
      ['src/auth/jwt.ts.md'],
    );
    expect(tagsInDb.map((t) => t.tag).sort()).toEqual(['auth', 'jwt-updated'].sort());

    // 4. Delete
    await engine.deleteSidecar('src/auth/jwt.ts.md');
    const retrievedDeleted = await engine.getSidecar('src/auth/jwt.ts.md');
    expect(retrievedDeleted).toBeNull();

    // Check CASCADE deletion worked
    const remainingTags = await engine.all('SELECT * FROM tags WHERE file_path = ?;', [
      'src/auth/jwt.ts.md',
    ]);
    expect(remainingTags.length).toBe(0);
  });

  test('should build the topological graph and support bi-directional neighbor queries', async () => {
    // Create three files: A depends on B, B depends on C
    const specA: OkfFrontmatter = {
      title: 'Spec A',
      type: 'sidecar-spec',
      description: 'Spec A',
      tags: [],
      status: 'spec',
      version: 1,
      target_code_file: './a.ts',
      status_flag: 'clean',
      depends_on: ['src/b.ts.md'],
    };

    const specB: OkfFrontmatter = {
      title: 'Spec B',
      type: 'sidecar-spec',
      description: 'Spec B',
      tags: [],
      status: 'spec',
      version: 1,
      target_code_file: './b.ts',
      status_flag: 'clean',
      depends_on: ['src/c.ts.md'],
    };

    const specC: OkfFrontmatter = {
      title: 'Spec C',
      type: 'sidecar-spec',
      description: 'Spec C',
      tags: [],
      status: 'spec',
      version: 1,
      target_code_file: './c.ts',
      status_flag: 'clean',
    };

    await engine.upsertSidecar({ filePath: 'src/a.ts.md', frontmatter: specA, body: '' });
    await engine.upsertSidecar({ filePath: 'src/b.ts.md', frontmatter: specB, body: '' });
    await engine.upsertSidecar({ filePath: 'src/c.ts.md', frontmatter: specC, body: '' });

    // Neighbors of B
    const bDeps = await engine.getNeighbors('src/b.ts.md', 'dependencies');
    expect(bDeps).toEqual(['src/c.ts.md']);

    const bDependents = await engine.getNeighbors('src/b.ts.md', 'dependents');
    expect(bDependents).toEqual(['src/a.ts.md']);

    const bBoth = await engine.getNeighbors('src/b.ts.md', 'both');
    expect(bBoth.sort()).toEqual(['src/a.ts.md', 'src/c.ts.md'].sort());

    // Topological Sort: C comes before B, which comes before A
    const sorted = await engine.getTopologicalSort();
    expect(sorted).toEqual(['src/c.ts.md', 'src/b.ts.md', 'src/a.ts.md']);
  });

  test('should handle cycles gracefully in topological sort without infinite loops', async () => {
    // Create cycle: A depends on B, B depends on A
    const specA: OkfFrontmatter = {
      title: 'Spec A',
      type: 'sidecar-spec',
      description: 'Spec A',
      tags: [],
      status: 'spec',
      version: 1,
      target_code_file: './a.ts',
      status_flag: 'clean',
      depends_on: ['src/b.ts.md'],
    };

    const specB: OkfFrontmatter = {
      title: 'Spec B',
      type: 'sidecar-spec',
      description: 'Spec B',
      tags: [],
      status: 'spec',
      version: 1,
      target_code_file: './b.ts',
      status_flag: 'clean',
      depends_on: ['src/a.ts.md'],
    };

    await engine.upsertSidecar({ filePath: 'src/a.ts.md', frontmatter: specA, body: '' });
    await engine.upsertSidecar({ filePath: 'src/b.ts.md', frontmatter: specB, body: '' });

    // Should complete sorting without throwing errors
    const sorted = await engine.getTopologicalSort();
    expect(sorted.length).toBe(2);
    expect(sorted.sort()).toEqual(['src/a.ts.md', 'src/b.ts.md'].sort());
  });

  test('should support priority-based searching: bounds, tags, and FTS5 ranking', async () => {
    const specJwt: OkfFrontmatter = {
      title: 'JWT Auth Handlers',
      type: 'sidecar-spec',
      description: 'Cryptographic token issuance and signing.',
      tags: ['auth', 'security'],
      status: 'spec',
      version: 1,
      target_code_file: './jwt.ts',
      status_flag: 'clean',
    };
    const bodyJwt = '```typescript\nexport interface AuthContext { userId: string }\n```';

    const specSession: OkfFrontmatter = {
      title: 'Session Management',
      type: 'sidecar-spec',
      description: 'Stateful user session checks.',
      tags: ['auth'],
      status: 'spec',
      version: 1,
      target_code_file: './session.ts',
      status_flag: 'clean',
    };

    const specConfig: OkfFrontmatter = {
      title: 'Project Environment Config',
      type: 'sidecar-spec',
      description: 'Loads secret variables and keys.',
      tags: ['config', 'security'],
      status: 'spec',
      version: 1,
      target_code_file: './config.ts',
      status_flag: 'clean',
    };

    await engine.upsertSidecar({
      filePath: 'src/auth/jwt.ts.md',
      frontmatter: specJwt,
      body: bodyJwt,
    });
    await engine.upsertSidecar({
      filePath: 'src/auth/session.ts.md',
      frontmatter: specSession,
      body: '',
    });
    await engine.upsertSidecar({
      filePath: 'src/config/env.ts.md',
      frontmatter: specConfig,
      body: '',
    });

    // 1. FTS5 BM25 search matching interfaces text
    const searchRes1 = await engine.search('AuthContext');
    expect(searchRes1.length).toBeGreaterThanOrEqual(1);
    expect(searchRes1.some((r) => r.filePath === 'src/auth/jwt.ts.md')).toBe(true);

    // 2. FTS5 query matching title/description
    const searchRes2 = await engine.search('Cryptographic');
    expect(searchRes2.length).toBeGreaterThanOrEqual(1);
    expect(searchRes2.some((r) => r.filePath === 'src/auth/jwt.ts.md')).toBe(true);

    // 3. Filter by tag
    const searchRes3 = await engine.search('', { tags: ['security'] });
    expect(searchRes3.length).toBe(2);
    const filePaths3 = searchRes3.map((r) => r.filePath);
    expect(filePaths3).toContain('src/auth/jwt.ts.md');
    expect(filePaths3).toContain('src/config/env.ts.md');

    // Filter by multiple tags
    const searchResMultiTag = await engine.search('', { tags: ['security', 'auth'] });
    expect(searchResMultiTag.length).toBe(1);
    expect(searchResMultiTag.some((r) => r.filePath === 'src/auth/jwt.ts.md')).toBe(true);

    // 4. Filter by bounds (directory subsystem)
    const searchRes4 = await engine.search('', { bounds: ['src/auth'] });
    expect(searchRes4.length).toBeGreaterThanOrEqual(2);
    const filePaths4 = searchRes4.map((r) => r.filePath);
    expect(filePaths4).toContain('src/auth/jwt.ts.md');
    expect(filePaths4).toContain('src/auth/session.ts.md');
    expect(filePaths4).not.toContain('src/config/env.ts.md');

    // 5. Combined Bounds + Tag + Query
    const searchRes5 = await engine.search('token', {
      bounds: ['src/auth'],
      tags: ['security'],
    });
    expect(searchRes5.length).toBe(1);
    expect(searchRes5.some((r) => r.filePath === 'src/auth/jwt.ts.md')).toBe(true);
  });

  test('should recursively scan, index, prune, and clear workspace specifications', async () => {
    // 1. Setup workspace directory structure and files
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.mkdirSync(path.join(workspacePath, 'sub'), { recursive: true });
    fs.mkdirSync(path.join(workspacePath, 'node_modules'), { recursive: true }); // should be ignored

    const validSpecA = `---
title: "Spec A"
type: "sidecar-spec"
description: "Desc A"
tags: ["test"]
status: "spec"
version: 1
target_code_file: "./a.ts"
status_flag: "clean"
---
# Spec A
`;

    const validSpecB = `---
title: "Spec B"
type: "sidecar-spec"
description: "Desc B"
tags: ["test", "sub"]
status: "spec"
version: 1
target_code_file: "./sub/b.ts"
status_flag: "clean"
---
# Spec B
`;

    const nonOkfFile = `# Normal MD
This is a standard markdown file, not an OKF sidecar.
`;

    const invalidSpec = `---
title: "Invalid Spec"
type: "sidecar-spec"
# Missing other required fields
---
# Invalid
`;

    // Write files with paths relative to current directory
    const fileAPathRel = path
      .relative(process.cwd(), path.join(workspacePath, 'a.ts.md'))
      .replace(/\\/g, '/');
    const fileBPathRel = path
      .relative(process.cwd(), path.join(workspacePath, 'sub/b.md'))
      .replace(/\\/g, '/');
    const invalidPathRel = path
      .relative(process.cwd(), path.join(workspacePath, 'invalid.ts.md'))
      .replace(/\\/g, '/');

    fs.writeFileSync(path.join(workspacePath, 'a.ts.md'), validSpecA);
    fs.writeFileSync(path.join(workspacePath, 'sub/b.md'), validSpecB);
    fs.writeFileSync(path.join(workspacePath, 'node_modules/c.ts.md'), validSpecA); // in ignored folder
    fs.writeFileSync(path.join(workspacePath, 'normal.md'), nonOkfFile); // non-OKF, should be skipped
    fs.writeFileSync(path.join(workspacePath, 'invalid.ts.md'), invalidSpec); // invalid frontmatter, should record error

    // 2. Perform initial index Workspace
    const summary1 = await engine.indexWorkspace(workspacePath);
    expect(summary1.scanned).toBe(4); // a.ts.md, sub/b.md, normal.md, invalid.ts.md (node_modules is ignored)
    expect(summary1.indexed).toBe(2); // a.ts.md and sub/b.md (normal.md is skipped, invalid.ts.md has error)
    expect(summary1.pruned).toBe(0);
    expect(summary1.errors.length).toBe(1);
    expect(summary1.errors[0].filePath).toBe(invalidPathRel);

    // Verify files were indexed
    const indexedFiles = await engine.getFilesIndexed();
    expect(indexedFiles.sort()).toEqual([fileAPathRel, fileBPathRel].sort());

    const retrievedA = await engine.getSidecar(fileAPathRel);
    expect(retrievedA).not.toBeNull();
    expect(retrievedA.frontmatter.title).toBe('Spec A');

    // Verify metadata was stored
    const totalMetadata = await engine.getMetadata('total_files_indexed');
    expect(totalMetadata).toBe('2');
    const lastIndexedAt = await engine.getMetadata('last_indexed_at');
    expect(lastIndexedAt).not.toBeNull();
    expect(new Date(lastIndexedAt!).getTime()).not.toBeNaN();

    // 3. Test Incremental Indexing (no changes)
    const summary2 = await engine.indexWorkspace(workspacePath);
    expect(summary2.scanned).toBe(4);
    expect(summary2.indexed).toBe(0); // 0 because file hashes matched!
    expect(summary2.errors.length).toBe(1);

    // 4. Test Incremental Indexing (one file changed)
    const updatedSpecA = validSpecA.replace('Desc A', 'Updated Desc A');
    fs.writeFileSync(path.join(workspacePath, 'a.ts.md'), updatedSpecA);

    const summary3 = await engine.indexWorkspace(workspacePath);
    expect(summary3.indexed).toBe(1); // Only file A updated!
    expect(summary3.errors.length).toBe(1);

    const retrievedAUpdated = await engine.getSidecar(fileAPathRel);
    expect(retrievedAUpdated.frontmatter.description).toBe('Updated Desc A');

    // 5. Test Pruning (delete file sub/b.md and remove invalid file)
    fs.unlinkSync(path.join(workspacePath, 'sub/b.md'));
    fs.unlinkSync(path.join(workspacePath, 'invalid.ts.md'));

    const summary4 = await engine.indexWorkspace(workspacePath);
    expect(summary4.scanned).toBe(2); // a.ts.md, normal.md
    expect(summary4.indexed).toBe(0);
    expect(summary4.pruned).toBe(1); // sub/b.md is pruned!
    expect(summary4.errors.length).toBe(0);

    const remainingFiles = await engine.getFilesIndexed();
    expect(remainingFiles).toEqual([fileAPathRel]);

    const retrievedBDeleted = await engine.getSidecar(fileBPathRel);
    expect(retrievedBDeleted).toBeNull();

    // 6. Test Clear Index
    await engine.clearIndex();
    const finalFiles = await engine.getFilesIndexed();
    expect(finalFiles.length).toBe(0);

    const metadataAfterClear = await engine.getMetadata('total_files_indexed');
    expect(metadataAfterClear).toBeNull();
  });
});

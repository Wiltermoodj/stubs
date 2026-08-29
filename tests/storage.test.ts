import * as path from 'path';
import * as fs from 'fs/promises';
import { GraphEngine, createGraphEngine } from '../src/graph/engine';
import {
  VirtualFileSystem,
  WasmSqliteDriver,
  NodeFileSystem,
  BetterSqliteDriver,
} from '../src/storage';

describe('Storage Drivers & WASM Graph Integration', () => {
  const tempSpecsDir = 'tests/temp_storage_specs_dir';
  const nodeDbPath = 'tests/temp_storage_node_graph.sqlite';

  const sidecar1 = `---
title: Auth System
type: sidecar-spec
description: Handles user authentication and session management.
tags: [security, identity]
status: spec
version: 1
target_code_file: src/auth/index.ts
status_flag: clean
depends_on: []
used_by: [tests/temp_storage_specs_dir/session.ts.md]
---

## Implementation

\`\`\`typescript
export interface AuthUser {
  id: string;
  username: string;
}
\`\`\`
`;

  const sidecar2 = `---
title: Session Management
type: sidecar-spec
description: Manages user sessions in memory or database.
tags: [session, security]
status: spec
version: 1
target_code_file: src/auth/session.ts
status_flag: clean
depends_on: [tests/temp_storage_specs_dir/auth.ts.md]
used_by: []
user_notes:
  - id: note-123
    timestamp: '2023-10-27T10:00:00Z'
    text: Fix cookie secure flag in production.
    status: pending
---

## Implementation

\`\`\`typescript
export interface Session {
  token: string;
  userId: string;
}
\`\`\`
`;

  beforeAll(async () => {
    // Set up temp specs directory on disk for Node.js storage driver testing
    await fs.mkdir(tempSpecsDir, { recursive: true });
    await fs.writeFile(path.join(tempSpecsDir, 'auth.ts.md'), sidecar1, 'utf8');
    await fs.writeFile(path.join(tempSpecsDir, 'session.ts.md'), sidecar2, 'utf8');
  });

  afterAll(async () => {
    // Clean up disk files
    try {
      await fs.rm(tempSpecsDir, { recursive: true, force: true });
      await fs.rm(nodeDbPath, { force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should produce identical graph results across Node.js and Virtual/WASM storage drivers', async () => {
    // 1. Initialize Node.js GraphEngine (NodeFileSystem + BetterSqliteDriver)
    const nodeEngine = new GraphEngine({
      fsDriver: new NodeFileSystem(),
      dbDriver: new BetterSqliteDriver(nodeDbPath),
      dbPath: nodeDbPath,
    });
    await nodeEngine.initialize();
    await nodeEngine.clearIndex();

    // 2. Initialize Virtual/WASM GraphEngine (VirtualFileSystem + WasmSqliteDriver)
    const initialFiles = {
      [`${tempSpecsDir}/auth.ts.md`]: sidecar1,
      [`${tempSpecsDir}/session.ts.md`]: sidecar2,
    };
    const wasmEngine = createGraphEngine({
      fsDriver: new VirtualFileSystem(initialFiles),
      dbDriver: new WasmSqliteDriver(),
    });
    await wasmEngine.initialize();

    // 3. Index Workspace on both engines
    const nodeSummary = await nodeEngine.indexWorkspace(tempSpecsDir, { force: true });
    const wasmSummary = await wasmEngine.indexWorkspace(tempSpecsDir, { force: true });

    // Assert scanned, indexed, and errors are identical
    expect(wasmSummary.scanned).toBe(nodeSummary.scanned);
    expect(wasmSummary.indexed).toBe(nodeSummary.indexed);
    expect(wasmSummary.errors.length).toBe(nodeSummary.errors.length);

    // 4. Verify list of files indexed is identical
    const nodeFiles = await nodeEngine.getFilesIndexed();
    const wasmFiles = await wasmEngine.getFilesIndexed();
    expect(wasmFiles.sort()).toEqual(nodeFiles.sort());

    // 5. Verify parsed specifications and frontmatter match perfectly
    const nodeAuthSpec = await nodeEngine.getSidecar(`${tempSpecsDir}/auth.ts.md`);
    const wasmAuthSpec = await wasmEngine.getSidecar(`${tempSpecsDir}/auth.ts.md`);
    delete nodeAuthSpec.updatedAt;
    delete nodeAuthSpec.createdAt;
    delete wasmAuthSpec.updatedAt;
    delete wasmAuthSpec.createdAt;
    expect(wasmAuthSpec).toEqual(nodeAuthSpec);

    // 6. Verify bi-directional neighbor queries work identically
    const nodeAuthNeighbors = await nodeEngine.getNeighbors(`${tempSpecsDir}/auth.ts.md`, 'both');
    const wasmAuthNeighbors = await wasmEngine.getNeighbors(`${tempSpecsDir}/auth.ts.md`, 'both');
    expect(wasmAuthNeighbors.sort()).toEqual(nodeAuthNeighbors.sort());

    const nodeSessionNeighbors = await nodeEngine.getNeighbors(
      `${tempSpecsDir}/session.ts.md`,
      'both',
    );
    const wasmSessionNeighbors = await wasmEngine.getNeighbors(
      `${tempSpecsDir}/session.ts.md`,
      'both',
    );
    expect(wasmSessionNeighbors.sort()).toEqual(nodeSessionNeighbors.sort());

    // 7. Verify topological sort matches identically
    const nodeTopo = await nodeEngine.getTopologicalSort();
    const wasmTopo = await wasmEngine.getTopologicalSort();
    expect(wasmTopo).toEqual(nodeTopo);

    // 8. Verify getPendingDirectives works identically
    const nodeDirectives = await nodeEngine.getPendingDirectives();
    const wasmDirectives = await wasmEngine.getPendingDirectives();
    expect(wasmDirectives).toEqual(nodeDirectives);

    // 9. Verify search query matches (FTS5 search on Node vs LIKE fallback or FTS5 on WASM)
    const nodeSearchResults = await nodeEngine.search('Session');
    const wasmSearchResults = await wasmEngine.search('Session');

    // Compare paths of found results
    const nodeSearchPaths = nodeSearchResults.map((r) => r.filePath).sort();
    const wasmSearchPaths = wasmSearchResults.map((r) => r.filePath).sort();
    expect(wasmSearchPaths).toEqual(nodeSearchPaths);

    // 10. Close both engines
    await nodeEngine.close();
    await wasmEngine.close();
  });
});

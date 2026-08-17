import { parseOkfSpec } from '../src/parser/okf';
import { WasmGraphEngine } from '../src/graph/wasmEngine';
import { MemoryVirtualFileSystemDriver } from '../src/storage';

describe('In-Memory & WASM SQLite Graph Engine Test Suite', () => {
  const sidecar1 = `---
title: Parser Service
type: sidecar-spec
description: Handles markdown and YAML file parsing.
tags: [parser, markdown, yaml]
status: spec
version: 1
target_code_file: src/parser/index.ts
status_flag: clean
depends_on: []
used_by: [specs/graph_service.ts.md]
---

## Implementation

\`\`\`typescript
export interface ParseResult {
  success: boolean;
  data?: any;
}
\`\`\`
`;

  const sidecar2 = `---
title: Graph Service
type: sidecar-spec
description: Manages adjacency nodes and executes topological queries.
tags: [graph, routing, topology]
status: spec
version: 1
target_code_file: src/graph/index.ts
status_flag: clean
depends_on: [specs/parser_service.ts.md]
used_by: []
---

## Implementation

\`\`\`typescript
export interface NodeInfo {
  id: string;
  neighbors: string[];
}
\`\`\`
`;

  it('should correctly parse OKF spec sidecars in-memory', () => {
    const parseResult1 = parseOkfSpec(sidecar1);
    expect(parseResult1.isValid).toBe(true);
    expect(parseResult1.frontmatter?.title).toBe('Parser Service');
    expect(parseResult1.frontmatter?.type).toBe('sidecar-spec');
    expect(parseResult1.frontmatter?.tags).toContain('parser');

    const parseResult2 = parseOkfSpec(sidecar2);
    expect(parseResult2.isValid).toBe(true);
    expect(parseResult2.frontmatter?.title).toBe('Graph Service');
  });

  it('should index workspace, run FTS5 search, and execute 1-Hop Ego queries', async () => {
    // 1. Initialize MemoryVirtualFileSystemDriver with in-memory sidecar files
    const virtualFiles = {
      'specs/parser_service.ts.md': sidecar1,
      'specs/graph_service.ts.md': sidecar2,
    };
    const fsDriver = new MemoryVirtualFileSystemDriver(virtualFiles);

    // 2. Initialize WasmGraphEngine
    const engine = new WasmGraphEngine({ fsDriver });
    await engine.initialize();

    // 3. Scan & Index Workspace recursively using virtual drivers
    const summary = await engine.indexWorkspace('specs', { force: true });
    expect(summary.scanned).toBe(2);
    expect(summary.indexed).toBe(2);
    expect(summary.errors.length).toBe(0);

    // 4. Verify list of files indexed matches in-memory
    const indexed = await engine.getFilesIndexed();
    expect(indexed.sort()).toEqual(
      ['specs/parser_service.ts.md', 'specs/graph_service.ts.md'].sort(),
    );

    // 5. Test 1-Hop Ego Query (Retrieving neighbors in both directions)
    // parser_service has used_by: [specs/graph_service.ts.md]
    const parserNeighbors = await engine.getNeighbors('specs/parser_service.ts.md', 'both');
    expect(parserNeighbors).toContain('specs/graph_service.ts.md');

    // graph_service has depends_on: [specs/parser_service.ts.md]
    const graphNeighbors = await engine.getNeighbors('specs/graph_service.ts.md', 'both');
    expect(graphNeighbors).toContain('specs/parser_service.ts.md');

    // 6. Test FTS5 search capabilities on the virtual sqlite database
    const searchResults = await engine.search('topological');
    expect(searchResults.length).toBeGreaterThanOrEqual(1);
    expect(searchResults[0].filePath).toBe('specs/graph_service.ts.md');
    expect(searchResults[0].title).toBe('Graph Service');

    // 7. Verify incremental indexing works (should index 0 since nothing changed)
    const incrementalSummary = await engine.indexWorkspace('specs');
    expect(incrementalSummary.indexed).toBe(0);

    // 8. Close the WASM database connection
    await engine.close();
  });
});

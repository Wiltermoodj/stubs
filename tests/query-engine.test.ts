import { QueryEngine } from '../src/query/engine';
import { GraphEngine } from '../src/graph/engine';
import { VirtualFileSystem, WasmSqliteDriver } from '../src/storage';

describe('QueryEngine (GraphRAG)', () => {
  let vfs: VirtualFileSystem;
  let graphEngine: GraphEngine;
  let queryEngine: QueryEngine;

  beforeEach(async () => {
    vfs = new VirtualFileSystem();
    // Using in-memory wasm sqlite
    graphEngine = new GraphEngine({
      dbPath: ':memory:',
      fsDriver: vfs,
      dbDriver: new WasmSqliteDriver(),
    });
    await graphEngine.initialize();

    // Populate graph nodes & edges
    await graphEngine.upsertSidecar({
      filePath: 'src/parser/okf.ts.md',
      frontmatter: {
        title: 'OKF Specification Parser',
        type: 'sidecar-spec',
        status: 'implemented',
        status_flag: 'clean',
        version: 1,
        target_code_file: 'okf.ts',
        description:
          'Parses Open Knowledge Format markdown frontmatter and body into AST representations.',
        tags: ['parser', 'okf', 'ast'],
        exports: ['parseOkfSpec'],
      },
      body: 'Parses Open Knowledge Format markdown specs.',
    });

    await graphEngine.upsertSidecar({
      filePath: 'src/graph/engine.ts.md',
      frontmatter: {
        title: 'SQLite Graph Engine',
        type: 'sidecar-spec',
        status: 'implemented',
        status_flag: 'clean',
        version: 1,
        target_code_file: 'engine.ts',
        description: 'Stores AST nodes, relations, and FTS5 full-text indexing.',
        tags: ['graph', 'sqlite', 'database'],
        exports: ['GraphEngine'],
        depends_on: ['../parser/okf.ts'],
      },
      body: 'Stores AST nodes and dependencies.',
    });

    queryEngine = new QueryEngine({ graphEngine, fsDriver: vfs });
  });

  it('should resolve relevant subgraph for a natural language question', async () => {
    const res = await queryEngine.query('How does the parser connect to the graph?');

    expect(res.query).toBe('How does the parser connect to the graph?');
    expect(res.seedNodes.length).toBeGreaterThan(0);
    expect(res.nodes.length).toBeGreaterThan(0);
    expect(res.summaryText).toContain('Knowledge Graph Context for:');
    expect(res.summaryText).toContain('Key Architectural Nodes');
    expect(res.approxTokens).toBeGreaterThan(0);
  });

  it('should respect character and token budgets', async () => {
    const res = await queryEngine.query('parser graph sqlite', { budget: 20 });
    expect(res.summaryText.length).toBeLessThanOrEqual(20 * 4 + 100);
  });

  it('should support DFS traversal mode', async () => {
    const res = await queryEngine.query('okf', { mode: 'dfs' });
    expect(res.mode).toBe('dfs');
  });
});

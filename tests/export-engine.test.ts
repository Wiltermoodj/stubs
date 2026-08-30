import { ExportEngine } from '../src/export/engine';
import { GraphEngine } from '../src/graph/engine';
import { VirtualFileSystem, WasmSqliteDriver } from '../src/storage';

describe('ExportEngine (Obsidian & Wiki)', () => {
  let vfs: VirtualFileSystem;
  let graphEngine: GraphEngine;
  let exportEngine: ExportEngine;

  beforeEach(async () => {
    vfs = new VirtualFileSystem();
    graphEngine = new GraphEngine({
      dbPath: ':memory:',
      fsDriver: vfs,
      dbDriver: new WasmSqliteDriver(),
    });
    await graphEngine.initialize();

    await graphEngine.upsertSidecar({
      filePath: 'src/parser/okf.ts.md',
      frontmatter: {
        title: 'OKF Specification Parser',
        type: 'sidecar-spec',
        status: 'implemented',
        status_flag: 'clean',
        version: 1,
        target_code_file: 'okf.ts',
        description: 'Parses OKF markdown specifications.',
        tags: ['parser'],
        exports: ['parseOkfSpec'],
      },
      body: 'Specification body.',
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
        description: 'Stores AST nodes and dependencies.',
        tags: ['graph', 'database'],
        exports: ['GraphEngine'],
        depends_on: ['../parser/okf.ts'],
      },
      body: 'Stores AST nodes and dependencies.',
    });

    exportEngine = new ExportEngine({ graphEngine, fsDriver: vfs });
  });

  it('should export graph into Obsidian Vault with [[wikilinks]]', async () => {
    const res = await exportEngine.toObsidian('/vault');
    expect(res.format).toBe('obsidian');
    expect(res.filesGenerated.length).toBeGreaterThan(0);

    const indexContent = await vfs.readFile('/vault/Index.md');
    expect(indexContent).toContain('Architecture Knowledge Graph Index');
    expect(indexContent).toContain('Subsystems & Communities');
  });

  it('should export graph into Wikipedia-style articles with index portal', async () => {
    const res = await exportEngine.toWiki('/wiki');
    expect(res.format).toBe('wiki');
    expect(res.filesGenerated.length).toBeGreaterThan(0);

    const indexContent = await vfs.readFile('/wiki/index.md');
    expect(indexContent).toContain('Codebase Architecture Wiki');
    expect(indexContent).toContain('Subsystems Map');
  });
});

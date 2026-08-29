import { promises as fs } from 'fs';
import * as path from 'path';
import { DiagramEngine } from '../src/diagram/engine';
import { GraphEngine } from '../src/graph/engine';

describe('Diagram Engine & Living Mermaid Exporter Tests', () => {
  const testDir = path.join(__dirname, 'temp_diagram_test');
  const dbPath = path.join(testDir, 'graph.sqlite');

  beforeAll(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('generates a layer-grouped flowchart TD architecture diagram', async () => {
    const graphEngine = new GraphEngine(dbPath);
    await graphEngine.initialize();

    await graphEngine.upsertGraphNodes([
      {
        id: 'src/config/schema.ts',
        file_path: 'src/config/schema.ts',
        symbol_name: 'loadConfig',
        kind: 'file',
        domain: 'config',
        lifecycle_phase: 'spec',
      },
      {
        id: 'src/storage/index.ts',
        file_path: 'src/storage/index.ts',
        symbol_name: 'FileStorageDriver',
        kind: 'file',
        domain: 'storage',
        lifecycle_phase: 'spec',
      },
      {
        id: 'src/cli/router.ts',
        file_path: 'src/cli/router.ts',
        symbol_name: 'CliRouter',
        kind: 'file',
        domain: 'cli',
        lifecycle_phase: 'spec',
      },
    ]);

    await graphEngine.upsertGraphEdges([
      {
        source_id: 'src/cli/router.ts',
        target_id: 'src/config/schema.ts',
        relation: 'imports',
        weight: 1,
      },
      {
        source_id: 'src/storage/index.ts',
        target_id: 'src/config/schema.ts',
        relation: 'imports',
        weight: 1,
      },
    ]);

    const diagramEngine = new DiagramEngine({ graphEngine });
    const result = await diagramEngine.generateDiagram(undefined, {
      type: 'architecture',
      groupBy: 'layer',
    });

    expect(result.diagramType).toBe('architecture');
    expect(result.mermaidCode).toContain('flowchart TD');
    expect(result.mermaidCode).toContain('subgraph L0 ["Layer 0: Foundation"]');
    expect(result.mermaidCode).toContain('subgraph L1 ["Layer 1: Storage"]');
    expect(result.mermaidCode).toContain('subgraph L6 ["Layer 6: Interface"]');
    expect(result.mermaidCode).toContain('-->');

    await graphEngine.close();
  });

  it('generates a sequence diagram tracing downstream call flows', async () => {
    const seqDbPath = path.join(testDir, 'seq_graph.sqlite');
    const graphEngine = new GraphEngine(seqDbPath);
    await graphEngine.initialize();

    const root = 'src/cli/router.ts';
    const mid = 'src/parser/ast.ts';
    const leaf = 'src/config/schema.ts';

    await graphEngine.upsertGraphNodes([
      { id: root, file_path: root, kind: 'file', domain: 'cli' },
      { id: mid, file_path: mid, kind: 'file', domain: 'parser' },
      { id: leaf, file_path: leaf, kind: 'file', domain: 'config' },
    ]);

    await graphEngine.upsertGraphEdges([
      { source_id: root, target_id: mid, relation: 'calls', weight: 1 },
      { source_id: mid, target_id: leaf, relation: 'imports', weight: 1 },
    ]);

    const diagramEngine = new DiagramEngine({ graphEngine });
    const result = await diagramEngine.generateDiagram(root, {
      type: 'sequence',
    });

    expect(result.diagramType).toBe('sequence');
    expect(result.mermaidCode).toContain('sequenceDiagram');
    expect(result.mermaidCode).toContain('participant');
    expect(result.mermaidCode).toContain('->>');

    await graphEngine.close();
  });

  it('generates a focused neighborhood slice diagram for a target node', async () => {
    const sliceDbPath = path.join(testDir, 'slice_graph.sqlite');
    const graphEngine = new GraphEngine(sliceDbPath);
    await graphEngine.initialize();

    const target = 'src/parser/okf.ts';
    const upstream = 'src/cli/router.ts';
    const downstream = 'src/config/schema.ts';

    await graphEngine.upsertGraphNodes([
      { id: target, file_path: target, kind: 'file', domain: 'parser' },
      { id: upstream, file_path: upstream, kind: 'file', domain: 'cli' },
      { id: downstream, file_path: downstream, kind: 'file', domain: 'config' },
    ]);

    await graphEngine.upsertGraphEdges([
      { source_id: upstream, target_id: target, relation: 'imports', weight: 1 },
      { source_id: target, target_id: downstream, relation: 'imports', weight: 1 },
    ]);

    const diagramEngine = new DiagramEngine({ graphEngine });
    const result = await diagramEngine.generateDiagram(target, {
      type: 'slice',
    });

    expect(result.diagramType).toBe('slice');
    expect(result.mermaidCode).toContain('flowchart LR');
    expect(result.mermaidCode).toContain('Upstream Dependents');
    expect(result.mermaidCode).toContain('Downstream Dependencies');

    await graphEngine.close();
  });

  it('synchronizes Mermaid diagram between comment markers inside a markdown document', async () => {
    const docPath = path.join(testDir, 'context-map.md');
    const initialContent = `# Architecture Context Map

Human authored content here.

<!-- BEGIN STUBS DIAGRAM -->
Old diagram here
<!-- END STUBS DIAGRAM -->

Human authored footer here.
`;
    await fs.writeFile(docPath, initialContent, 'utf8');

    const diagramEngine = new DiagramEngine();
    const mermaidDiagram = '```mermaid\nflowchart TD\n  A --> B\n```';

    const synced = await diagramEngine.syncDiagramToDocument(docPath, mermaidDiagram);
    expect(synced).toBe(true);

    const updatedContent = await fs.readFile(docPath, 'utf8');
    expect(updatedContent).toContain('Human authored content here.');
    expect(updatedContent).toContain('flowchart TD');
    expect(updatedContent).toContain('A --> B');
    expect(updatedContent).toContain('Human authored footer here.');
    expect(updatedContent).not.toContain('Old diagram here');
  });
});

import { McpServer, STUBS_MCP_TOOLS } from '../src/server/mcp';
import { GraphEngine } from '../src/graph/engine';
import { VirtualFileSystem, WasmSqliteDriver } from '../src/storage';
import { extractFileGraph } from '../src/graph/extractor';

describe('MCP Tools Expansion & Polyglot Call Graph Extraction', () => {
  let vfs: VirtualFileSystem;
  let dbDriver: WasmSqliteDriver;
  let graphEngine: GraphEngine;
  let mcpServer: McpServer;

  beforeEach(async () => {
    vfs = new VirtualFileSystem();
    dbDriver = new WasmSqliteDriver({ fsDriver: vfs, dbPath: ':memory:' });
    graphEngine = new GraphEngine({ fsDriver: vfs, dbDriver, dbPath: ':memory:' });
    await graphEngine.initialize();
    mcpServer = new McpServer(graphEngine);
  });

  afterEach(async () => {
    await graphEngine.close();
  });

  describe('MCP Tools Registration & Execution', () => {
    it('registers new tools in STUBS_MCP_TOOLS', () => {
      const toolNames = STUBS_MCP_TOOLS.map((t) => t.name);
      expect(toolNames).toContain('stubs_plan_order');
      expect(toolNames).toContain('stubs_blast_guard');
      expect(toolNames).toContain('stubs_tiered_context');
      expect(toolNames).toContain('stubs_lint_arch');
    });

    it('executes stubs_plan_order via handleToolCall', async () => {
      await graphEngine.upsertGraphNodes([
        { id: 'a.ts', file_path: 'a.ts', kind: 'file' },
        { id: 'b.ts', file_path: 'b.ts', kind: 'file' },
      ]);
      await graphEngine.upsertGraphEdges([
        { source_id: 'a.ts', target_id: 'b.ts', relation: 'imports' },
      ]);

      const res = await (mcpServer as any).handleToolCall(1, {
        name: 'stubs_plan_order',
        arguments: { files: ['a.ts', 'b.ts'], direction: 'dependencies_first' },
      });

      expect(res.error).toBeUndefined();
      const payload = JSON.parse(res.result.content[0].text);
      expect(payload.orderedFiles).toEqual(['b.ts', 'a.ts']);
    });

    it('executes stubs_blast_guard via handleToolCall', async () => {
      await graphEngine.upsertGraphNodes([{ id: 'leaf.ts', file_path: 'leaf.ts', kind: 'file' }]);

      const res = await (mcpServer as any).handleToolCall(2, {
        name: 'stubs_blast_guard',
        arguments: { target: 'leaf.ts', threshold: 'high' },
      });

      expect(res.error).toBeUndefined();
      const payload = JSON.parse(res.result.content[0].text);
      expect(payload.safe).toBe(true);
      expect(payload.impactCount).toBe(0);
    });

    it('executes stubs_tiered_context via handleToolCall', async () => {
      await graphEngine.upsertGraphNodes([
        { id: 'src/hub.ts', file_path: 'src/hub.ts', kind: 'file', domain: 'core' },
      ]);

      const res = await (mcpServer as any).handleToolCall(3, {
        name: 'stubs_tiered_context',
        arguments: { target: 'src/hub.ts' },
      });

      expect(res.error).toBeUndefined();
      expect(res.result.content[0].text).toContain('[L0 TARGET]: src/hub.ts');
    });
  });

  describe('Polyglot Method and Call Extraction', () => {
    it('extracts Python class methods, base implementations, and function calls', () => {
      const pythonCode = `
from services.auth import verify_token

class AuthService(BaseService):
    def login(self, username):
        verify_token(username)

def standalone_handler():
    verify_token("test")
`;
      const { nodes, edges } = extractFileGraph('auth.py', pythonCode);

      const methodNode = nodes.find((n) => n.kind === 'method' && n.symbol_name === 'login');
      expect(methodNode).toBeDefined();
      expect(methodNode?.id).toBe('auth.py#AuthService.login');

      const callEdges = edges.filter((e) => e.relation === 'calls');
      expect(callEdges.length).toBeGreaterThan(0);
      expect(callEdges.some((e) => e.target_id === 'services/auth#verify_token')).toBe(true);
    });

    it('extracts Rust trait implementations and struct methods', () => {
      const rustCode = `
pub struct UserRepo;

impl Repository for UserRepo {
    pub fn find_by_id(&self, id: u64) {
    }
}
`;
      const { nodes, edges } = extractFileGraph('repo.rs', rustCode);

      const implEdges = edges.filter((e) => e.relation === 'implements');
      expect(implEdges.length).toBe(1);
      expect(implEdges[0].source_id).toBe('repo.rs#UserRepo');
      expect(implEdges[0].target_id).toBe('repo.rs#Repository');

      const methodNode = nodes.find((n) => n.kind === 'method' && n.symbol_name === 'find_by_id');
      expect(methodNode).toBeDefined();
    });

    it('extracts Go struct receiver methods', () => {
      const goCode = `
package storage

type PostgresStore struct {}

func (s *PostgresStore) Connect() error {
    return nil
}
`;
      const { nodes, edges } = extractFileGraph('postgres.go', goCode);

      const methodNode = nodes.find((n) => n.kind === 'method' && n.symbol_name === 'Connect');
      expect(methodNode).toBeDefined();
      expect(methodNode?.id).toBe('postgres.go#PostgresStore.Connect');

      const containsEdge = edges.find((e) => e.target_id === 'postgres.go#PostgresStore.Connect');
      expect(containsEdge?.source_id).toBe('postgres.go#PostgresStore');
    });
  });
});

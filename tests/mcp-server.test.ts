import { McpServer, STUBS_MCP_TOOLS } from '../src/server/mcp';
import { GraphEngine } from '../src/graph/engine';
import { VirtualFileSystem, WasmSqliteDriver } from '../src/storage';

describe('McpServer (Model Context Protocol)', () => {
  let vfs: VirtualFileSystem;
  let graphEngine: GraphEngine;
  let mcpServer: McpServer;

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

    mcpServer = new McpServer(graphEngine);
  });

  it('should handle initialize request', async () => {
    const req = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    };
    const res = await mcpServer.handleRpcRequest(req);
    expect(res.jsonrpc).toBe('2.0');
    expect(res.id).toBe(1);
    expect(res.result.serverInfo.name).toBe('stubs-mcp');
  });

  it('should list available MCP tools', async () => {
    const req = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    };
    const res = await mcpServer.handleRpcRequest(req);
    expect(res.result.tools.length).toBe(STUBS_MCP_TOOLS.length);
    expect(res.result.tools.some((t: any) => t.name === 'stubs_query')).toBe(true);
    expect(res.result.tools.some((t: any) => t.name === 'stubs_explain')).toBe(true);
  });

  it('should execute stubs_explain tool call', async () => {
    const req = {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'stubs_explain',
        arguments: { target: 'parseOkfSpec' },
      },
    };
    const res = await mcpServer.handleRpcRequest(req);
    expect(res.id).toBe(3);
    expect(res.result.content[0].text).toContain('Node Profile:');
  });

  it('should execute stubs_query tool call', async () => {
    const req = {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'stubs_query',
        arguments: { query: 'parser' },
      },
    };
    const res = await mcpServer.handleRpcRequest(req);
    expect(res.id).toBe(4);
    expect(res.result.content[0].text).toContain('Knowledge Graph Context');
  });
});

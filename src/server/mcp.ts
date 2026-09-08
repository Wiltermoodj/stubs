import * as readline from 'readline';
import { GraphEngine } from '../graph/engine';
import { TopologyEngine } from '../graph/topology';
import { QueryEngine } from '../query/engine';
import { loadConfig } from '../config/schema';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export const STUBS_MCP_TOOLS: McpTool[] = [
  {
    name: 'stubs_query',
    description:
      'Query the codebase knowledge graph with natural language or keywords to retrieve a token-budgeted subgraph context package (GraphRAG).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The question, symbol, or concept to search.' },
        budget: {
          type: 'number',
          description: 'Approximate token budget for the response (default: 1500).',
        },
        mode: {
          type: 'string',
          enum: ['bfs', 'dfs'],
          description: 'Graph traversal mode (bfs for broad, dfs for deep).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'stubs_explain',
    description:
      'Get an architectural explanation of a symbol or file, including degree centrality, callers, callees, confidence, and community cluster.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'The symbol or file path to explain (e.g. "Parser", "src/parser/okf.ts").',
        },
      },
      required: ['target'],
    },
  },
  {
    name: 'stubs_blast',
    description:
      'Calculate the blast radius and downstream impact of modifying a specific file or symbol.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'The symbol or file to analyze.' },
        depth: { type: 'number', description: 'Max traversal depth (default: 3).' },
        direction: {
          type: 'string',
          enum: ['downstream', 'upstream', 'both'],
          description: 'Direction of impact analysis.',
        },
      },
      required: ['target'],
    },
  },
  {
    name: 'stubs_path',
    description:
      'Find the shortest dependency path and relation chain between two symbols or files.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Source symbol or file path.' },
        target: { type: 'string', description: 'Target symbol or file path.' },
      },
      required: ['source', 'target'],
    },
  },
  {
    name: 'stubs_communities',
    description: 'List detected subsystem communities and their central hub modules.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'stubs_plan_order',
    description:
      'Compute the optimal topological sequence of files to modify during multi-file refactoring to avoid broken intermediate states.',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of file paths to order.',
        },
        direction: {
          type: 'string',
          enum: ['dependencies_first', 'dependents_first'],
          description: 'Sort order (dependencies_first = base before consumers).',
        },
      },
      required: ['files'],
    },
  },
  {
    name: 'stubs_blast_guard',
    description:
      'Perform a pre-execution safety check on the blast radius of a file or symbol before modifying it.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Target file or symbol name.' },
        threshold: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'Safety risk threshold level (default: high).',
        },
      },
      required: ['target'],
    },
  },
  {
    name: 'stubs_tiered_context',
    description:
      'Get a token-compact tiered context model (L0 Target, L1 Neighbors, L2 Subsystem) for an agent prompt.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Target file or symbol name.' },
      },
      required: ['target'],
    },
  },
  {
    name: 'stubs_lint_arch',
    description: 'Audit codebase dependencies against defined architectural boundary rules.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

export class McpServer {
  private graphEngine: GraphEngine;
  private queryEngine: QueryEngine;

  constructor(graphEngine?: GraphEngine) {
    if (graphEngine) {
      this.graphEngine = graphEngine;
    } else {
      const config = loadConfig();
      this.graphEngine = new GraphEngine(config.paths.db_path);
    }
    this.queryEngine = new QueryEngine({ graphEngine: this.graphEngine });
  }

  /**
   * Starts the MCP JSON-RPC 2.0 stdio loop.
   */
  public async start(): Promise<void> {
    await this.graphEngine.initialize();

    const rl = readline.createInterface({
      input: process.stdin as any,
      output: process.stdout as any,
      terminal: false,
    });

    rl.on('line', async (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const req = JSON.parse(trimmed);
        const res = await this.handleRpcRequest(req);
        if (res) {
          process.stdout.write(JSON.stringify(res) + '\n');
        }
      } catch (err: any) {
        const errResponse = {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: `Parse error: ${err?.message || err}`,
          },
        };
        process.stdout.write(JSON.stringify(errResponse) + '\n');
      }
    });
  }

  /**
   * Handles a single JSON-RPC 2.0 request.
   */
  public async handleRpcRequest(req: any): Promise<any | null> {
    const { id, method, params } = req;

    // Notifications (no id)
    if (id === undefined || id === null) {
      if (method === 'notifications/initialized') {
        // Client confirmed initialization
      }
      return null;
    }

    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'stubs-mcp',
              version: '1.0.0',
            },
          },
        };

      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: STUBS_MCP_TOOLS,
          },
        };

      case 'tools/call':
        return await this.handleToolCall(id, params);

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        };
    }
  }

  private async handleToolCall(id: any, params: any): Promise<any> {
    const toolName = params?.name;
    const args = params?.arguments || {};

    try {
      const allNodes = await this.graphEngine.getGraphNodes();
      const allEdges = await this.graphEngine.getGraphEdges();
      const topology = new TopologyEngine(allNodes, allEdges);

      switch (toolName) {
        case 'stubs_query': {
          const res = await this.queryEngine.query(args.query, {
            budget: args.budget,
            mode: args.mode,
          });
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: res.summaryText }],
            },
          };
        }

        case 'stubs_explain': {
          const res = topology.explainNode(args.target);
          if (!res) {
            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: `Node not found: ${args.target}` }],
                isError: true,
              },
            };
          }
          const text = topology.formatNodeExplanation(res);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text }],
            },
          };
        }

        case 'stubs_blast': {
          const res = topology.getBlastRadius(args.target, {
            depth: args.depth,
            direction: args.direction,
          });
          const text = topology.formatBlastRadiusTree(res);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text }],
            },
          };
        }

        case 'stubs_path': {
          const res = topology.findShortestPath(args.source, args.target);
          if (!res) {
            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  { type: 'text', text: `No path found between ${args.source} and ${args.target}` },
                ],
              },
            };
          }
          const text = topology.formatShortestPath(res);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text }],
            },
          };
        }

        case 'stubs_communities': {
          const res = topology.getCommunities();
          const lines = [`Subsystem Communities (${res.totalCommunities} detected):`];
          for (const comm of res.communityInfo) {
            lines.push(
              `- [#${comm.id}] ${comm.label} (${comm.nodes.length} nodes, cohesion: ${comm.cohesion})`,
            );
          }
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: lines.join('\n') }],
            },
          };
        }

        case 'stubs_plan_order': {
          const files = Array.isArray(args.files) ? args.files : [];
          const direction = args.direction || 'dependencies_first';
          const res = topology.getTopologicalEditOrder(files, direction);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
            },
          };
        }

        case 'stubs_blast_guard': {
          const threshold = args.threshold || 'high';
          const res = topology.checkBlastGuard(args.target, threshold);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
            },
          };
        }

        case 'stubs_tiered_context': {
          const res = topology.getTieredAgentContext(args.target);
          if (!res) {
            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: `Node not found: ${args.target}` }],
                isError: true,
              },
            };
          }
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: res.formattedSummary }],
            },
          };
        }

        case 'stubs_lint_arch': {
          const config = loadConfig();
          const res = topology.lintArchitectureRules(config.architecture_rules || []);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
            },
          };
        }

        default:
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32602,
              message: `Unknown tool: ${toolName}`,
            },
          };
      }
    } catch (err: any) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `Tool error: ${err.message || err}` }],
          isError: true,
        },
      };
    }
  }
}

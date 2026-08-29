import * as fs from 'fs';
import * as path from 'path';
import { GraphEngine } from '../src/graph/engine';
import { extractFileGraph } from '../src/graph/extractor';
import { TopologyEngine } from '../src/graph/topology';
import { SandingEngine } from '../src/sanding/engine';
import { CliRouter } from '../src/cli/router';

describe('Graph-Augmented Traversal & Zero-Bloat Topology', () => {
  const testDir = path.resolve(__dirname, 'temp_graph_test');
  const dbPath = path.join(testDir, 'graph.sqlite');
  let engine: GraphEngine;

  beforeEach(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
    engine = new GraphEngine(dbPath);
    await engine.initialize();
  });

  afterEach(async () => {
    if (engine) {
      await engine.close();
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('1. SQLite Graph Schema & CRUD Operations', () => {
    test('should initialize graph_nodes and graph_edges tables and indexes', async () => {
      const tables = await engine.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table';",
      );
      const names = tables.map((t) => t.name);
      expect(names).toContain('graph_nodes');
      expect(names).toContain('graph_edges');
    });

    test('should support upserting, querying, and deleting graph nodes and edges', async () => {
      await engine.upsertGraphNodes([
        {
          id: 'src/services/bike-service.ts',
          file_path: 'src/services/bike-service.ts',
          kind: 'file',
          domain: 'garage',
          lifecycle_phase: 'clean',
        },
        {
          id: 'src/services/bike-service.ts#BikeService',
          file_path: 'src/services/bike-service.ts',
          symbol_name: 'BikeService',
          kind: 'class',
          domain: 'garage',
        },
      ]);

      await engine.upsertGraphEdges([
        {
          source_id: 'src/services/bike-service.ts',
          target_id: 'src/services/bike-service.ts#BikeService',
          relation: 'contains',
          weight: 1.0,
        },
      ]);

      const nodes = await engine.getGraphNodes({ domain: 'garage' });
      expect(nodes.length).toBe(2);

      const edges = await engine.getGraphEdges({ relation: 'contains' });
      expect(edges.length).toBe(1);
      expect(edges[0].target_id).toBe('src/services/bike-service.ts#BikeService');

      await engine.deleteGraphNodesForFile('src/services/bike-service.ts');
      const remainingNodes = await engine.getGraphNodes({ domain: 'garage' });
      expect(remainingNodes.length).toBe(0);
      const remainingEdges = await engine.getGraphEdges();
      expect(remainingEdges.length).toBe(0);
    });
  });

  describe('2. AST & Multi-Language Symbol Extraction', () => {
    test('should extract classes, functions, calls, and imports from TypeScript code', () => {
      const tsCode = `
import { Engine } from './engine';
import * as utils from '../utils';

export interface IBike {
  id: string;
}

export class BikeService {
  public tune(bikeId: string): void {
    Engine.start();
  }
}

export function formatBikeName(name: string): string {
  return name.trim();
}
`;
      const result = extractFileGraph('src/services/bike-service.ts', tsCode, {
        domain: 'garage',
        phase: 'spec',
      });

      expect(result.nodes.some((n) => n.id === 'src/services/bike-service.ts')).toBe(true);
      expect(result.nodes.some((n) => n.symbol_name === 'IBike' && n.kind === 'interface')).toBe(
        true,
      );
      expect(result.nodes.some((n) => n.symbol_name === 'BikeService' && n.kind === 'class')).toBe(
        true,
      );
      expect(
        result.nodes.some((n) => n.symbol_name === 'formatBikeName' && n.kind === 'function'),
      ).toBe(true);

      expect(
        result.edges.some((e) => e.relation === 'imports' && e.target_id.includes('engine')),
      ).toBe(true);
      expect(
        result.edges.some((e) => e.relation === 'calls' && e.target_id.includes('start')),
      ).toBe(true);
    });

    test('should extract imports, classes, and functions from Python code', () => {
      const pyCode = `
from models.bike import Bike
import utils.formatter

class BikeManager:
    def tune_bike(self, bike_id):
        pass

def calculate_speed(distance, time):
    return distance / time
`;
      const result = extractFileGraph('src/garage/manager.py', pyCode, { domain: 'garage' });

      expect(result.nodes.some((n) => n.symbol_name === 'BikeManager' && n.kind === 'class')).toBe(
        true,
      );
      expect(
        result.nodes.some((n) => n.symbol_name === 'calculate_speed' && n.kind === 'function'),
      ).toBe(true);
      expect(result.edges.some((e) => e.relation === 'imports')).toBe(true);
    });

    test('should extract use, fn, and struct from Rust code', () => {
      const rsCode = `
use crate::engine::TuneEngine;

pub struct Bike {
    pub id: String,
}

pub fn service_bike(bike: &Bike) {
    // service logic
}
`;
      const result = extractFileGraph('src/garage/mod.rs', rsCode, { domain: 'garage' });

      expect(result.nodes.some((n) => n.symbol_name === 'Bike' && n.kind === 'class')).toBe(true);
      expect(
        result.nodes.some((n) => n.symbol_name === 'service_bike' && n.kind === 'function'),
      ).toBe(true);
      expect(result.edges.some((e) => e.relation === 'imports')).toBe(true);
    });

    test('should extract imports, structs, and funcs from Go code', () => {
      const goCode = `
package garage

import "fmt"

type Bike struct {
    ID string
}

func TuneBike(id string) error {
    return nil
}
`;
      const result = extractFileGraph('src/garage/bike.go', goCode, { domain: 'garage' });

      expect(result.nodes.some((n) => n.symbol_name === 'Bike' && n.kind === 'class')).toBe(true);
      expect(result.nodes.some((n) => n.symbol_name === 'TuneBike' && n.kind === 'function')).toBe(
        true,
      );
      expect(result.edges.some((e) => e.relation === 'imports' && e.target_id === 'fmt')).toBe(
        true,
      );
    });
  });

  describe('3. Topological Traversal (Blast Radius & Shortest Path)', () => {
    let topology: TopologyEngine;

    beforeEach(() => {
      // Build sample graph:
      // A -> B -> C -> D
      // E -> B
      // B in domain "garage", D in domain "analytics"
      const nodes = [
        { id: 'src/entry.ts', file_path: 'src/entry.ts', kind: 'file' as const, domain: 'app' },
        {
          id: 'src/components/sheet.tsx',
          file_path: 'src/components/sheet.tsx',
          kind: 'file' as const,
          domain: 'garage',
        },
        {
          id: 'src/services/bike-service.ts',
          file_path: 'src/services/bike-service.ts',
          kind: 'file' as const,
          domain: 'garage',
        },
        {
          id: 'src/services/engine.ts',
          file_path: 'src/services/engine.ts',
          kind: 'file' as const,
          domain: 'garage',
        },
        {
          id: 'src/analytics/stats.ts',
          file_path: 'src/analytics/stats.ts',
          kind: 'file' as const,
          domain: 'analytics',
        },
      ];

      const edges = [
        {
          source_id: 'src/entry.ts',
          target_id: 'src/components/sheet.tsx',
          relation: 'imports' as const,
        },
        {
          source_id: 'src/components/sheet.tsx',
          target_id: 'src/services/bike-service.ts',
          relation: 'imports' as const,
        },
        {
          source_id: 'src/services/bike-service.ts',
          target_id: 'src/services/engine.ts',
          relation: 'calls' as const,
        },
        {
          source_id: 'src/analytics/stats.ts',
          target_id: 'src/services/bike-service.ts',
          relation: 'depends_on' as const,
        },
      ];

      topology = new TopologyEngine(nodes, edges);
    });

    test('should calculate downstream blast radius accurately', () => {
      // If bike-service changes, downstream consumers are sheet.tsx, entry.ts, stats.ts
      const blast = topology.getBlastRadius('src/services/bike-service.ts', {
        depth: 3,
        direction: 'downstream',
      });

      expect(blast.totalAffected).toBeGreaterThanOrEqual(2);
      expect(blast.domainsAffected).toContain('garage');
      const formatted = topology.formatBlastRadiusTree(blast);
      expect(formatted).toContain('Blast Radius');
      expect(formatted).toContain('src/components/sheet.tsx');
    });

    test('should find shortest relational path between two files', () => {
      const pathResult = topology.findShortestPath('src/entry.ts', 'src/services/engine.ts');

      expect(pathResult).not.toBeNull();
      expect(pathResult!.totalHops).toBe(3);
      expect(pathResult!.path).toEqual([
        'src/entry.ts',
        'src/components/sheet.tsx',
        'src/services/bike-service.ts',
        'src/services/engine.ts',
      ]);

      const formatted = topology.formatShortestPath(pathResult!);
      expect(formatted).toContain('Shortest Path: src/entry.ts -> src/services/engine.ts (3 hops)');
    });

    test('should return null when no path exists between nodes', () => {
      const pathResult = topology.findShortestPath('src/services/engine.ts', 'src/entry.ts');
      expect(pathResult).toBeNull();
    });
  });

  describe('4. Architectural Smell & Hotspot Detection', () => {
    test('should detect circular dependency cycles using Tarjan SCC', () => {
      const nodes = [
        { id: 'a.ts', file_path: 'a.ts', kind: 'file' as const },
        { id: 'b.ts', file_path: 'b.ts', kind: 'file' as const },
        { id: 'c.ts', file_path: 'c.ts', kind: 'file' as const },
      ];
      // A -> B -> C -> A
      const edges = [
        { source_id: 'a.ts', target_id: 'b.ts', relation: 'imports' as const },
        { source_id: 'b.ts', target_id: 'c.ts', relation: 'imports' as const },
        { source_id: 'c.ts', target_id: 'a.ts', relation: 'imports' as const },
      ];

      const topo = new TopologyEngine(nodes, edges);
      const smells = topo.detectSmells();

      expect(smells.cycles.length).toBe(1);
      expect(smells.cycles[0].cycleLength).toBe(3);
    });

    test('should detect God Nodes with excessive in-degree/out-degree', () => {
      const nodes = [{ id: 'god.ts', file_path: 'god.ts', kind: 'file' as const }];
      const edges: any[] = [];

      for (let i = 0; i < 12; i++) {
        nodes.push({ id: `client_${i}.ts`, file_path: `client_${i}.ts`, kind: 'file' as const });
        edges.push({ source_id: `client_${i}.ts`, target_id: 'god.ts', relation: 'imports' });
      }

      const topo = new TopologyEngine(nodes, edges);
      const smells = topo.detectSmells();

      expect(smells.godNodes.length).toBe(1);
      expect(smells.godNodes[0].id).toBe('god.ts');
      expect(smells.godNodes[0].inDegree).toBe(12);
    });

    test('should detect domain boundary leaks into internal/private modules', () => {
      const nodes = [
        {
          id: 'src/auth/login.ts',
          file_path: 'src/auth/login.ts',
          kind: 'file' as const,
          domain: 'auth',
        },
        {
          id: 'src/garage/internal/db.ts',
          file_path: 'src/garage/internal/db.ts',
          kind: 'file' as const,
          domain: 'garage',
        },
      ];
      const edges = [
        {
          source_id: 'src/auth/login.ts',
          target_id: 'src/garage/internal/db.ts',
          relation: 'imports' as const,
        },
      ];

      const topo = new TopologyEngine(nodes, edges);
      const smells = topo.detectSmells();

      expect(smells.domainLeaks.length).toBe(1);
      expect(smells.domainLeaks[0].sourceDomain).toBe('auth');
      expect(smells.domainLeaks[0].targetDomain).toBe('garage');
    });
  });

  describe('5. OKF Frontmatter Auto-Healing via Sanding', () => {
    test('should automatically synchronize depends_on from AST code imports on stubs sand', async () => {
      const sander = new SandingEngine();
      const sidecarFile = path.join(testDir, 'service.ts.md');
      const codeFile = path.join(testDir, 'service.ts');

      fs.writeFileSync(
        path.join(testDir, 'logger.ts'),
        `export class Logger { static info(msg: string): void {} }\n`,
        'utf8',
      );
      fs.writeFileSync(
        path.join(testDir, 'config.ts'),
        `export class Config { static env = 'test'; }\n`,
        'utf8',
      );

      const sidecarContent = `---
title: Service Spec
type: sidecar-spec
target_code_file: ./service.ts
status: spec
version: 1
depends_on:
  - ./architecture.md
---

## Implementation
\`\`\`typescript
import { Logger } from './logger';
import { Config } from './config';

export class Service {
  log() {
    Logger.info('running');
  }
}
\`\`\`
`;
      fs.writeFileSync(sidecarFile, sidecarContent, 'utf8');

      // Sync/materialize sidecar to code
      const res = await sander.syncFile(sidecarFile);
      expect(['synced', 'healed']).toContain(res.status);
      expect(fs.existsSync(codeFile)).toBe(true);

      const updatedSidecar = fs.readFileSync(sidecarFile, 'utf8');
      expect(updatedSidecar).toContain('architecture.md');
      expect(updatedSidecar).toContain('logger');
      expect(updatedSidecar).toContain('config');
    });
  });

  describe('6. CLI Integration: blast, path, audit --hotspots, tree --graph', () => {
    test('should execute stubs blast via CliRouter', async () => {
      const router = new CliRouter();
      const codeFile = path.join(testDir, 'a.ts');
      fs.writeFileSync(codeFile, `import { b } from './b';\nexport const a = 1;`, 'utf8');

      const exitCode = await router.route([
        'blast',
        codeFile,
        '--config',
        path.join(testDir, 'config.json'),
        '--json',
      ]);
      expect(exitCode).toBe(0);
    });

    test('should execute stubs audit --hotspots via CliRouter', async () => {
      const router = new CliRouter();
      const exitCode = await router.route([
        'audit',
        '--hotspots',
        '--config',
        path.join(testDir, 'config.json'),
      ]);
      expect(exitCode).toBe(0);
    });

    test('should execute stubs tree --graph via CliRouter', async () => {
      const router = new CliRouter();
      const exitCode = await router.route([
        'tree',
        '--graph',
        '--config',
        path.join(testDir, 'config.json'),
      ]);
      expect(exitCode).toBe(0);
    });
  });
});

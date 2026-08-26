import * as http from 'http';
import * as path from 'path';
import { promises as fs } from 'fs';
import { PortalServer } from '../src/server/portal';
import { GraphEngine } from '../src/graph/engine';

describe('Planning Hub & Lifecycle Portal Server REST API Endpoints', () => {
  let server: PortalServer;
  let port: number;
  const testDir = path.join(__dirname, 'temp_planning_portal_test');
  let graphEngine: GraphEngine;

  beforeAll(async () => {
    await fs.mkdir(path.join(testDir, 'knowledge', 'planning'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'knowledge', 'planning', 'init-plan.md'),
      `---
title: "Core Expansion"
type: "initiative-plan"
description: "Core expansion plan"
tags: ["planning"]
phase: "conceptualize"
status: "spec"
version: 1
status_flag: "clean"
initiative: "core-expansion"
---
# Core Expansion Plan

\`\`\`filetree
src/
  core/
    engine.ts # [NEW] Core engine
\`\`\`

## Tasks
- [ ] Task 1
- [x] Task 2
`,
      'utf8',
    );

    const dbPath = path.join(testDir, 'graph.sqlite');
    graphEngine = new GraphEngine(dbPath);
    await graphEngine.initialize();
    await graphEngine.indexWorkspace(testDir);

    port = 3089;
    server = new PortalServer(graphEngine, port);

    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    await graphEngine.close();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  const fetchJson = (urlPath: string): Promise<any> => {
    return new Promise((resolve, reject) => {
      http
        .get(`http://localhost:${port}${urlPath}`, (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (err) {
              reject(err);
            }
          });
        })
        .on('error', reject);
    });
  };

  it('GET /api/v1/planning returns initiatives, concepts, and tasks summary', async () => {
    const data = await fetchJson('/api/v1/planning');
    expect(data).toHaveProperty('initiatives');
    expect(data).toHaveProperty('tasks');
    expect(data).toHaveProperty('summary');
    expect(Array.isArray(data.initiatives)).toBe(true);
    expect(data.initiatives.length).toBeGreaterThan(0);
    expect(data.initiatives[0].title).toBe('Core Expansion');
  });

  it('GET /api/v1/phases returns 5-phase lifecycle status matrix and counts', async () => {
    const data = await fetchJson('/api/v1/phases');
    expect(data).toHaveProperty('matrix');
    expect(data).toHaveProperty('summary');
    expect(data).toHaveProperty('sidecars');
    expect(data.summary).toHaveProperty('conceptualize');
  });

  it('GET /api/v1/tree returns project file tree including planned files', async () => {
    const data = await fetchJson('/api/v1/tree?planned=true');
    expect(data).toHaveProperty('existing');
    expect(data).toHaveProperty('planned');
    expect(Array.isArray(data.planned)).toBe(true);
  });
});

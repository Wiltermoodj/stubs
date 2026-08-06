import * as fs from 'fs';
import * as path from 'path';
import { TemplateEngine } from '../src/templates/engine';
import { AutonomyProtocol } from '../src/autonomy/protocol';
import { GraphEngine } from '../src/graph/engine';
import { StubsConfig } from '../src/config/schema';

describe('Local Template Engine', () => {
  let tempTemplatesDir: string;
  let engine: TemplateEngine;

  beforeAll(async () => {
    tempTemplatesDir = path.resolve('.stubs/test_templates');
    if (!fs.existsSync(tempTemplatesDir)) {
      fs.mkdirSync(tempTemplatesDir, { recursive: true });
    }
    engine = new TemplateEngine(tempTemplatesDir);
  });

  afterAll(async () => {
    if (fs.existsSync(tempTemplatesDir)) {
      fs.rmSync(tempTemplatesDir, { recursive: true, force: true });
    }
  });

  it('should list template molds correctly', async () => {
    const file1 = path.join(tempTemplatesDir, 'service.ts.md.tpl');
    fs.writeFileSync(file1, 'Service Template Content', 'utf8');

    const list = await engine.listTemplates();
    expect(list).toContain('service.ts.md.tpl');
  });

  it('should support Handlebars-style and EJS-style rendering', () => {
    // 1. EJS Style <%= ... %>
    const ejsTemplate = 'Hello <%= name %>, welcome to <%= project %>!';
    const res1 = engine.renderString(ejsTemplate, { name: 'Jules', project: 'stubs' });
    expect(res1).toBe('Hello Jules, welcome to stubs!');

    // 2. Handlebars Style {{ ... }}
    const hbsTemplate = 'Hello {{name}}, welcome to {{project}}!';
    const res2 = engine.renderString(hbsTemplate, { name: 'Jules', project: 'stubs' });
    expect(res2).toBe('Hello Jules, welcome to stubs!');
  });

  it('should support Handlebars conditional blocks (if-else)', () => {
    const hbsTemplate = '{{#if showSecret}}SECRET: {{secret}}{{else}}No Secret{{/if}}';

    const resWithSecret = engine.renderString(hbsTemplate, { showSecret: true, secret: '1234' });
    expect(resWithSecret).toBe('SECRET: 1234');

    const resNoSecret = engine.renderString(hbsTemplate, { showSecret: false, secret: '1234' });
    expect(resNoSecret).toBe('No Secret');
  });

  it('should support Handlebars iterations (each)', () => {
    const hbsTemplate = 'List: {{#each items}}{{this}} {{/each}}';
    const res = engine.renderString(hbsTemplate, { items: ['A', 'B', 'C'] });
    expect(res).toBe('List: A B C ');
  });
});

describe('3-Tier Agent Autonomy Protocol', () => {
  const buildMockConfig = (
    level: 'strict_gate' | 'guided_execution' | 'autonomous',
  ): StubsConfig => ({
    project_name: 'test-project',
    autonomy_level: level,
    paths: {
      specs_dir: 'src',
      templates_dir: '.stubs/templates',
      db_path: '.stubs/test_graph.sqlite',
    },
    search: {
      engine: 'sqlite-fts5',
      vector_plugin: null,
    },
    grill: {
      default_depth: 'standard_drill',
    },
  });

  it('should respect Strict Gate rules', () => {
    const protocol = new AutonomyProtocol(buildMockConfig('strict_gate'));
    expect(protocol.evaluateAction('draft_template_proposal').allowed).toBe(true);
    expect(protocol.evaluateAction('scaffold_sidecar').allowed).toBe(false);
    expect(protocol.evaluateAction('materialize_code').allowed).toBe(false);
  });

  it('should respect Guided Execution rules', () => {
    const protocol = new AutonomyProtocol(buildMockConfig('guided_execution'));
    expect(protocol.evaluateAction('draft_template_proposal').allowed).toBe(true);
    expect(protocol.evaluateAction('scaffold_sidecar').allowed).toBe(true);
    expect(protocol.evaluateAction('materialize_code').allowed).toBe(false);
  });

  it('should respect Autonomous rules', () => {
    const protocol = new AutonomyProtocol(buildMockConfig('autonomous'));
    expect(protocol.evaluateAction('draft_template_proposal').allowed).toBe(true);
    expect(protocol.evaluateAction('scaffold_sidecar').allowed).toBe(true);
    expect(protocol.evaluateAction('materialize_code').allowed).toBe(true);
  });
});

describe('5-Phase Retroactive Reconciliation Engine', () => {
  let graphEngine: GraphEngine;
  let protocol: AutonomyProtocol;
  let testDbPath: string;
  let tempWorkDir: string;

  beforeAll(async () => {
    testDbPath = path.resolve('.stubs/test_reconciliation_graph.sqlite');
    tempWorkDir = path.resolve('.stubs/test_workspace');

    if (!fs.existsSync(tempWorkDir)) {
      fs.mkdirSync(tempWorkDir, { recursive: true });
    }

    graphEngine = new GraphEngine(testDbPath);
    await graphEngine.initialize();

    const config = {
      project_name: 'test-project',
      autonomy_level: 'autonomous' as const,
      paths: {
        specs_dir: tempWorkDir,
        templates_dir: '.stubs/templates',
        db_path: testDbPath,
      },
      search: {
        engine: 'sqlite-fts5' as const,
        vector_plugin: null,
      },
      grill: {
        default_depth: 'standard_drill' as const,
      },
    };

    protocol = new AutonomyProtocol(config, graphEngine);
  });

  afterAll(async () => {
    await graphEngine.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    if (fs.existsSync(tempWorkDir)) {
      fs.rmSync(tempWorkDir, { recursive: true, force: true });
    }
  });

  it('should execute 5-Phase Retroactive Reconciliation successfully', async () => {
    // Scaffold initial sidecar spec and code file
    const sidecarRelative = '.stubs/test_workspace/math.ts.md';
    const sidecarAbs = path.resolve(sidecarRelative);
    const codeAbs = path.resolve('.stubs/test_workspace/math.ts');

    const initialSidecarContent = `---
title: "Math Helper Spec"
type: "sidecar-spec"
description: "Handles mathematical tasks."
tags: ["math"]
status: "spec"
version: 1
target_code_file: "./math.ts"
status_flag: "clean"
sync_state:
  last_sync_timestamp: "2026-08-05T18:00:00Z"
  sidecar_hash: "initial-sidecar-hash"
  code_hash: "initial-code-hash"
---
# Math Specification Body
`;

    const initialCodeContent = `// @sidecar ./math.ts.md
export function add(a: number, b: number): number {
  return a + b;
}
`;

    fs.writeFileSync(sidecarAbs, initialSidecarContent, 'utf8');
    fs.writeFileSync(codeAbs, initialCodeContent, 'utf8');

    // Run reconciliation - should detect no change or safe change if hashes don't mismatch manual edits
    const res = await protocol.reconcile(sidecarRelative, { forceApply: true });
    expect(res.success).toBe(true);
    expect(res.phase).toBe(5);

    // Verify sidecar status flag updated / clean, and files remain intact
    const finalSidecar = fs.readFileSync(sidecarAbs, 'utf8');
    expect(finalSidecar).toContain('status_flag: clean');
    expect(finalSidecar).toContain('sync_state:');
    expect(finalSidecar).not.toContain('initial-sidecar-hash');

    // Verify that subsequent drift detection reports hasDrift = false because disk is now fully in sync!
    const updatedSidecarContent = fs.readFileSync(sidecarAbs, 'utf8');
    const report = await protocol.detectDrift(sidecarRelative, updatedSidecarContent, codeAbs);
    expect(report.hasDrift).toBe(false);
  });
});

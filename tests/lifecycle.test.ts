import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { TemplateEngine } from '../src/templates/engine';
import { GrillEngine } from '../src/grill/engine';
import { MaterializerEngine } from '../src/materializer/engine';
import { SandingEngine } from '../src/sanding/engine';
import { GraphEngine } from '../src/graph/engine';
import { parseOkfSpec } from '../src/parser/okf';

describe('Dual-File Lifecycle End-to-End Integration Test', () => {
  const tempDir = path.resolve('tests/temp-lifecycle-test');
  const templatesDir = path.join(tempDir, 'templates');
  const templateFilePath = path.join(templatesDir, 'service.ts.md.tpl');
  const sidecarFilePath = path.join(tempDir, 'lifecycle-service.ts.md');
  const codeFilePath = path.join(tempDir, 'lifecycle-service.ts');
  const dbPath = path.join(tempDir, 'graph.sqlite');

  let graphEngine: GraphEngine;

  beforeAll(async () => {
    // Create temp workspace directories
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    if (!fs.existsSync(templatesDir)) {
      fs.mkdirSync(templatesDir, { recursive: true });
    }

    // Write a template mold (service.ts.md.tpl)
    const moldContent = `---
title: "{{title}}"
type: "sidecar-spec"
description: "{{description}}"
tags: []
status: "skeleton"
version: 1
target_code_file: "{{target_code_file}}"
status_flag: "clean"
---
# {{title}} Specification

## Overview
This is a service specification generated from a local mold.

## Implementation
\`\`\`typescript
export function greet(name: string): string {
  return "Hello, " + name + "!";
}
\`\`\`
`;
    fs.writeFileSync(templateFilePath, moldContent, 'utf8');

    // Initialize database and graph engine
    graphEngine = new GraphEngine(dbPath);
    await graphEngine.initialize();
  });

  afterAll(async () => {
    // Shutdown and clean up temp workspace
    await graphEngine.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should successfully complete the 4-stage dual-file lifecycle state machine', async () => {
    // ==========================================
    // STAGE 1: Skeleton Creation (from Template)
    // ==========================================
    const templateEngine = new TemplateEngine(templatesDir);
    const context = {
      title: 'Lifecycle Greeting Service',
      description: 'An E2E service demonstrating the 4-stage lifecycle.',
      target_code_file: './lifecycle-service.ts',
    };

    const rendered = await templateEngine.renderTemplate('service', context);
    fs.writeFileSync(sidecarFilePath, rendered, 'utf8');

    // Verify Stage 1
    expect(fs.existsSync(sidecarFilePath)).toBe(true);
    let currentSpec = parseOkfSpec(fs.readFileSync(sidecarFilePath, 'utf8'));
    expect(currentSpec.isValid).toBe(true);
    expect(currentSpec.frontmatter?.status).toBe('skeleton');
    expect(currentSpec.frontmatter?.status_flag).toBe('clean');
    expect(currentSpec.frontmatter?.title).toBe('Lifecycle Greeting Service');
    expect(currentSpec.frontmatter?.target_code_file).toBe('./lifecycle-service.ts');

    // ==========================================
    // STAGE 2: Specification (Grill Engine & Transition to spec)
    // ==========================================
    const grillEngine = new GrillEngine();
    await grillEngine.grill(sidecarFilePath, {
      depth: 'light_probe',
      nonInteractive: true,
      answers: ['Sure, let us use standard templates.', 'All parameters validated.'],
    });

    // Verify Stage 2 Part A (Grilling adds questions/answers and discussion)
    expect(fs.existsSync(sidecarFilePath)).toBe(true);
    currentSpec = parseOkfSpec(fs.readFileSync(sidecarFilePath, 'utf8'));
    expect(currentSpec.isValid).toBe(true);
    expect(currentSpec.frontmatter?.user_notes).toBeDefined();
    expect(currentSpec.frontmatter?.user_notes?.length).toBe(2);
    expect(currentSpec.body).toContain('## Grilling & Discussion (Light Probe)');

    // Part B: Solidifying the specification (transition status to 'spec')
    if (currentSpec.frontmatter) {
      currentSpec.frontmatter.status = 'spec';
      const solidifiedContent = `---\n${yaml.dump(currentSpec.frontmatter).trim()}\n---\n${currentSpec.body}`;
      fs.writeFileSync(sidecarFilePath, solidifiedContent, 'utf8');
    }

    currentSpec = parseOkfSpec(fs.readFileSync(sidecarFilePath, 'utf8'));
    expect(currentSpec.frontmatter?.status).toBe('spec');

    // ==========================================
    // STAGE 3: Materialization (Materializer Engine)
    // ==========================================
    const materializer = new MaterializerEngine(graphEngine);
    const materializationResult = await materializer.materialize(sidecarFilePath);

    // Verify Stage 3
    expect(materializationResult.success).toBe(true);
    expect(fs.existsSync(codeFilePath)).toBe(true);

    const generatedCode = fs.readFileSync(codeFilePath, 'utf8');
    expect(generatedCode).toContain('// @sidecar ./lifecycle-service.ts.md');
    expect(generatedCode).toContain('export function greet(name: string): string');

    currentSpec = parseOkfSpec(fs.readFileSync(sidecarFilePath, 'utf8'));
    expect(currentSpec.frontmatter?.status).toBe('materialized');
    expect(currentSpec.frontmatter?.status_flag).toBe('clean');
    expect(currentSpec.frontmatter?.sync_state).toBeDefined();

    const relSidecarPath = path.relative(process.cwd(), sidecarFilePath).replace(/\\/g, '/');
    const dbSidecar = await graphEngine.getSidecar(relSidecarPath);
    expect(dbSidecar).not.toBeNull();
    expect(dbSidecar.frontmatter.status).toBe('materialized');

    // ==========================================
    // STAGE 4: Maintenance (Bi-Directional Code Sanding)
    // ==========================================
    // Modify code file (simulate developer change)
    const modifiedCode = generatedCode.replace(
      'return "Hello, " + name + "!";',
      'return "Greetings, " + name + "!"; // Developer modification',
    );
    // Artificially advance modification time of the code file to make sure code_mtime > sidecar_mtime
    const now = Date.now();
    fs.writeFileSync(codeFilePath, modifiedCode, 'utf8');
    fs.utimesSync(codeFilePath, new Date(now + 10000), new Date(now + 10000));

    // Run Sanding / Synchronization
    const sandingEngine = new SandingEngine();
    const syncResult = await sandingEngine.syncFile(sidecarFilePath);

    // Verify Stage 4
    expect(syncResult.status).toBe('synced');
    expect(syncResult.direction).toBe('sanded');

    // Verify sidecar was successfully sanded
    currentSpec = parseOkfSpec(fs.readFileSync(sidecarFilePath, 'utf8'));
    expect(currentSpec.frontmatter?.status).toBe('materialized');
    expect(currentSpec.body).toContain('Greetings, " + name + "!"; // Developer modification');
    expect(currentSpec.frontmatter?.sync_state?.code_hash).toBeDefined();

    // Run sync again - should report no_change as files are perfectly synchronized now
    const secondSyncResult = await sandingEngine.syncFile(sidecarFilePath);
    expect(secondSyncResult.status).toBe('no_change');
  });
});

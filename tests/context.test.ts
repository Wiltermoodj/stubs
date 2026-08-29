import { promises as fs } from 'fs';
import * as path from 'path';
import { extractDistilledSignatures, extractExportedSymbolNames } from '../src/parser/ast';
import { ContextEngine } from '../src/context/engine';
import { GraphEngine } from '../src/graph/engine';

describe('Context Engine & AST Distillation Tests', () => {
  const testDir = path.join(__dirname, 'temp_context_test');
  const dbPath = path.join(testDir, 'graph.sqlite');

  beforeAll(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Cleanup ignore
    }
  });

  it('extractDistilledSignatures strips function bodies and keeps types/interfaces', () => {
    const tsCode = `
export interface UserConfig {
  id: string;
  name: string;
}

export type StatusType = 'active' | 'inactive';

export enum LogLevel {
  INFO = 1,
  ERROR = 2
}

/**
 * Calculates something useful
 */
export function calculateSum(a: number, b: number): number {
  const c = a + b;
  return c * 2;
}

export async function fetchData<T>(url: string): Promise<T> {
  const res = await fetch(url);
  return res.json();
}

function internalHelper() {
  return false;
}

export class ServiceWorker {
  private secret: string = '123';
  public id: string;

  constructor(id: string) {
    this.id = id;
  }

  public async runTask(name: string): Promise<boolean> {
    console.log(name);
    return true;
  }
}
`;

    const distilled = extractDistilledSignatures(tsCode);

    expect(distilled).toContain('export interface UserConfig');
    expect(distilled).toContain('export type StatusType');
    expect(distilled).toContain('export enum LogLevel');
    expect(distilled).toContain('export function calculateSum(a: number, b: number): number;');
    expect(distilled).toContain('export async function fetchData<T>(url: string): Promise<T>;');
    expect(distilled).toContain('export class ServiceWorker');
    expect(distilled).toContain('public id: string;');
    expect(distilled).toContain('public async runTask(name: string): Promise<boolean>;');

    // Ensure implementation bodies and internal unexported functions are stripped
    expect(distilled).not.toContain('return c * 2');
    expect(distilled).not.toContain('internalHelper');
    expect(distilled).not.toContain('private secret');
  });

  it('extractExportedSymbolNames extracts exported symbol identifiers', () => {
    const tsCode = `
export interface Config {}
export type Mode = 'prod' | 'dev';
export function run() {}
export class Engine {}
export const DEFAULT_PORT = 3000, MAX_RETRIES = 5;
function unexported() {}
`;

    const symbols = extractExportedSymbolNames(tsCode);
    expect(symbols).toContain('Config');
    expect(symbols).toContain('Mode');
    expect(symbols).toContain('run');
    expect(symbols).toContain('Engine');
    expect(symbols).toContain('DEFAULT_PORT');
    expect(symbols).toContain('MAX_RETRIES');
    expect(symbols).not.toContain('unexported');
  });

  it('ContextEngine generates structured tiered context package and renders markdown', async () => {
    const graphEngine = new GraphEngine(dbPath);
    await graphEngine.initialize();

    // Create target file and a dependency file
    const depCodePath = path.join(testDir, 'dep.ts');
    const depSidecarPath = path.join(testDir, 'dep.ts.md');
    const targetCodePath = path.join(testDir, 'target.ts');
    const targetSidecarPath = path.join(testDir, 'target.ts.md');

    await fs.writeFile(
      depCodePath,
      'export interface DepService { process(): void; }\nexport function helper(): string { return "ok"; }',
      'utf8',
    );

    await fs.writeFile(
      depSidecarPath,
      `---
title: Dep Service
type: sidecar-spec
description: Dependency module for target.
tags: [service]
phase: sand
status: materialized
version: 1
status_flag: clean
exports:
  - DepService
  - helper
decisions:
  - id: ADR-001
    summary: Use isolated sub-services.
    date: "2026-08-28"
---
# Dep Service
`,
      'utf8',
    );

    await fs.writeFile(
      targetCodePath,
      'import { DepService } from "./dep";\nexport function execute() { return true; }',
      'utf8',
    );

    await fs.writeFile(
      targetSidecarPath,
      `---
title: Target Module
type: sidecar-spec
description: The main target module under inspection.
tags: [core]
phase: spec
status: spec
version: 1
status_flag: clean
depends_on:
  - ${depSidecarPath.replace(/\\/g, '/')}
---
# Target Module
`,
      'utf8',
    );

    await graphEngine.indexFile(depSidecarPath);
    await graphEngine.indexFile(targetSidecarPath);

    const contextEngine = new ContextEngine({ graphEngine });
    const pkg = await contextEngine.generateContextPackage(targetSidecarPath);

    expect(pkg.target.title).toBe('Target Module');
    expect(pkg.target.phase).toBe('spec');
    expect(pkg.target.sidecarContent).toBeDefined();

    // Check direct dependencies
    expect(pkg.tier1Dependencies.length).toBeGreaterThan(0);
    const dep = pkg.tier1Dependencies.find((d) => d.filePath.includes('dep.ts.md'));
    expect(dep).toBeDefined();
    expect(dep?.title).toBe('Dep Service');
    expect(dep?.decisions.length).toBe(1);
    expect(dep?.decisions[0].adrId).toBe('ADR-001');
    expect(dep?.distilledSignatures).toContain('export interface DepService');
    expect(dep?.distilledSignatures).toContain('export function helper(): string;');

    // Test Markdown rendering
    const md = contextEngine.renderMarkdown(pkg);
    expect(md).toContain('# Context Briefing: Target Module');
    expect(md).toContain('## 1. Target Module (Full Specification & Implementation)');
    expect(md).toContain('## 2. Direct Dependencies (Contracts, ADRs & Export Signatures)');
    expect(md).toContain('ADR-001');

    await graphEngine.close();
  });
});

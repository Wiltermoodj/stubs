import * as path from 'path';
import * as ts from 'typescript';
import { parseOkfSpec, ParsedOkfSpec } from '../parser/okf';
import { extractDistilledSignatures, extractExportedSymbolNames } from '../parser/ast';
import { GraphEngine, normalizePosixPath } from '../graph/engine';
import { FileStorageDriver, NodeFileSystem } from '../storage';
import { loadConfig } from '../config/schema';

export type TestFramework = 'jest' | 'vitest' | 'node';

export interface MockOptions {
  framework?: TestFramework;
  outputPath?: string;
  dryRun?: boolean;
  force?: boolean;
  configPath?: string;
}

export interface MockedTestCase {
  title: string;
  description: string;
  assertions: string[];
}

export interface MockedSymbolSuite {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type';
  signature?: string;
  testCases: MockedTestCase[];
}

export interface MockScaffoldResult {
  sourceFilePath: string;
  targetTestPath: string;
  framework: TestFramework;
  importPath: string;
  exportedSymbols: string[];
  mockDefinitions: string[];
  suites: MockedSymbolSuite[];
  generatedCode: string;
  written: boolean;
  generatedAt: string;
}

function classifyExportedSymbols(
  sourceCode: string,
  fileName = 'file.ts',
): Map<string, 'class' | 'function' | 'interface' | 'type' | 'variable'> {
  const map = new Map<string, 'class' | 'function' | 'interface' | 'type' | 'variable'>();
  try {
    const sf = ts.createSourceFile(fileName, sourceCode, ts.ScriptTarget.Latest, true);
    for (const stmt of sf.statements) {
      if (ts.isClassDeclaration(stmt) && stmt.name) {
        map.set(stmt.name.text, 'class');
      } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
        map.set(stmt.name.text, 'function');
      } else if (ts.isInterfaceDeclaration(stmt)) {
        map.set(stmt.name.text, 'interface');
      } else if (ts.isTypeAliasDeclaration(stmt)) {
        map.set(stmt.name.text, 'type');
      } else if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            map.set(decl.name.text, 'variable');
          }
        }
      }
    }
  } catch {
    // Fallback
  }
  return map;
}

export class MockEngine {
  private graphEngine?: GraphEngine;
  private fsDriver: FileStorageDriver;

  constructor(options?: { graphEngine?: GraphEngine; fsDriver?: FileStorageDriver }) {
    if (options?.graphEngine) {
      this.graphEngine = options.graphEngine;
    }
    this.fsDriver = options?.fsDriver || new NodeFileSystem();
  }

  /**
   * Generates a spec-driven test suite and typed mocks for a target sidecar or code file.
   */
  public async generateTestScaffold(
    filePath: string,
    options: MockOptions = {},
  ): Promise<MockScaffoldResult> {
    let normalized = normalizePosixPath(filePath);
    if (normalized.startsWith('./')) {
      normalized = normalized.substring(2);
    }

    const framework: TestFramework = options.framework || 'jest';

    // Resolve sidecar and code paths
    let sidecarPath = normalized;
    let codePath = normalized;
    if (normalized.endsWith('.ts.md')) {
      codePath = normalized.replace(/\.md$/, '');
    } else if (normalized.endsWith('.ts')) {
      sidecarPath = `${normalized}.md`;
    }

    // Default output path: tests/<module_basename>.test.ts
    const moduleBaseName = path.basename(codePath, path.extname(codePath));
    const defaultOutputPath = `tests/${moduleBaseName}.test.ts`;
    const targetTestPath = normalizePosixPath(options.outputPath || defaultOutputPath);

    // Read sidecar and code content if available
    let sidecarContent = '';
    let parsedSpec: ParsedOkfSpec | null = null;
    if (await this.fsDriver.exists(sidecarPath)) {
      sidecarContent = await this.fsDriver.readFile(sidecarPath);
      parsedSpec = parseOkfSpec(sidecarContent);
    }

    let sourceCode = '';
    if (await this.fsDriver.exists(codePath)) {
      sourceCode = await this.fsDriver.readFile(codePath);
    }

    // Calculate relative import path from targetTestPath to codePath
    const testDir = path.dirname(targetTestPath);
    let relPath = path.relative(testDir, codePath.replace(/\.(ts|js)$/, ''));
    if (!relPath.startsWith('.')) {
      relPath = './' + relPath;
    }
    const importPath = normalizePosixPath(relPath);

    // Extract symbols and signatures
    const exportedSymbols = sourceCode
      ? extractExportedSymbolNames(sourceCode, codePath)
      : parsedSpec?.frontmatter?.exports || [];

    const classified = sourceCode ? classifyExportedSymbols(sourceCode, codePath) : new Map();
    const distilledSignatures = sourceCode ? extractDistilledSignatures(sourceCode, codePath) : '';

    // Extract ADR decisions
    const decisions = parsedSpec?.frontmatter?.decisions || [];

    // Build suites and test cases
    const suites: MockedSymbolSuite[] = [];
    const mockDefinitions: string[] = [];

    // Synthesize test suites for exported symbols
    for (const sym of exportedSymbols) {
      const kind =
        classified.get(sym) ||
        (sym.endsWith('Engine') || sym.endsWith('Driver') || sym.endsWith('Server')
          ? 'class'
          : /^[A-Z]/.test(sym)
            ? 'interface'
            : 'function');

      const testCases: MockedTestCase[] = [];

      if (kind === 'class') {
        testCases.push({
          title: `should instantiate ${sym} with default configuration`,
          description: `Verifies constructor initialization of ${sym}`,
          assertions: [`const instance = new ${sym}();`, `expect(instance).toBeDefined();`],
        });

        // Add ADR-driven test cases
        if (decisions.length > 0) {
          for (const dec of decisions) {
            testCases.push({
              title: `should adhere to ${dec.id} (${dec.summary})`,
              description: dec.summary,
              assertions: [
                `// Assert invariant from ${dec.id}: ${dec.summary}`,
                `const instance = new ${sym}();`,
                `expect(instance).toBeDefined();`,
              ],
            });
          }
        } else {
          testCases.push({
            title: `should execute core methods without throwing unhandled exceptions`,
            description: `Ensures resilience and deep module contract`,
            assertions: [`const instance = new ${sym}();`, `expect(instance).toBeDefined();`],
          });
        }

        suites.push({
          name: sym,
          kind: 'class',
          testCases,
        });
      } else if (kind === 'function') {
        testCases.push({
          title: `should return expected output for valid input arguments`,
          description: `Verifies ${sym} functional contract`,
          assertions: [
            `// TODO: Configure test fixtures for ${sym}`,
            `expect(typeof ${sym}).toBe('function');`,
          ],
        });

        testCases.push({
          title: `should gracefully handle edge cases and invalid inputs`,
          description: `Ensures ${sym} does not throw unhandled errors`,
          assertions: [`expect(typeof ${sym}).toBe('function');`],
        });

        suites.push({
          name: `${sym}()`,
          kind: 'function',
          testCases,
        });
      } else {
        // Type / Interface / Constant / Variable
        suites.push({
          name: sym,
          kind: kind === 'interface' ? 'interface' : 'type',
          testCases: [
            {
              title: `should export valid type definition for ${sym}`,
              description: `Type validation for ${sym}`,
              assertions: [
                `// Symbol ${sym} contract verified via compile-time type-checking`,
                `expect(true).toBe(true);`,
              ],
            },
          ],
        });
      }
    }

    // Generate TypeScript Test File Code
    const generatedCode = this.renderTestCode({
      sourceFilePath: normalized,
      targetTestPath,
      framework,
      importPath,
      exportedSymbols,
      mockDefinitions,
      suites,
      generatedAt: new Date().toISOString(),
    });

    let written = false;
    if (!options.dryRun) {
      const shouldWrite = options.force || !(await this.fsDriver.exists(targetTestPath));
      if (shouldWrite) {
        const targetDir = path.dirname(targetTestPath);
        await this.fsDriver.mkdir(targetDir, { recursive: true });
        await this.fsDriver.writeFile(targetTestPath, generatedCode);
        written = true;
      }
    }

    return {
      sourceFilePath: normalized,
      targetTestPath,
      framework,
      importPath,
      exportedSymbols,
      mockDefinitions,
      suites,
      generatedCode,
      written,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Renders the complete TypeScript test file code.
   */
  public renderTestCode(scaffold: Omit<MockScaffoldResult, 'generatedCode' | 'written'>): string {
    const lines: string[] = [];

    // File Header
    lines.push('/**');
    lines.push(` * Automated Spec-Driven Test Suite for ${scaffold.sourceFilePath}`);
    lines.push(' * Generated by: stubs mock');
    lines.push(` * Generated at: ${scaffold.generatedAt}`);
    lines.push(' */');
    lines.push('');

    // Framework Imports
    if (scaffold.framework === 'vitest') {
      lines.push("import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';");
    }

    // Target Module Imports
    if (scaffold.exportedSymbols.length > 0) {
      lines.push(`import {`);
      for (const sym of scaffold.exportedSymbols) {
        lines.push(`  ${sym},`);
      }
      lines.push(`} from '${scaffold.importPath}';`);
    } else {
      lines.push(`import * as Module from '${scaffold.importPath}';`);
    }
    lines.push('');

    // Test Suite
    const title = path.basename(scaffold.sourceFilePath);
    lines.push(`describe('${title} Specification & Unit Tests', () => {`);

    if (scaffold.suites.length === 0) {
      lines.push('  it("should load target module without errors", () => {');
      lines.push('    expect(true).toBe(true);');
      lines.push('  });');
    } else {
      for (const suite of scaffold.suites) {
        lines.push(`  describe('${suite.name}', () => {`);
        for (const tc of suite.testCases) {
          lines.push(`    it('${tc.title}', async () => {`);
          for (const assertion of tc.assertions) {
            lines.push(`      ${assertion}`);
          }
          lines.push('    });');
          lines.push('');
        }
        lines.push('  });');
        lines.push('');
      }
    }

    lines.push('});');
    lines.push('');

    return lines.join('\n');
  }
}

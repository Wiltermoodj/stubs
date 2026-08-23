import * as ts from 'typescript';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface TypeCheckResult {
  success: boolean;
  diagnostics: string[];
}

/**
 * Computes an AST structural hash for code, ignoring cosmetic formatting, spacing, and comments.
 * For TypeScript/JavaScript, parses TS AST. For other languages, uses normalized token/line hashing.
 */
export function getAstStructuralHash(code: string, fileName = 'file.ts'): string {
  const ext = path.extname(fileName).toLowerCase();
  const isTsOrJs = ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx' || !ext;

  if (isTsOrJs) {
    try {
      // Parse code into TypeScript AST
      const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);

      const nodes: string[] = [];

      function visit(node: ts.Node) {
        let detail = '';
        if (ts.isIdentifier(node)) {
          detail = `:${node.text}`;
        }
        // Record node kind and identifier detail (ignore literal values for structural comparison)
        nodes.push(`${node.kind}${detail}`);
        ts.forEachChild(node, visit);
      }

      visit(sourceFile);
      const serialized = nodes.join(',');
      return crypto.createHash('sha256').update(serialized).digest('hex');
    } catch {
      // Fall through to normalized hash on parse errors
    }
  }

  // Non-TS / Fallback structural hash: strips comments and normalizes whitespace
  const normalized = code
    .replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '')
    .replace(/^\s*#.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

interface CachedAstConfig {
  mtimeMs: number;
  compilerOptions: ts.CompilerOptions;
}

let astConfigCache: CachedAstConfig | null = null;

function getAstCompilerOptions(): ts.CompilerOptions {
  let compilerOptions: ts.CompilerOptions = {
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
  };

  const tsconfigPath = path.resolve('tsconfig.json');
  if (fs.existsSync(tsconfigPath)) {
    try {
      const stat = fs.statSync(tsconfigPath);
      if (astConfigCache && astConfigCache.mtimeMs === stat.mtimeMs) {
        return { ...astConfigCache.compilerOptions };
      }

      const tsconfigContent = fs.readFileSync(tsconfigPath, 'utf8');
      const parsed = ts.parseConfigFileTextToJson(tsconfigPath, tsconfigContent);
      if (parsed.config) {
        const parsedOptions = ts.parseJsonConfigFileContent(
          parsed.config,
          ts.sys,
          path.dirname(tsconfigPath),
        );
        compilerOptions = {
          ...parsedOptions.options,
          ...compilerOptions,
          noEmit: true,
        };
        delete compilerOptions.rootDir;
        delete compilerOptions.rootDirs;

        astConfigCache = {
          mtimeMs: stat.mtimeMs,
          compilerOptions: { ...compilerOptions },
        };
      }
    } catch {
      // Gracefully fall back to defaults if parsing fails
    }
  }

  return compilerOptions;
}

/**
 * Executes in-memory TypeScript compilation and semantic type-checking using TS Compiler API.
 * Uses virtual files, resolves actual imports from disk, and loads options from tsconfig.json if available.
 */
export function typeCheckCode(filePath: string, code: string): TypeCheckResult {
  const absoluteFilePath = path.resolve(filePath);
  const compilerOptions = getAstCompilerOptions();

  const sourceFile = ts.createSourceFile(absoluteFilePath, code, ts.ScriptTarget.Latest, true);

  // In-memory compiler host
  const compilerHost: ts.CompilerHost = {
    getSourceFile: (fileName) => {
      const resolved = path.resolve(fileName);
      if (resolved === absoluteFilePath) {
        return sourceFile;
      }
      if (fs.existsSync(resolved)) {
        try {
          const content = fs.readFileSync(resolved, 'utf8');
          return ts.createSourceFile(resolved, content, ts.ScriptTarget.Latest, true);
        } catch {
          return undefined;
        }
      }
      return undefined;
    },
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    writeFile: () => {},
    getCurrentDirectory: () => process.cwd(),
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (fileName) => {
      const resolved = path.resolve(fileName);
      if (resolved === absoluteFilePath) return true;
      return fs.existsSync(resolved);
    },
    readFile: (fileName) => {
      const resolved = path.resolve(fileName);
      if (resolved === absoluteFilePath) return code;
      if (fs.existsSync(resolved)) {
        try {
          return fs.readFileSync(resolved, 'utf8');
        } catch {
          return undefined;
        }
      }
      return undefined;
    },
  };

  try {
    const program = ts.createProgram([absoluteFilePath], compilerOptions, compilerHost);
    const emitResult = program.emit();
    const allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);

    const diagnostics: string[] = [];
    for (const diagnostic of allDiagnostics) {
      if (diagnostic.file) {
        const { line, character } = ts.getLineAndCharacterOfPosition(
          diagnostic.file,
          diagnostic.start!,
        );
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
        diagnostics.push(`${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`);
      } else {
        diagnostics.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
      }
    }

    return {
      success: diagnostics.length === 0,
      diagnostics,
    };
  } catch (err: any) {
    return {
      success: false,
      diagnostics: [`Compilation failed: ${err.message || err}`],
    };
  }
}

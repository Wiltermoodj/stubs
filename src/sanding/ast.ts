import * as ts from 'typescript';
import * as crypto from 'crypto';
import * as path from 'path';
import { typeCheckVirtualFile, TypeCheckResult } from '../compiler/typechecker';

export { TypeCheckResult } from '../compiler/typechecker';

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
      const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, false);

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

/**
 * Executes in-memory TypeScript compilation and semantic type-checking using TS Compiler API.
 * Delegates to the unified compiler typechecker module with virtual overlay and program reuse.
 */
export function typeCheckCode(filePath: string, code: string): TypeCheckResult {
  return typeCheckVirtualFile(filePath, code);
}

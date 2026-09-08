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

export interface InterfaceDriftReport {
  hasDrift: boolean;
  missingInCode: string[];
  undocumentedExports: string[];
  declaredExports: string[];
  actualExports: string[];
}

/**
 * Checks for signature and export drift between declared sidecar exports and actual code AST.
 */
export function checkInterfaceDrift(
  declaredExports: string[] = [],
  sourceCode: string,
  fileName = 'file.ts',
): InterfaceDriftReport {
  const ext = path.extname(fileName).toLowerCase();
  const isTsOrJs = ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx' || !ext;

  const actualExports: string[] = [];
  if (isTsOrJs) {
    try {
      const sourceFile = ts.createSourceFile(fileName, sourceCode, ts.ScriptTarget.Latest, false);
      for (const statement of sourceFile.statements) {
        const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
        const isExported = modifiers?.some(
          (m) => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword,
        );

        if (isExported) {
          if (
            (ts.isFunctionDeclaration(statement) ||
              ts.isClassDeclaration(statement) ||
              ts.isInterfaceDeclaration(statement) ||
              ts.isTypeAliasDeclaration(statement) ||
              ts.isEnumDeclaration(statement)) &&
            statement.name
          ) {
            actualExports.push(statement.name.text);
          } else if (ts.isVariableStatement(statement)) {
            for (const decl of statement.declarationList.declarations) {
              if (ts.isIdentifier(decl.name)) {
                actualExports.push(decl.name.text);
              }
            }
          }
        } else if (ts.isExportDeclaration(statement)) {
          if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
            for (const element of statement.exportClause.elements) {
              actualExports.push(element.name.text);
            }
          }
        }
      }
    } catch {
      // Fallback
    }
  }

  const declaredSet = new Set(declaredExports);
  const actualSet = new Set(actualExports);

  const missingInCode = declaredExports.filter((e) => !actualSet.has(e));
  const undocumentedExports = actualExports.filter((e) => !declaredSet.has(e));

  return {
    hasDrift: missingInCode.length > 0 || undocumentedExports.length > 0,
    missingInCode,
    undocumentedExports,
    declaredExports,
    actualExports,
  };
}

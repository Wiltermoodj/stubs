import * as path from 'path';
import * as ts from 'typescript';
import { parseOkfSpec } from '../parser/okf';
import { extractImplementationCode } from '../parser/markdown';
import { normalizePosixPath } from './engine';

export type EdgeConfidence = 'EXTRACTED' | 'DECLARED' | 'INFERRED' | 'AMBIGUOUS';

export interface GraphNode {
  id: string; // e.g. "src/services/bike-service.ts" or "src/services/bike-service.ts#BikeService"
  file_path: string;
  symbol_name?: string | null;
  kind:
    | 'file'
    | 'sidecar'
    | 'class'
    | 'function'
    | 'method'
    | 'interface'
    | 'type'
    | 'variable'
    | 'concept'
    | 'symbol';
  domain?: string | null;
  lifecycle_phase?: string | null;
  loc_start?: number | null;
  loc_end?: number | null;
}

export interface GraphEdge {
  source_id: string;
  target_id: string;
  relation: 'imports' | 'calls' | 'depends_on' | 'implements' | 'exports' | 'contains';
  confidence?: EdgeConfidence;
  weight?: number;
}

export interface ExtractedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Resolves a module specifier (e.g. "./other", "../utils") relative to a source file path.
 */
export function resolveRelativeImport(sourceFilePath: string, importSpecifier: string): string {
  if (!importSpecifier.startsWith('.')) {
    return importSpecifier;
  }
  const dir = path.dirname(sourceFilePath);
  const resolved = path.join(dir, importSpecifier);
  return normalizePosixPath(resolved);
}

/**
 * Extracts symbols, definitions, calls, and imports from a source code or OKF file.
 */
export function extractFileGraph(
  filePath: string,
  content: string,
  options: { domain?: string; phase?: string } = {},
): ExtractedGraph {
  const normPath = normalizePosixPath(filePath);
  const ext = path.extname(normPath).toLowerCase();
  const domain = options.domain || null;
  const phase = options.phase || null;

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // 1. If it's a Markdown OKF sidecar or blueprint
  if (ext === '.md') {
    return extractMarkdownGraph(normPath, content, domain, phase);
  }

  // 2. Base file node
  const fileNodeId = normPath;
  nodes.push({
    id: fileNodeId,
    file_path: normPath,
    symbol_name: null,
    kind: 'file',
    domain,
    lifecycle_phase: phase,
  });

  // 3. TypeScript / JavaScript AST Extraction
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    extractTypeScriptGraph(normPath, content, fileNodeId, domain, phase, nodes, edges);
    return { nodes, edges };
  }

  // 4. Python Pattern Extraction
  if (ext === '.py') {
    extractPythonGraph(normPath, content, fileNodeId, domain, phase, nodes, edges);
    return { nodes, edges };
  }

  // 5. Rust Pattern Extraction
  if (ext === '.rs') {
    extractRustGraph(normPath, content, fileNodeId, domain, phase, nodes, edges);
    return { nodes, edges };
  }

  // 6. Go Pattern Extraction
  if (ext === '.go') {
    extractGoGraph(normPath, content, fileNodeId, domain, phase, nodes, edges);
    return { nodes, edges };
  }

  // Generic fallback: line-by-line import search
  extractGenericGraph(normPath, content, fileNodeId, domain, phase, nodes, edges);
  return { nodes, edges };
}

/**
 * Extracts graph nodes and edges from Markdown / OKF sidecar files.
 */
function extractMarkdownGraph(
  filePath: string,
  content: string,
  domain: string | null,
  phase: string | null,
): ExtractedGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const sidecarNodeId = filePath;
  const parseResult = parseOkfSpec(content);
  const frontmatter = parseResult.frontmatter;

  const effectiveDomain = frontmatter?.domain || domain || null;
  const effectivePhase = frontmatter?.phase || frontmatter?.status || phase || null;

  nodes.push({
    id: sidecarNodeId,
    file_path: filePath,
    symbol_name: null,
    kind: 'sidecar',
    domain: effectiveDomain,
    lifecycle_phase: effectivePhase,
  });

  if (frontmatter) {
    // If sidecar targets a specific code file, link them
    if (frontmatter.target_code_file) {
      const codeTarget = resolveRelativeImport(filePath, frontmatter.target_code_file);
      edges.push({
        source_id: sidecarNodeId,
        target_id: codeTarget,
        relation: 'implements',
        confidence: 'DECLARED',
        weight: 1.0,
      });
    }

    // Depends on links
    if (Array.isArray(frontmatter.depends_on)) {
      for (const dep of frontmatter.depends_on) {
        if (!dep) continue;
        const resolvedDep = resolveRelativeImport(filePath, dep);
        edges.push({
          source_id: sidecarNodeId,
          target_id: resolvedDep,
          relation: 'depends_on',
          confidence: 'DECLARED',
          weight: 1.0,
        });
      }
    }

    // Used by links
    if (Array.isArray(frontmatter.used_by)) {
      for (const user of frontmatter.used_by) {
        if (!user) continue;
        const resolvedUser = resolveRelativeImport(filePath, user);
        edges.push({
          source_id: resolvedUser,
          target_id: sidecarNodeId,
          relation: 'depends_on',
          confidence: 'DECLARED',
          weight: 1.0,
        });
      }
    }

    // Exports declared in frontmatter
    if (Array.isArray(frontmatter.exports)) {
      for (const exp of frontmatter.exports) {
        if (!exp) continue;
        const expNodeId = `${filePath}#${exp}`;
        nodes.push({
          id: expNodeId,
          file_path: filePath,
          symbol_name: exp,
          kind: 'symbol',
          domain: effectiveDomain,
          lifecycle_phase: effectivePhase,
        });
        edges.push({
          source_id: sidecarNodeId,
          target_id: expNodeId,
          relation: 'exports',
          confidence: 'DECLARED',
          weight: 1.0,
        });
      }
    }
  }

  // Extract embedded code blocks if present
  const embeddedCode = extractImplementationCode(content);
  if (embeddedCode) {
    const targetCodeExt = frontmatter?.target_code_file
      ? path.extname(frontmatter.target_code_file).toLowerCase()
      : '.ts';

    if (['.ts', '.tsx', '.js', '.jsx'].includes(targetCodeExt)) {
      extractTypeScriptGraph(
        filePath,
        embeddedCode,
        sidecarNodeId,
        effectiveDomain,
        effectivePhase,
        nodes,
        edges,
      );
    }
  }

  return { nodes, edges };
}

/**
 * Deep TypeScript AST extraction.
 */
function extractTypeScriptGraph(
  filePath: string,
  code: string,
  fileNodeId: string,
  domain: string | null,
  phase: string | null,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  try {
    const sourceFile = ts.createSourceFile(
      filePath,
      code,
      ts.ScriptTarget.Latest,
      true, // setParentNodes
    );

    const importedSymbolsMap: Map<string, string> = new Map(); // localSymbol -> modulePath

    // First pass: extract imports and top-level definitions
    function visitNode(node: ts.Node) {
      // 1. Imports
      if (ts.isImportDeclaration(node)) {
        const moduleSpecifier = (node.moduleSpecifier as ts.StringLiteral).text;
        const resolvedModule = resolveRelativeImport(filePath, moduleSpecifier);

        // Edge from file to imported module
        edges.push({
          source_id: fileNodeId,
          target_id: resolvedModule,
          relation: 'imports',
          confidence: 'EXTRACTED',
          weight: 1.0,
        });

        // Track named imports
        if (node.importClause) {
          if (node.importClause.name) {
            importedSymbolsMap.set(node.importClause.name.text, resolvedModule);
          }
          if (node.importClause.namedBindings) {
            if (ts.isNamedImports(node.importClause.namedBindings)) {
              for (const elem of node.importClause.namedBindings.elements) {
                importedSymbolsMap.set(elem.name.text, resolvedModule);
              }
            } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
              importedSymbolsMap.set(node.importClause.namedBindings.name.text, resolvedModule);
            }
          }
        }
      }

      // 2. Class declarations
      if (ts.isClassDeclaration(node) && node.name) {
        const className = node.name.text;
        const classNodeId = `${filePath}#${className}`;
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

        nodes.push({
          id: classNodeId,
          file_path: filePath,
          symbol_name: className,
          kind: 'class',
          domain,
          lifecycle_phase: phase,
          loc_start: start.line + 1,
          loc_end: end.line + 1,
        });

        edges.push({
          source_id: fileNodeId,
          target_id: classNodeId,
          relation: 'contains',
          confidence: 'EXTRACTED',
          weight: 1.0,
        });

        // Inheritance (extends / implements)
        if (node.heritageClauses) {
          for (const hc of node.heritageClauses) {
            for (const typeNode of hc.types) {
              const typeName = typeNode.expression.getText(sourceFile);
              const importedFrom = importedSymbolsMap.get(typeName);
              const targetId = importedFrom ? `${importedFrom}#${typeName}` : typeName;
              edges.push({
                source_id: classNodeId,
                target_id: targetId,
                relation: 'implements',
                confidence: 'EXTRACTED',
                weight: 1.0,
              });
            }
          }
        }
      }

      // 3. Function declarations
      if (ts.isFunctionDeclaration(node) && node.name) {
        const funcName = node.name.text;
        const funcNodeId = `${filePath}#${funcName}`;
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

        nodes.push({
          id: funcNodeId,
          file_path: filePath,
          symbol_name: funcName,
          kind: 'function',
          domain,
          lifecycle_phase: phase,
          loc_start: start.line + 1,
          loc_end: end.line + 1,
        });

        edges.push({
          source_id: fileNodeId,
          target_id: funcNodeId,
          relation: 'contains',
          confidence: 'EXTRACTED',
          weight: 1.0,
        });
      }

      // 4. Interface declarations
      if (ts.isInterfaceDeclaration(node) && node.name) {
        const interfaceName = node.name.text;
        const interfaceNodeId = `${filePath}#${interfaceName}`;
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

        nodes.push({
          id: interfaceNodeId,
          file_path: filePath,
          symbol_name: interfaceName,
          kind: 'interface',
          domain,
          lifecycle_phase: phase,
          loc_start: start.line + 1,
          loc_end: end.line + 1,
        });

        edges.push({
          source_id: fileNodeId,
          target_id: interfaceNodeId,
          relation: 'contains',
          confidence: 'EXTRACTED',
          weight: 1.0,
        });
      }

      // 5. Type alias declarations
      if (ts.isTypeAliasDeclaration(node) && node.name) {
        const typeName = node.name.text;
        const typeNodeId = `${filePath}#${typeName}`;
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

        nodes.push({
          id: typeNodeId,
          file_path: filePath,
          symbol_name: typeName,
          kind: 'type',
          domain,
          lifecycle_phase: phase,
          loc_start: start.line + 1,
          loc_end: end.line + 1,
        });

        edges.push({
          source_id: fileNodeId,
          target_id: typeNodeId,
          relation: 'contains',
          confidence: 'EXTRACTED',
          weight: 1.0,
        });
      }

      // 6. Call Expressions (Calls)
      if (ts.isCallExpression(node)) {
        const exprText = node.expression.getText(sourceFile);
        const callName = exprText.split('.').pop() || exprText;
        const importedFrom = importedSymbolsMap.get(exprText.split('.')[0]);

        if (importedFrom) {
          edges.push({
            source_id: fileNodeId,
            target_id: `${importedFrom}#${callName}`,
            relation: 'calls',
            confidence: 'EXTRACTED',
            weight: 1.0,
          });
        }
      }

      ts.forEachChild(node, visitNode);
    }

    visitNode(sourceFile);
  } catch {
    // Fallback to pattern extraction on parse failure
    extractGenericGraph(filePath, code, fileNodeId, domain, phase, nodes, edges);
  }
}

/**
 * Pattern-based Python AST extraction.
 */
function extractPythonGraph(
  filePath: string,
  code: string,
  fileNodeId: string,
  domain: string | null,
  phase: string | null,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // 1. from x import y, z
    const fromMatch = line.match(/^\s*from\s+([a-zA-Z0-9_.]+)\s+import\s+(.+)$/);
    if (fromMatch) {
      const modulePath = resolveRelativeImport(filePath, fromMatch[1].replace(/\./g, '/'));
      edges.push({
        source_id: fileNodeId,
        target_id: modulePath,
        relation: 'imports',
        confidence: 'EXTRACTED',
        weight: 1.0,
      });

      const symbols = fromMatch[2].split(',').map((s) => s.trim());
      for (const sym of symbols) {
        const cleanSym = sym.split(/\s+as\s+/)[0].trim();
        if (cleanSym && cleanSym !== '*') {
          edges.push({
            source_id: fileNodeId,
            target_id: `${modulePath}#${cleanSym}`,
            relation: 'imports',
            confidence: 'EXTRACTED',
            weight: 1.0,
          });
        }
      }
      continue;
    }

    // 2. import x
    const importMatch = line.match(/^\s*import\s+([a-zA-Z0-9_.]+)/);
    if (importMatch) {
      const modulePath = resolveRelativeImport(filePath, importMatch[1].replace(/\./g, '/'));
      edges.push({
        source_id: fileNodeId,
        target_id: modulePath,
        relation: 'imports',
        confidence: 'EXTRACTED',
        weight: 1.0,
      });
      continue;
    }

    // 3. class ClassName(BaseClass):
    const classMatch = line.match(/^\s*class\s+([a-zA-Z0-9_]+)(?:\(([^)]+)\))?:/);
    if (classMatch) {
      const className = classMatch[1];
      const classId = `${filePath}#${className}`;
      nodes.push({
        id: classId,
        file_path: filePath,
        symbol_name: className,
        kind: 'class',
        domain,
        lifecycle_phase: phase,
        loc_start: lineNum,
      });
      edges.push({
        source_id: fileNodeId,
        target_id: classId,
        relation: 'contains',
        confidence: 'EXTRACTED',
        weight: 1.0,
      });

      if (classMatch[2]) {
        const bases = classMatch[2].split(',').map((b) => b.trim());
        for (const base of bases) {
          edges.push({
            source_id: classId,
            target_id: base,
            relation: 'implements',
            confidence: 'EXTRACTED',
            weight: 1.0,
          });
        }
      }
      continue;
    }

    // 4. def func_name(...):
    const funcMatch = line.match(/^\s*def\s+([a-zA-Z0-9_]+)\s*\(/);
    if (funcMatch) {
      const funcName = funcMatch[1];
      const funcId = `${filePath}#${funcName}`;
      nodes.push({
        id: funcId,
        file_path: filePath,
        symbol_name: funcName,
        kind: 'function',
        domain,
        lifecycle_phase: phase,
        loc_start: lineNum,
      });
      edges.push({
        source_id: fileNodeId,
        target_id: funcId,
        relation: 'contains',
        confidence: 'EXTRACTED',
        weight: 1.0,
      });
    }
  }
}

/**
 * Pattern-based Rust AST extraction.
 */
function extractRustGraph(
  filePath: string,
  code: string,
  fileNodeId: string,
  domain: string | null,
  phase: string | null,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // use crate::foo::bar; or use foo::{bar, baz};
    const useMatch = line.match(/^\s*(?:pub\s+)?use\s+([^;]+);/);
    if (useMatch) {
      const rawUse = useMatch[1].trim();
      if (rawUse.includes('{')) {
        const groupMatch = rawUse.match(/^(.+?)::\{([^}]+)\}/);
        if (groupMatch) {
          const prefix = groupMatch[1].replace(/::/g, '/').trim();
          const items = groupMatch[2]
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          for (const item of items) {
            const cleanItem = item.split(/\s+as\s+/)[0].trim();
            const target = `${prefix}/${cleanItem}`;
            edges.push({
              source_id: fileNodeId,
              target_id: target,
              relation: 'imports',
              confidence: 'EXTRACTED',
              weight: 1.0,
            });
          }
        }
      } else {
        const modulePath = rawUse.replace(/::/g, '/').trim();
        edges.push({
          source_id: fileNodeId,
          target_id: modulePath,
          relation: 'imports',
          confidence: 'EXTRACTED',
          weight: 1.0,
        });
      }
      continue;
    }

    // pub fn / fn
    const fnMatch = line.match(/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_]+)\s*\(/);
    if (fnMatch) {
      const fnName = fnMatch[1];
      const fnId = `${filePath}#${fnName}`;
      nodes.push({
        id: fnId,
        file_path: filePath,
        symbol_name: fnName,
        kind: 'function',
        domain,
        lifecycle_phase: phase,
        loc_start: lineNum,
      });
      edges.push({
        source_id: fileNodeId,
        target_id: fnId,
        relation: 'contains',
        confidence: 'EXTRACTED',
        weight: 1.0,
      });
      continue;
    }

    // pub struct / struct / enum / trait
    const structMatch = line.match(/^\s*(?:pub\s+)?(struct|enum|trait)\s+([a-zA-Z0-9_]+)/);
    if (structMatch) {
      const kind = structMatch[1] === 'trait' ? 'interface' : 'class';
      const name = structMatch[2];
      const id = `${filePath}#${name}`;
      nodes.push({
        id,
        file_path: filePath,
        symbol_name: name,
        kind: kind as any,
        domain,
        lifecycle_phase: phase,
        loc_start: lineNum,
      });
      edges.push({
        source_id: fileNodeId,
        target_id: id,
        relation: 'contains',
        confidence: 'EXTRACTED',
        weight: 1.0,
      });
    }
  }
}

/**
 * Pattern-based Go AST extraction.
 */
function extractGoGraph(
  filePath: string,
  code: string,
  fileNodeId: string,
  domain: string | null,
  phase: string | null,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const lines = code.split('\n');
  let inMultiImport = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Multi-line import block import ( ... )
    if (line.match(/^\s*import\s*\(/)) {
      inMultiImport = true;
      continue;
    }
    if (inMultiImport) {
      if (line.match(/^\s*\)/)) {
        inMultiImport = false;
        continue;
      }
      const singleMatch = line.match(/["']([^"']+)["']/);
      if (singleMatch) {
        edges.push({
          source_id: fileNodeId,
          target_id: singleMatch[1],
          relation: 'imports',
          confidence: 'EXTRACTED',
          weight: 1.0,
        });
      }
      continue;
    }

    // Single-line import "foo/bar"
    const importMatch = line.match(/^\s*import\s+(?:[a-zA-Z0-9_]+\s+)?["']([^"']+)["']/);
    if (importMatch) {
      edges.push({
        source_id: fileNodeId,
        target_id: importMatch[1],
        relation: 'imports',
        confidence: 'EXTRACTED',
        weight: 1.0,
      });
      continue;
    }

    // func (r *Receiver) Method() or func FuncName()
    const funcMatch = line.match(/^\s*func\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_]+)\s*\(/);
    if (funcMatch) {
      const funcName = funcMatch[1];
      const funcId = `${filePath}#${funcName}`;
      nodes.push({
        id: funcId,
        file_path: filePath,
        symbol_name: funcName,
        kind: 'function',
        domain,
        lifecycle_phase: phase,
        loc_start: lineNum,
      });
      edges.push({
        source_id: fileNodeId,
        target_id: funcId,
        relation: 'contains',
        confidence: 'EXTRACTED',
        weight: 1.0,
      });
      continue;
    }

    // type StructName struct / interface
    const typeMatch = line.match(/^\s*type\s+([a-zA-Z0-9_]+)\s+(struct|interface)/);
    if (typeMatch) {
      const name = typeMatch[1];
      const kind = typeMatch[2] === 'interface' ? 'interface' : 'class';
      const id = `${filePath}#${name}`;
      nodes.push({
        id,
        file_path: filePath,
        symbol_name: name,
        kind: kind as any,
        domain,
        lifecycle_phase: phase,
        loc_start: lineNum,
      });
      edges.push({
        source_id: fileNodeId,
        target_id: id,
        relation: 'contains',
        confidence: 'EXTRACTED',
        weight: 1.0,
      });
    }
  }
}

/**
 * Generic fallback extraction for other files.
 */
function extractGenericGraph(
  filePath: string,
  code: string,
  fileNodeId: string,
  domain: string | null,
  phase: string | null,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const lines = code.split('\n');
  for (const line of lines) {
    const requireMatch = line.match(/require\(['"]([^'"]+)['"]\)/);
    if (requireMatch) {
      const resolved = resolveRelativeImport(filePath, requireMatch[1]);
      edges.push({
        source_id: fileNodeId,
        target_id: resolved,
        relation: 'imports',
        confidence: 'INFERRED',
        weight: 1.0,
      });
    }
  }
}

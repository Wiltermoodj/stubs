export type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'code'; lang: string; content: string }
  | { type: 'text'; content: string };

/**
 * Parses raw markdown body into structured blocks (Headings, Code blocks, and Text blocks).
 * Pulls all string matching and state management complexity downward.
 */
export function parseMarkdown(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];

  let inCodeBlock = false;
  let codeLang = '';
  let codeLines: string[] = [];
  let textLines: string[] = [];

  const flushText = () => {
    if (textLines.length > 0) {
      blocks.push({ type: 'text', content: textLines.join('\n') });
      textLines = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inCodeBlock) {
      if (line.trim().startsWith('```')) {
        blocks.push({ type: 'code', lang: codeLang, content: codeLines.join('\n') });
        codeLines = [];
        inCodeBlock = false;
      } else {
        codeLines.push(line);
      }
    } else {
      if (line.trim().startsWith('```')) {
        flushText();
        inCodeBlock = true;
        codeLang = line.trim().substring(3).trim();
      } else {
        const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch) {
          flushText();
          blocks.push({
            type: 'heading',
            level: headingMatch[1].length,
            text: headingMatch[2].trim(),
          });
        } else {
          textLines.push(line);
        }
      }
    }
  }
  flushText();
  return blocks;
}

/**
 * Extracts TypeScript code blocks from the ## Implementation section of parsed Markdown blocks.
 * If no ## Implementation heading is found, or if it does not contain typescript code blocks,
 * returns an appropriate error description.
 *
 * Key behavior: finds the ## Implementation heading that has typescript code blocks
 * immediately following it (before any same-level or higher heading), preferring the
 * last such section when multiple exist (e.g., ## Current implementation precedes
 * ## Implementation).
 */
export function extractImplementationCode(blocks: MarkdownBlock[]): {
  code: string | null;
  error: string | null;
} {
  // Find all headings matching "Implementation" (with optional numbering prefix)
  const implHeadingIndices: number[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'heading' && /^(?:\d+\.\s+)?implementation$/i.test(b.text)) {
      implHeadingIndices.push(i);
    }
  }

  if (implHeadingIndices.length === 0) {
    return {
      code: null,
      error: 'No "## Implementation" section found in the sidecar specification.',
    };
  }

  // Search from last to first to prefer the final Implementation section
  // (handles cases where ## Current implementation precedes ## Implementation)
  for (let j = implHeadingIndices.length - 1; j >= 0; j--) {
    const implIdx = implHeadingIndices[j];
    const headingLevel = (blocks[implIdx] as any).level;
    const tsBlocks: string[] = [];

    for (let i = implIdx + 1; i < blocks.length; i++) {
      const block = blocks[i];
      if (block.type === 'heading' && block.level <= headingLevel) {
        break;
      }
      if (block.type === 'code' && (block.lang === 'typescript' || block.lang === 'ts')) {
        tsBlocks.push(block.content);
      }
    }

    if (tsBlocks.length > 0) {
      return { code: tsBlocks.join('\n\n'), error: null };
    }
  }

  // No Implementation section contained typescript code blocks
  return {
    code: null,
    error: 'No typescript code block found within any "## Implementation" section.',
  };
}

import * as ts from 'typescript';

/**
 * Extracts exported TypeScript signatures (types, interfaces, enums, and functions/classes with bodies stripped)
 * to produce a lightweight, token-efficient interface contract for LLM agent context windows.
 */
export function extractDistilledSignatures(sourceCode: string, fileName = 'module.ts'): string {
  try {
    const sourceFile = ts.createSourceFile(fileName, sourceCode, ts.ScriptTarget.Latest, false);
    const distilledParts: string[] = [];

    for (const statement of sourceFile.statements) {
      // Check if exported
      const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
      const isExported =
        modifiers?.some(
          (m) => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword,
        ) ||
        ts.isExportDeclaration(statement) ||
        ts.isExportAssignment(statement);

      if (!isExported) {
        continue;
      }

      // Handle Interfaces, Type Aliases, and Enums directly
      if (
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isExportDeclaration(statement) ||
        ts.isExportAssignment(statement)
      ) {
        distilledParts.push(statement.getFullText(sourceFile).trim());
        continue;
      }

      // Handle Function Declarations: strip body
      if (ts.isFunctionDeclaration(statement)) {
        const name = statement.name ? statement.name.text : 'anonymous';
        const typeParams = statement.typeParameters
          ? `<${statement.typeParameters.map((tp) => tp.getText(sourceFile)).join(', ')}>`
          : '';
        const params = statement.parameters.map((p) => p.getText(sourceFile)).join(', ');
        const returnType = statement.type ? `: ${statement.type.getText(sourceFile)}` : '';
        const isAsync = modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
          ? 'async '
          : '';

        distilledParts.push(
          `export ${isAsync}function ${name}${typeParams}(${params})${returnType};`,
        );
        continue;
      }

      // Handle Class Declarations: strip method bodies
      if (ts.isClassDeclaration(statement)) {
        const name = statement.name ? statement.name.text : 'AnonymousClass';
        const typeParams = statement.typeParameters
          ? `<${statement.typeParameters.map((tp) => tp.getText(sourceFile)).join(', ')}>`
          : '';
        const heritage = statement.heritageClauses
          ? ' ' + statement.heritageClauses.map((h) => h.getText(sourceFile)).join(' ')
          : '';

        const memberSignatures: string[] = [];
        for (const member of statement.members) {
          const memberModifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined;
          const isPrivate = memberModifiers?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword);
          if (isPrivate) {
            continue; // Omit private members from distilled public interface
          }

          const modStr = memberModifiers
            ? memberModifiers.map((m) => m.getText(sourceFile)).join(' ') + ' '
            : '';

          if (ts.isPropertyDeclaration(member)) {
            const propName = member.name.getText(sourceFile);
            const propType = member.type ? `: ${member.type.getText(sourceFile)}` : '';
            memberSignatures.push(`  ${modStr}${propName}${propType};`);
          } else if (ts.isMethodDeclaration(member)) {
            const methodName = member.name.getText(sourceFile);
            const mTypeParams = member.typeParameters
              ? `<${member.typeParameters.map((tp) => tp.getText(sourceFile)).join(', ')}>`
              : '';
            const mParams = member.parameters.map((p) => p.getText(sourceFile)).join(', ');
            const mReturnType = member.type ? `: ${member.type.getText(sourceFile)}` : '';
            memberSignatures.push(
              `  ${modStr}${methodName}${mTypeParams}(${mParams})${mReturnType};`,
            );
          } else if (ts.isConstructorDeclaration(member)) {
            const cParams = member.parameters.map((p) => p.getText(sourceFile)).join(', ');
            memberSignatures.push(`  ${modStr}constructor(${cParams});`);
          }
        }

        distilledParts.push(
          `export class ${name}${typeParams}${heritage} {\n${memberSignatures.join('\n')}\n}`,
        );
        continue;
      }

      // Handle Variable Statements (const/let exports)
      if (ts.isVariableStatement(statement)) {
        const declList = statement.declarationList;
        const decls: string[] = [];
        for (const decl of declList.declarations) {
          const varName = decl.name.getText(sourceFile);
          const varType = decl.type ? `: ${decl.type.getText(sourceFile)}` : '';
          decls.push(`${varName}${varType}`);
        }
        const isConst = (declList.flags & ts.NodeFlags.Const) !== 0;
        const kindStr = isConst ? 'const' : 'let';
        distilledParts.push(`export ${kindStr} ${decls.join(', ')};`);
        continue;
      }

      // Fallback for any other exported statement
      distilledParts.push(statement.getFullText(sourceFile).trim());
    }

    return distilledParts.join('\n\n');
  } catch {
    // If AST parsing fails, return normalized raw code fallback
    return sourceCode
      .split('\n')
      .filter((l) => l.trim().startsWith('export '))
      .join('\n');
  }
}

/**
 * Extracts the names of all exported symbols (types, functions, classes, interfaces, constants) from source code.
 */
export function extractExportedSymbolNames(sourceCode: string, fileName = 'module.ts'): string[] {
  try {
    const sourceFile = ts.createSourceFile(fileName, sourceCode, ts.ScriptTarget.Latest, false);
    const symbols: string[] = [];

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
          symbols.push(statement.name.text);
        } else if (ts.isVariableStatement(statement)) {
          for (const decl of statement.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) {
              symbols.push(decl.name.text);
            }
          }
        }
      } else if (ts.isExportDeclaration(statement)) {
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            symbols.push(element.name.text);
          }
        }
      }
    }

    return Array.from(new Set(symbols));
  } catch {
    return [];
  }
}

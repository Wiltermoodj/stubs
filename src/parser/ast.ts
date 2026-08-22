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

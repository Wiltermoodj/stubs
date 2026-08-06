/**
 * Parses markdown and extracts TypeScript code blocks.
 */

/**
 * Extracts the first TypeScript block under a section matching "Implementation" (case-insensitive).
 * If no such block exists, it falls back to extracting the first TypeScript block in the file.
 * Returns null if no TypeScript block is found.
 */
export function extractImplementationCode(body: string): string | null {
  if (!body) return null;

  const lines = body.replace(/\r\n/g, '\n').split('\n');
  let inImplementationSection = false;
  const codeBlockLines: string[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for an Implementation header, e.g. "## Implementation" or "## 5. Implementation" or "# Implementation"
    if (/^\s*#+\s*(?:\d+\.\s*)?Implementation/i.test(line)) {
      inImplementationSection = true;
      continue;
    }

    // If we are in the implementation section and we hit another header of equal or higher level (less or equal number of #),
    // and we already collected some code, we can stop.
    // However, to keep it simple and robust, we check if we find a code block.
    if (inImplementationSection && /^\s*#+\s+/.test(line)) {
      if (codeBlockLines.length > 0) {
        break;
      }
    }

    if (inImplementationSection) {
      if (line.trim().startsWith('```typescript')) {
        inCodeBlock = true;
        continue;
      }
      if (inCodeBlock) {
        if (line.trim().startsWith('```')) {
          // We found a complete code block, we are done
          break;
        }
        codeBlockLines.push(line);
      }
    }
  }

  if (codeBlockLines.length > 0) {
    return codeBlockLines.join('\n');
  }

  // Fallback: search for the first typescript code block in the entire markdown body
  const fallbackLines: string[] = [];
  let inFallbackBlock = false;

  for (const line of lines) {
    if (line.trim().startsWith('```typescript')) {
      inFallbackBlock = true;
      continue;
    }
    if (inFallbackBlock) {
      if (line.trim().startsWith('```')) {
        break;
      }
      fallbackLines.push(line);
    }
  }

  return fallbackLines.length > 0 ? fallbackLines.join('\n') : null;
}

/**
 * Replaces the TypeScript block under "Implementation" with new code.
 * If no block or section exists, it falls back to replacing the first block or appending an Implementation section.
 */
export function replaceImplementationCode(body: string, newCode: string): string {
  const normalized = body.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  let inImplementationSection = false;
  let startIdx = -1;
  let endIdx = -1;
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#+\s*(?:\d+\.\s*)?Implementation/i.test(line)) {
      inImplementationSection = true;
      continue;
    }

    if (inImplementationSection && /^\s*#+\s+/.test(line)) {
      if (startIdx !== -1 && endIdx !== -1) {
        break;
      }
    }

    if (inImplementationSection) {
      if (line.trim().startsWith('```typescript')) {
        inCodeBlock = true;
        startIdx = i;
        continue;
      }
      if (inCodeBlock && line.trim().startsWith('```')) {
        endIdx = i;
        break;
      }
    }
  }

  if (startIdx !== -1 && endIdx !== -1) {
    const before = lines.slice(0, startIdx + 1);
    const after = lines.slice(endIdx);
    return [...before, newCode, ...after].join('\n');
  }

  // Fallback 1: Replace first typescript block in the body
  let firstStart = -1;
  let firstEnd = -1;
  inCodeBlock = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('```typescript')) {
      inCodeBlock = true;
      firstStart = i;
      continue;
    }
    if (inCodeBlock && lines[i].trim().startsWith('```')) {
      firstEnd = i;
      break;
    }
  }

  if (firstStart !== -1 && firstEnd !== -1) {
    const before = lines.slice(0, firstStart + 1);
    const after = lines.slice(firstEnd);
    return [...before, newCode, ...after].join('\n');
  }

  // Fallback 2: Append a new ## Implementation section
  return `${normalized.trim()}\n\n## Implementation\n\n\`\`\`typescript\n${newCode}\n\`\`\`\n`;
}

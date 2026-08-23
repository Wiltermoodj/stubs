/**
 * Parses markdown and extracts implementation code blocks across languages (TS, Python, Go, Rust, generic).
 */

/**
 * Extracts the first code block under a section matching "Implementation" (case-insensitive).
 * If no such block exists, it falls back to extracting the first code block in the file.
 * Returns null if no code block is found.
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

    if (inImplementationSection && /^\s*#+\s+/.test(line)) {
      if (codeBlockLines.length > 0) {
        break;
      }
    }

    if (inImplementationSection) {
      if (!inCodeBlock && line.trim().startsWith('```')) {
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

  // Fallback: search for the first fenced code block in the entire markdown body
  const fallbackLines: string[] = [];
  let inFallbackBlock = false;

  for (const line of lines) {
    if (!inFallbackBlock && line.trim().startsWith('```')) {
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
 * Replaces the code block under "Implementation" with new code.
 * Preserves the original fence language if present, or defaults to typescript/provided language.
 */
export function replaceImplementationCode(
  body: string,
  newCode: string,
  language = 'typescript',
): string {
  const normalized = body.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  let inImplementationSection = false;
  let startIdx = -1;
  let endIdx = -1;
  let inCodeBlock = false;
  let detectedLang = language;

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
      if (!inCodeBlock && line.trim().startsWith('```')) {
        inCodeBlock = true;
        startIdx = i;
        const langMatch = line.trim().replace(/^```/, '').trim();
        if (langMatch) detectedLang = langMatch;
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

  // Fallback 1: Replace first code block in the body
  let firstStart = -1;
  let firstEnd = -1;
  inCodeBlock = false;
  for (let i = 0; i < lines.length; i++) {
    if (!inCodeBlock && lines[i].trim().startsWith('```')) {
      inCodeBlock = true;
      firstStart = i;
      const langMatch = lines[i].trim().replace(/^```/, '').trim();
      if (langMatch) detectedLang = langMatch;
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
  return `${normalized.trim()}\n\n## Implementation\n\n\`\`\`${detectedLang}\n${newCode}\n\`\`\`\n`;
}

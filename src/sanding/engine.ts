import { promises as fsPromises, existsSync, statSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as yaml from 'js-yaml';
import { parseOkfSpec, OkfFrontmatter, ParsedOkfSpec } from '../parser/okf';
import { extractImplementationCode, replaceImplementationCode } from '../parser/markdown';
import { getAstStructuralHash, typeCheckCode } from './ast';
import { resolveContainedPath } from '../storage/containment';

export interface SyncResult {
  filePath: string;
  targetCodeFile: string;
  status: 'synced' | 'no_change' | 'conflict' | 'healed' | 'error';
  direction?: 'materialized' | 'sanded' | 'sidecar_to_code' | 'code_to_sidecar' | 'none';
  error?: string;
  /** Set to true when a non-structural conflict was auto-resolved (newer file wins). */
  conflict_resolved?: boolean;
  /** Set when status is 'conflict'; describes the resolution strategy. */
  resolution?: string;
}

/**
 * Computes a SHA-256 hash of a string.
 */
function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Strips the sync_state key and its indented lines from a raw YAML text string.
 */
export function stripSyncStateFromYaml(yamlText: string): string {
  const lines = yamlText.split('\n');
  const cleanLines: string[] = [];
  let inSyncState = false;

  for (const line of lines) {
    if (/^\s*sync_state\s*:/i.test(line)) {
      inSyncState = true;
      continue;
    }
    if (inSyncState) {
      if (line.startsWith(' ') || line.startsWith('\t') || line.trim() === '') {
        continue;
      } else {
        inSyncState = false;
      }
    }
    cleanLines.push(line);
  }
  return cleanLines.join('\n');
}

/**
 * Strips the sync_state block from the full OKF sidecar content to get a stable representation.
 */
export function stripSyncStateFromContent(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return content;

  const yamlText = match[1];
  const bodyText = match[2];

  const cleanYaml = stripSyncStateFromYaml(yamlText);
  return `---\n${cleanYaml.trim()}\n---\n${bodyText}`;
}

/**
 * Robust line-by-line regex-based fallback to heal corrupted YAML frontmatter headers.
 */
export function healCorruptedFrontmatter(yamlText: string): OkfFrontmatter {
  const result: any = {
    title: 'Healed OKF Sidecar Spec',
    type: 'sidecar-spec',
    description: 'Healed description.',
    tags: [],
    status: 'skeleton',
    version: 1,
    target_code_file: '',
    status_flag: 'needs-human-review-resolution',
    stale_details: 'Frontmatter was recovered from a corrupted state.',
  };

  const lines = yamlText.split('\n');
  let currentKey: string | null = null;
  let currentArray: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const keyValueMatch = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
    if (keyValueMatch) {
      if (currentKey && currentArray.length > 0) {
        result[currentKey] = currentArray;
        currentArray = [];
      }

      const key = keyValueMatch[1];
      let val = keyValueMatch[2].trim();

      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.substring(1, val.length - 1);
      }

      if (val === 'null') {
        result[key] = null;
      } else if (val === 'true') {
        result[key] = true;
      } else if (val === 'false') {
        result[key] = false;
      } else if (!isNaN(Number(val)) && val !== '') {
        result[key] = Number(val);
      } else if (val !== '') {
        result[key] = val;
        currentKey = null;
      } else {
        currentKey = key;
      }
      continue;
    }

    const arrayMatch = trimmed.match(/^-\s*(.*)$/);
    if (arrayMatch && currentKey) {
      let item = arrayMatch[1].trim();
      if (
        (item.startsWith('"') && item.endsWith('"')) ||
        (item.startsWith("'") && item.endsWith("'"))
      ) {
        item = item.substring(1, item.length - 1);
      }
      currentArray.push(item);
      continue;
    }
  }

  if (currentKey && currentArray.length > 0) {
    result[currentKey] = currentArray;
  }

  // Handle nested sync_state
  const lastSyncMatch = yamlText.match(/last_sync_timestamp\s*:\s*["']?([^"'\n]+)["']?/i);
  const sidecarHashMatch = yamlText.match(/sidecar_hash\s*:\s*["']?([^"'\n]+)["']?/i);
  const codeHashMatch = yamlText.match(/code_hash\s*:\s*["']?([^"'\n]+)["']?/i);

  if (lastSyncMatch || sidecarHashMatch || codeHashMatch) {
    result.sync_state = {
      last_sync_timestamp: lastSyncMatch ? lastSyncMatch[1].trim() : new Date(0).toISOString(),
      sidecar_hash: sidecarHashMatch ? sidecarHashMatch[1].trim() : '',
      code_hash: codeHashMatch ? codeHashMatch[1].trim() : '',
    };
  }

  // Enforce types and required properties
  if (typeof result.version !== 'number') result.version = 1;
  if (!Array.isArray(result.tags)) result.tags = [];
  if (result.exports && !Array.isArray(result.exports)) result.exports = [];
  if (result.depends_on && !Array.isArray(result.depends_on)) result.depends_on = [];
  if (result.used_by && !Array.isArray(result.used_by)) result.used_by = [];

  const validStatuses = [
    'skeleton',
    'spec',
    'implemented',
    'materialized',
    'grilling',
    'partially-materialized',
  ];
  if (!validStatuses.includes(result.status)) {
    result.status = 'skeleton';
  }

  const validStatusFlags = [
    'clean',
    'dependency-stale',
    'template-outdated',
    'template-realign-required',
    'needs-human-review-resolution',
    'typecheck-failed',
  ];
  if (!validStatusFlags.includes(result.status_flag)) {
    result.status_flag = 'needs-human-review-resolution';
  }

  return result as OkfFrontmatter;
}

/**
 * Strips the @sidecar header comments from materialized production code.
 */
export function stripSidecarHeader(code: string): string {
  const lines = code.split('\n');
  const cleanLines: string[] = [];
  let passedHeader = false;

  for (const line of lines) {
    if (!passedHeader) {
      if (
        line.trim().startsWith('// @sidecar') ||
        line.trim().startsWith('// This file is materialized')
      ) {
        continue;
      }
      if (line.trim() !== '') {
        passedHeader = true;
      }
    }
    if (passedHeader || line.trim() !== '') {
      cleanLines.push(line);
    }
  }
  return cleanLines.join('\n').trim();
}

export class SandingEngine {
  /**
   * Synchronizes a single sidecar file (.ts.md) with its target code file (.ts).
   * This absorbs all complexity of AST structural hashing, timestamp vector comparisons,
   * self-healing frontmatter, and bi-directional sanding.
   */
  public async syncFile(sidecarPath: string): Promise<SyncResult> {
    const resolvedSidecar = path.resolve(sidecarPath);
    if (!existsSync(resolvedSidecar)) {
      return {
        filePath: sidecarPath,
        targetCodeFile: '',
        status: 'error',
        error: `Sidecar file does not exist at path: ${sidecarPath}`,
      };
    }

    let content: string;
    try {
      content = readFileSync(resolvedSidecar, 'utf8');
    } catch (err: any) {
      return {
        filePath: sidecarPath,
        targetCodeFile: '',
        status: 'error',
        error: `Failed to read sidecar file: ${err.message || err}`,
      };
    }

    const parsed: ParsedOkfSpec = parseOkfSpec(content);
    let frontmatter: OkfFrontmatter | null = parsed.frontmatter;
    let body = parsed.body;
    let wasHealed = false;

    // Trigger self-healing if parsing failed due to frontmatter YAML corruption
    if (!parsed.isValid || !frontmatter) {
      const match = content.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (match) {
        try {
          const healedFrontmatter = healCorruptedFrontmatter(match[1]);
          body = match[2];
          frontmatter = healedFrontmatter;
          wasHealed = true;

          // Rewrite the sidecar file on disk with healed frontmatter
          const healedContent = `---\n${yaml.dump(frontmatter)}---\n${body}`;
          writeFileSync(resolvedSidecar, healedContent, 'utf8');
        } catch (healErr: any) {
          return {
            filePath: sidecarPath,
            targetCodeFile: '',
            status: 'error',
            error: `Self-healing frontmatter failed: ${healErr.message || healErr}`,
          };
        }
      } else {
        return {
          filePath: sidecarPath,
          targetCodeFile: '',
          status: 'error',
          error: `Corrupted file has invalid OKF format structure: ${parsed.errors.join(', ')}`,
        };
      }
    }

    const targetCodeFile = frontmatter.target_code_file;
    if (!targetCodeFile) {
      return {
        filePath: sidecarPath,
        targetCodeFile: '',
        status: 'error',
        error: `Required property "target_code_file" is missing in frontmatter.`,
      };
    }

    // Resolve target_code_file. The value can be:
    // (a) workspace-root-relative (e.g. "src/lib/firebase.ts") — resolve against process.cwd().
    //     This is the B1 fix: paths without a "./" or "../" prefix are treated as relative to
    //     the workspace root (process.cwd()), not the sidecar's directory.
    // (b) sidecar-relative (e.g. "./auth-spec.ts", "../foo.ts") — resolve against the sidecar's
    //     parent directory. Paths starting with "./" or "../" preserve the pre-B1 convention
    //     where target_code_file was relative to the sidecar's location.
    //
    // Strategy: check the path prefix. "./" and "../" → sidecar-relative. Everything else →
    // workspace-root-relative (cwd). This fixes the original bug while keeping existing
    // sidecars and tests working without modification.
    const workspaceRoot = process.cwd();
    const sidecarDir = path.dirname(resolvedSidecar);

    const isSidecarRelative = targetCodeFile.startsWith('./') || targetCodeFile.startsWith('../');
    const resolvedTarget = isSidecarRelative
      ? resolveContainedPath(sidecarDir, targetCodeFile)
      : resolveContainedPath(workspaceRoot, targetCodeFile);

    // Guard: ensure resolved path stays within workspace root
    const relativeCheck = path.relative(workspaceRoot, resolvedTarget);
    if (path.isAbsolute(relativeCheck) || relativeCheck.startsWith('..')) {
      return {
        filePath: sidecarPath,
        targetCodeFile,
        status: 'error',
        error:
          `Resolved path "${resolvedTarget}" escapes workspace root "${workspaceRoot}". ` +
          `target_code_file must resolve within the workspace.`,
      };
    }

    // Calculate stable sidecar hash
    const cleanSidecarContent = stripSyncStateFromContent(content);
    const currentSidecarHash = sha256(cleanSidecarContent);

    // Extract TypeScript code from specification
    const extractedCode = extractImplementationCode(body);
    if (extractedCode === null) {
      return {
        filePath: sidecarPath,
        targetCodeFile,
        status: 'error',
        error: `No TypeScript block found under ## Implementation or as a fallback in sidecar.`,
      };
    }

    const sidecarMtime = statSync(resolvedSidecar).mtime;
    const codeExists = existsSync(resolvedTarget);
    const codeMtime = codeExists ? statSync(resolvedTarget).mtime : null;

    const sidecarHashRecorded = frontmatter.sync_state?.sidecar_hash || '';
    const codeHashRecorded = frontmatter.sync_state?.code_hash || '';

    // Comment header to prepend to the target code file
    const relSidecarPath = path
      .relative(path.dirname(resolvedTarget), resolvedSidecar)
      .replace(/\\/g, '/');
    const headerPrefix = `./`.startsWith(relSidecarPath) ? relSidecarPath : `./${relSidecarPath}`;
    const codeHeader = `// @sidecar ${headerPrefix}\n// This file is materialized from the sidecar specification.\n// Do not edit this header.\n\n`;

    // 1. Materialization path if target .ts code file does not exist
    if (!codeExists) {
      // Run Typechecking
      const typeCheck = typeCheckCode(resolvedTarget, extractedCode);
      if (!typeCheck.success) {
        // Halt materialization, write failure status to frontmatter
        frontmatter.status_flag = 'typecheck-failed';
        frontmatter.stale_details = `Type-checking failed:\n${typeCheck.diagnostics.join('\n')}`;

        const updatedContent = `---\n${yaml.dump(frontmatter)}---\n${body}`;
        writeFileSync(resolvedSidecar, updatedContent, 'utf8');

        return {
          filePath: sidecarPath,
          targetCodeFile,
          status: 'error',
          error: `Type-checking failed during materialization. Code file not written. Diagnostics:\n${typeCheck.diagnostics.join('\n')}`,
        };
      }

      // Typecheck passed, write file
      const materializedCode = codeHeader + extractedCode;
      writeFileSync(resolvedTarget, materializedCode, 'utf8');

      // Update sync state
      const targetMtime = statSync(resolvedTarget).mtime;
      const finalCodeHash = sha256(materializedCode);

      frontmatter.status = 'materialized';
      frontmatter.status_flag = 'clean';
      frontmatter.stale_details = null;
      frontmatter.sync_state = {
        last_sync_timestamp: targetMtime.toISOString(),
        sidecar_hash: '', // Filled in below after writing back
        code_hash: finalCodeHash,
      };

      // To get a fully precise sidecar hash, we write, strip state, compute hash, and re-write sync state
      const tempContent = `---\n${yaml.dump(frontmatter)}---\n${body}`;
      const stableSidecar = stripSyncStateFromContent(tempContent);
      frontmatter.sync_state.sidecar_hash = sha256(stableSidecar);

      const finalContent = `---\n${yaml.dump(frontmatter)}---\n${body}`;
      writeFileSync(resolvedSidecar, finalContent, 'utf8');

      return {
        filePath: sidecarPath,
        targetCodeFile,
        status: wasHealed ? 'healed' : 'synced',
        direction: 'materialized',
      };
    }

    // Both files exist. Detect changes.
    let codeContent: string;
    try {
      codeContent = readFileSync(resolvedTarget, 'utf8');
    } catch (err: any) {
      return {
        filePath: sidecarPath,
        targetCodeFile,
        status: 'error',
        error: `Failed to read code file: ${err.message || err}`,
      };
    }

    const currentCodeHash = sha256(codeContent);

    const sidecarChanged = currentSidecarHash !== sidecarHashRecorded;
    const codeChanged = currentCodeHash !== codeHashRecorded;

    // No changes in either file
    if (!sidecarChanged && !codeChanged && !wasHealed) {
      return {
        filePath: sidecarPath,
        targetCodeFile,
        status: 'no_change',
        direction: 'none',
      };
    }

    // Sidecar was updated, code is untouched
    if (sidecarChanged && !codeChanged) {
      const typeCheck = typeCheckCode(resolvedTarget, extractedCode);
      if (!typeCheck.success) {
        frontmatter.status_flag = 'typecheck-failed';
        frontmatter.stale_details = `Type-checking failed:\n${typeCheck.diagnostics.join('\n')}`;

        const updatedContent = `---\n${yaml.dump(frontmatter)}---\n${body}`;
        writeFileSync(resolvedSidecar, updatedContent, 'utf8');

        return {
          filePath: sidecarPath,
          targetCodeFile,
          status: 'error',
          error: `Typechecking failed during sidecar-to-code sync. Diagnostics:\n${typeCheck.diagnostics.join('\n')}`,
        };
      }

      const materializedCode = codeHeader + extractedCode;
      writeFileSync(resolvedTarget, materializedCode, 'utf8');

      const targetMtime = statSync(resolvedTarget).mtime;
      const finalCodeHash = sha256(materializedCode);

      frontmatter.status = 'materialized';
      frontmatter.status_flag = 'clean';
      frontmatter.stale_details = null;
      frontmatter.sync_state = {
        last_sync_timestamp: targetMtime.toISOString(),
        sidecar_hash: '',
        code_hash: finalCodeHash,
      };

      const tempContent = `---\n${yaml.dump(frontmatter)}---\n${body}`;
      const stableSidecar = stripSyncStateFromContent(tempContent);
      frontmatter.sync_state.sidecar_hash = sha256(stableSidecar);

      const finalContent = `---\n${yaml.dump(frontmatter)}---\n${body}`;
      writeFileSync(resolvedSidecar, finalContent, 'utf8');

      return {
        filePath: sidecarPath,
        targetCodeFile,
        status: wasHealed ? 'healed' : 'synced',
        direction: 'sidecar_to_code',
        conflict_resolved: true,
      };
    }

    // Code was updated, sidecar is untouched
    if (codeChanged && !sidecarChanged) {
      const cleanCode = stripSidecarHeader(codeContent);
      const typeCheck = typeCheckCode(resolvedTarget, cleanCode);
      if (!typeCheck.success) {
        frontmatter.status_flag = 'typecheck-failed';
        frontmatter.stale_details = `Type-checking failed:\n${typeCheck.diagnostics.join('\n')}`;

        const updatedContent = `---\n${yaml.dump(frontmatter)}---\n${body}`;
        writeFileSync(resolvedSidecar, updatedContent, 'utf8');

        return {
          filePath: sidecarPath,
          targetCodeFile,
          status: 'error',
          error: `Typechecking failed during code-to-sidecar sync. Diagnostics:\n${typeCheck.diagnostics.join('\n')}`,
        };
      }

      const updatedBody = replaceImplementationCode(body, cleanCode);

      frontmatter.status = 'materialized';
      frontmatter.status_flag = 'clean';
      frontmatter.stale_details = null;
      frontmatter.sync_state = {
        last_sync_timestamp: new Date().toISOString(),
        sidecar_hash: '',
        code_hash: currentCodeHash,
      };

      const tempContent = `---\n${yaml.dump(frontmatter)}---\n${updatedBody}`;
      const stableSidecar = stripSyncStateFromContent(tempContent);
      frontmatter.sync_state.sidecar_hash = sha256(stableSidecar);

      const finalContent = `---\n${yaml.dump(frontmatter)}---\n${updatedBody}`;
      writeFileSync(resolvedSidecar, finalContent, 'utf8');

      return {
        filePath: sidecarPath,
        targetCodeFile,
        status: wasHealed ? 'healed' : 'synced',
        direction: 'code_to_sidecar',
      };
    }

    // Conflict path: Both files were modified
    const cleanCode = stripSidecarHeader(codeContent);
    const sidecarAstHash = getAstStructuralHash(extractedCode);
    const codeAstHash = getAstStructuralHash(cleanCode);

    // 1. Non-structural differences (formatting/spacing/comments only) -> Resolve using newer mtime
    if (sidecarAstHash === codeAstHash) {
      const useCode = codeMtime && codeMtime > sidecarMtime;

      if (useCode) {
        // Sand Code -> Sidecar
        const typeCheck = typeCheckCode(resolvedTarget, cleanCode);
        if (!typeCheck.success) {
          frontmatter.status_flag = 'typecheck-failed';
          frontmatter.stale_details = `Typechecking failed:\n${typeCheck.diagnostics.join('\n')}`;
          const updatedContent = `---\n${yaml.dump(frontmatter)}---\n${body}`;
          writeFileSync(resolvedSidecar, updatedContent, 'utf8');

          return {
            filePath: sidecarPath,
            targetCodeFile,
            status: 'error',
            error: `Typechecking failed during resolve. Diagnostics:\n${typeCheck.diagnostics.join('\n')}`,
          };
        }

        const updatedBody = replaceImplementationCode(body, cleanCode);
        frontmatter.status_flag = 'clean';
        frontmatter.stale_details = null;
        frontmatter.sync_state = {
          last_sync_timestamp: new Date().toISOString(),
          sidecar_hash: '',
          code_hash: currentCodeHash,
        };

        const tempContent = `---\n${yaml.dump(frontmatter)}---\n${updatedBody}`;
        const stableSidecar = stripSyncStateFromContent(tempContent);
        frontmatter.sync_state.sidecar_hash = sha256(stableSidecar);

        const finalContent = `---\n${yaml.dump(frontmatter)}---\n${updatedBody}`;
        writeFileSync(resolvedSidecar, finalContent, 'utf8');

        return {
          filePath: sidecarPath,
          targetCodeFile,
          status: 'synced',
          direction: 'sanded',
          conflict_resolved: true,
        };
      } else {
        // Materialize Sidecar -> Code
        const typeCheck = typeCheckCode(resolvedTarget, extractedCode);
        if (!typeCheck.success) {
          frontmatter.status_flag = 'typecheck-failed';
          frontmatter.stale_details = `Typechecking failed:\n${typeCheck.diagnostics.join('\n')}`;
          const updatedContent = `---\n${yaml.dump(frontmatter)}---\n${body}`;
          writeFileSync(resolvedSidecar, updatedContent, 'utf8');

          return {
            filePath: sidecarPath,
            targetCodeFile,
            status: 'error',
            error: `Typechecking failed during resolve. Diagnostics:\n${typeCheck.diagnostics.join('\n')}`,
          };
        }

        const materializedCode = codeHeader + extractedCode;
        writeFileSync(resolvedTarget, materializedCode, 'utf8');

        const targetMtime = statSync(resolvedTarget).mtime;
        const finalCodeHash = sha256(materializedCode);

        frontmatter.status_flag = 'clean';
        frontmatter.stale_details = null;
        frontmatter.sync_state = {
          last_sync_timestamp: targetMtime.toISOString(),
          sidecar_hash: '',
          code_hash: finalCodeHash,
        };

        const tempContent = `---\n${yaml.dump(frontmatter)}---\n${body}`;
        const stableSidecar = stripSyncStateFromContent(tempContent);
        frontmatter.sync_state.sidecar_hash = sha256(stableSidecar);

        const finalContent = `---\n${yaml.dump(frontmatter)}---\n${body}`;
        writeFileSync(resolvedSidecar, finalContent, 'utf8');

        return {
          filePath: sidecarPath,
          targetCodeFile,
          status: 'synced',
          direction: 'materialized',
          conflict_resolved: true,
        };
      }
    }

    // 2. Structural conflict (AST mismatch) -> non-destructive marker flag
    frontmatter.status_flag = 'needs-human-review-resolution';
    frontmatter.stale_details = `Conflict detected: Both sidecar and code files have been modified with structural AST differences.`;

    const conflictContent = `---\n${yaml.dump(frontmatter)}---\n${body}`;
    writeFileSync(resolvedSidecar, conflictContent, 'utf8');

    return {
      filePath: sidecarPath,
      targetCodeFile,
      status: 'conflict',
      direction: 'none',
      resolution: 'needs-human-review-resolution',
    };
  }

  /**
   * Recursively scans directory for specification files (.ts.md or .md starting with frontmatter marker).
   */
  private async scanDirectory(dir: string): Promise<string[]> {
    const files: string[] = [];
    const recurse = async (currentDir: string) => {
      if (!existsSync(currentDir)) return;
      const entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relativePath = path.relative(process.cwd(), fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          if (
            entry.name === 'node_modules' ||
            entry.name === '.git' ||
            entry.name === '.stubs' ||
            entry.name === 'dist' ||
            entry.name === 'build'
          ) {
            continue;
          }
          await recurse(fullPath);
        } else if (entry.isFile()) {
          if (entry.name.endsWith('.ts.md') || entry.name.endsWith('.md')) {
            files.push(relativePath);
          }
        }
      }
    };
    await recurse(dir);
    return files;
  }

  /**
   * Synchronizes the entire workspace by scanning and reconciling all specs in the specifications directory.
   */
  public async syncWorkspace(specsDir: string): Promise<SyncResult[]> {
    const specsPath = path.resolve(specsDir);
    if (!existsSync(specsPath)) {
      return [];
    }

    const files = await this.scanDirectory(specsPath);
    const results: SyncResult[] = [];

    for (const file of files) {
      try {
        const content = readFileSync(path.resolve(file), 'utf8');
        // Ignore files that don't have valid OKF layout structure
        if (!content.trim().startsWith('---')) {
          continue;
        }

        const res = await this.syncFile(file);
        results.push(res);
      } catch (err: any) {
        results.push({
          filePath: file,
          targetCodeFile: '',
          status: 'error',
          error: `Error during workspace synchronization: ${err.message || err}`,
        });
      }
    }

    return results;
  }
}

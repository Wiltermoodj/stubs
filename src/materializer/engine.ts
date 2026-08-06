import { promises as fs } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as yaml from 'js-yaml';
import { parseOkfSpec, OkfFrontmatter } from '../parser/okf';
import { parseMarkdown, extractImplementationCode } from '../parser/ast';
import { typeCheckVirtualFile } from '../compiler/typechecker';
import { GraphEngine } from '../graph/engine';

export interface MaterializeResult {
  success: boolean;
  error?: string;
  diagnostics?: string[];
}

/**
 * Reconstructs the full OKF sidecar file with YAML frontmatter and body.
 */
export function stringifyOkfSpec(frontmatter: OkfFrontmatter, body: string): string {
  const yamlText = yaml.dump(frontmatter, { indent: 2, noRefs: true });
  return `---\n${yamlText}---\n${body}`;
}

/**
 * MaterializerEngine encapsulates the logic to extract implementation code blocks,
 * run the in-memory compiler, perform atomic file writes, hash files, and sync frontmatter/databases.
 */
export class MaterializerEngine {
  private graphEngine: GraphEngine;

  constructor(graphEngine?: GraphEngine) {
    this.graphEngine = graphEngine || new GraphEngine();
  }

  /**
   * Calculates the SHA-256 hash of a given string.
   */
  private computeSha256(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Writes file content atomically by writing to a temporary file first, then renaming it.
   */
  private async writeAtomic(filePath: string, content: string): Promise<void> {
    const absolutePath = path.resolve(filePath);
    const dir = path.dirname(absolutePath);
    await fs.mkdir(dir, { recursive: true });

    const tempPath = `${absolutePath}.tmp-${Date.now()}-${Math.random().toString(36).substring(2)}`;
    await fs.writeFile(tempPath, content, 'utf8');
    await fs.rename(tempPath, absolutePath);
  }

  /**
   * Materializes a given sidecar specification file (*.ts.md) into its target executable file (*.ts).
   * Orchestrates parsing, extracting, type-checking, hashing, atomic writing, and graph updates.
   */
  public async materialize(sidecarPath: string): Promise<MaterializeResult> {
    const absoluteSidecarPath = path.resolve(sidecarPath);
    const relativeSidecarPath = path
      .relative(process.cwd(), absoluteSidecarPath)
      .replace(/\\/g, '/');

    try {
      await this.graphEngine.initialize();
    } catch (err: any) {
      return {
        success: false,
        error: `Failed to initialize GraphEngine: ${err.message || err}`,
      };
    }

    // 1. Read sidecar file
    let originalContent: string;
    try {
      originalContent = await fs.readFile(absoluteSidecarPath, 'utf8');
    } catch (err: any) {
      return {
        success: false,
        error: `Failed to read sidecar file at "${sidecarPath}": ${err.message || err}`,
      };
    }

    // 2. Parse OKF Spec
    const parsedSpec = parseOkfSpec(originalContent);
    if (!parsedSpec.isValid || !parsedSpec.frontmatter) {
      return {
        success: false,
        error: `Invalid sidecar frontmatter: ${parsedSpec.errors.join('\n')}`,
      };
    }

    const { frontmatter, body } = parsedSpec;
    const targetCodeFile = frontmatter.target_code_file;

    if (!targetCodeFile) {
      return {
        success: false,
        error: 'The sidecar frontmatter is missing "target_code_file" parameter.',
      };
    }

    // Resolve target path relative to the sidecar's directory
    const sidecarDir = path.dirname(absoluteSidecarPath);
    const absoluteTargetFilePath = path.resolve(sidecarDir, targetCodeFile);

    // 3. Extract Implementation Code Blocks
    const markdownBlocks = parseMarkdown(body);
    const extraction = extractImplementationCode(markdownBlocks);

    if (extraction.error || !extraction.code) {
      // If no implementation block found, update frontmatter with error details
      const updatedFrontmatter: OkfFrontmatter = {
        ...frontmatter,
        status_flag: 'typecheck-failed',
        stale_details: extraction.error || 'No implementation code extracted.',
      };

      const newSidecarContent = stringifyOkfSpec(updatedFrontmatter, body);
      await this.writeAtomic(absoluteSidecarPath, newSidecarContent);

      const fileHash = this.computeSha256(newSidecarContent);
      await this.graphEngine.upsertSidecar({
        filePath: relativeSidecarPath,
        frontmatter: updatedFrontmatter,
        body,
        fileHash,
      });

      return {
        success: false,
        error: extraction.error || 'No implementation code extracted.',
      };
    }

    const extractedCode = extraction.code;

    // 4. Construct virtual code with @sidecar header
    // The path should be relative from the target code file to the sidecar file
    const sidecarRelativeFromTarget = path
      .relative(path.dirname(absoluteTargetFilePath), absoluteSidecarPath)
      .replace(/\\/g, '/');
    const sidecarRef = sidecarRelativeFromTarget.startsWith('.')
      ? sidecarRelativeFromTarget
      : `./${sidecarRelativeFromTarget}`;

    const sidecarHeader = `// @sidecar ${sidecarRef}\n\n`;
    const finalCodeWithHeader = `${sidecarHeader}${extractedCode}`;

    // 5. In-Memory Type-Checking
    const typecheck = typeCheckVirtualFile(absoluteTargetFilePath, finalCodeWithHeader);

    if (!typecheck.success) {
      // Compilation / Diagnostics failed
      const errorsJoined = typecheck.diagnostics.join('\n');
      const updatedFrontmatter: OkfFrontmatter = {
        ...frontmatter,
        status_flag: 'typecheck-failed',
        stale_details: errorsJoined,
      };

      const newSidecarContent = stringifyOkfSpec(updatedFrontmatter, body);
      await this.writeAtomic(absoluteSidecarPath, newSidecarContent);

      const fileHash = this.computeSha256(newSidecarContent);
      await this.graphEngine.upsertSidecar({
        filePath: relativeSidecarPath,
        frontmatter: updatedFrontmatter,
        body,
        fileHash,
      });

      return {
        success: false,
        error: 'Type-check diagnostics failed.',
        diagnostics: typecheck.diagnostics,
      };
    }

    // 6. Diagnostics Passed -> Complete Materialization
    // Write target executable file atomically
    try {
      await this.writeAtomic(absoluteTargetFilePath, finalCodeWithHeader);
    } catch (err: any) {
      return {
        success: false,
        error: `Failed to write target code file: ${err.message || err}`,
      };
    }

    // Calculate sidecar hash (excluding sync_state)
    const clonedFrontmatter = JSON.parse(JSON.stringify(frontmatter));
    delete clonedFrontmatter.sync_state;
    const sidecarContentNoSync = stringifyOkfSpec(clonedFrontmatter, body);
    const sidecarHash = this.computeSha256(sidecarContentNoSync);

    // Calculate code hash
    const codeHash = this.computeSha256(finalCodeWithHeader);

    // Update frontmatter values
    const updatedFrontmatter: OkfFrontmatter = {
      ...frontmatter,
      status: 'materialized',
      status_flag: 'clean',
      stale_details: null,
      sync_state: {
        last_sync_timestamp: new Date().toISOString(),
        sidecar_hash: sidecarHash,
        code_hash: codeHash,
      },
    };

    // Reconstruct and write updated sidecar back atomically
    const finalSidecarContent = stringifyOkfSpec(updatedFrontmatter, body);
    try {
      await this.writeAtomic(absoluteSidecarPath, finalSidecarContent);
    } catch (err: any) {
      return {
        success: false,
        error: `Failed to write updated sidecar file: ${err.message || err}`,
      };
    }

    // Sync SQLite search/graph engine index
    const sidecarFileHash = this.computeSha256(finalSidecarContent);
    try {
      await this.graphEngine.upsertSidecar({
        filePath: relativeSidecarPath,
        frontmatter: updatedFrontmatter,
        body,
        fileHash: sidecarFileHash,
      });
    } catch (err: any) {
      // Non-blocking error for graph database, but return success with log warning
      console.warn(
        `Warning: Graph database sync failed during materialization: ${err.message || err}`,
      );
    }

    return {
      success: true,
    };
  }
}

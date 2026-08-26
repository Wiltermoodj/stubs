import * as path from 'path';
import * as yaml from 'js-yaml';
import { parseOkfSpec, extractFileTreeBlocks, isCodeSidecar } from '../parser/okf';
import { GraphEngine, normalizePosixPath } from '../graph/engine';
import { FileStorageDriver, NodeFileSystem } from '../storage';
import { MaterializerEngine } from '../materializer/engine';

export type LifecyclePhase = 'conceptualize' | 'grill' | 'spec' | 'materialize' | 'sand';

export const LIFECYCLE_PHASES: readonly LifecyclePhase[] = [
  'conceptualize',
  'grill',
  'spec',
  'materialize',
  'sand',
] as const;

export interface PhaseRequirement {
  rule: string;
  passed: boolean;
  details?: string;
}

export interface PhaseCheckResult {
  filePath: string;
  currentPhase: LifecyclePhase;
  canAdvance: boolean;
  nextPhase: LifecyclePhase | null;
  requirements: PhaseRequirement[];
  errors: string[];
}

export interface AdvancePhaseResult {
  filePath: string;
  success: boolean;
  fromPhase: string;
  toPhase: string;
  errors: string[];
}

export interface WorkspacePhaseMatrix {
  matrix: Record<string, string>;
  summary: Record<string, number>;
  sidecars: Array<{
    filePath: string;
    title: string;
    type: string;
    phase: string;
    status: string;
    status_flag: string;
    canAdvance: boolean;
    nextPhase: string | null;
  }>;
}

export class PhaseEngine {
  private fsDriver: FileStorageDriver;
  private graphEngine?: GraphEngine;
  private materializerEngine?: MaterializerEngine;

  constructor(
    options: {
      fsDriver?: FileStorageDriver;
      graphEngine?: GraphEngine;
      materializerEngine?: MaterializerEngine;
    } = {},
  ) {
    this.fsDriver = options.fsDriver || new NodeFileSystem();
    this.graphEngine = options.graphEngine;
    this.materializerEngine = options.materializerEngine;
  }

  /**
   * Normalizes arbitrary phase strings into canonical 5-phase lifecycle identifier.
   */
  public normalizePhase(rawPhase?: string | null): LifecyclePhase {
    if (!rawPhase) return 'spec';
    const lower = rawPhase.toLowerCase();
    if (lower.includes('concept')) return 'conceptualize';
    if (lower.includes('grill')) return 'grill';
    if (lower.includes('spec') || lower.includes('scaffold') || lower.includes('skeleton'))
      return 'spec';
    if (lower.includes('mat')) return 'materialize';
    if (lower.includes('sand') || lower.includes('clean') || lower.includes('audit')) return 'sand';
    return 'spec';
  }

  /**
   * Evaluates phase gating rules and checks if an OKF artifact is eligible to advance to the next phase.
   */
  public async checkPhase(filePath: string): Promise<PhaseCheckResult> {
    const normalizedPath = normalizePosixPath(filePath);
    const result: PhaseCheckResult = {
      filePath: normalizedPath,
      currentPhase: 'conceptualize',
      canAdvance: false,
      nextPhase: null,
      requirements: [],
      errors: [],
    };

    if (!(await this.fsDriver.exists(normalizedPath))) {
      result.errors.push(`File not found: "${normalizedPath}"`);
      return result;
    }

    let content: string;
    try {
      content = await this.fsDriver.readFile(normalizedPath);
    } catch (err: any) {
      result.errors.push(`Failed to read file: ${err.message || err}`);
      return result;
    }

    const parsed = parseOkfSpec(content);
    if (!parsed.isValid || !parsed.frontmatter) {
      result.errors.push(`Invalid OKF Frontmatter:\n${parsed.errors.join('\n')}`);
      return result;
    }

    const fm = parsed.frontmatter;
    const currentPhase = this.normalizePhase(fm.phase);
    result.currentPhase = currentPhase;

    const currentIndex = LIFECYCLE_PHASES.indexOf(currentPhase);
    if (currentIndex < LIFECYCLE_PHASES.length - 1) {
      result.nextPhase = LIFECYCLE_PHASES[currentIndex + 1];
    } else {
      result.nextPhase = null;
    }

    // Evaluate Phase-Specific Gating Rules
    switch (currentPhase) {
      case 'conceptualize': {
        // Gating to 'grill':
        // Rule 1: Frontmatter title and description
        const hasTitleDesc = Boolean(fm.title && fm.description && fm.description.length > 5);
        result.requirements.push({
          rule: 'Title and clear description defined',
          passed: hasTitleDesc,
          details: hasTitleDesc ? undefined : 'Module title or description is missing/too short.',
        });

        // Rule 2: Blueprint or scope declared
        const treeBlocks = extractFileTreeBlocks(parsed.body);
        const hasBlueprint =
          treeBlocks.length > 0 ||
          Boolean(fm.planned_files && fm.planned_files.length > 0) ||
          fm.type === 'sidecar-spec' ||
          fm.type === 'subsystem-index';
        result.requirements.push({
          rule: 'Filetree blueprint or module scope declared',
          passed: hasBlueprint,
          details: hasBlueprint
            ? undefined
            : 'No ```filetree``` block or planned_files manifest found in document.',
        });
        break;
      }

      case 'grill': {
        // Gating to 'spec':
        // Rule 1: No pending human directives / unresolved notes
        const pendingNotes = (fm.user_notes || []).filter((n) => n.status === 'pending');
        const notesResolved = pendingNotes.length === 0;
        result.requirements.push({
          rule: 'All user notes and grill directives resolved',
          passed: notesResolved,
          details: notesResolved
            ? undefined
            : `${pendingNotes.length} pending user note(s) still unresolved.`,
        });

        // Rule 2: Valid status
        const notBlocked =
          fm.status !== 'grilling' || Boolean(fm.decisions && fm.decisions.length > 0);
        result.requirements.push({
          rule: 'Architectural trade-offs grilled with recorded decisions or spec status',
          passed: notBlocked,
          details: notBlocked ? undefined : 'Status is currently grilling with 0 recorded ADRs.',
        });
        break;
      }

      case 'spec': {
        // Gating to 'materialize':
        // Rule 1: Status is spec or implemented
        const validStatus = ['spec', 'implemented', 'clean', 'skeleton'].includes(fm.status);
        result.requirements.push({
          rule: 'Specification status is valid for materialization',
          passed: validStatus,
          details: validStatus
            ? undefined
            : `Status "${fm.status}" is not ready for materialization.`,
        });

        // Rule 2: Code sidecar requirements
        if (isCodeSidecar(fm, normalizedPath)) {
          const hasImplementation =
            /##\s+(?:Current\s+)?Implementation/i.test(parsed.body) &&
            /```(?:typescript|ts)[\s\S]*?```/.test(parsed.body);
          result.requirements.push({
            rule: 'Implementation section with typescript code block defined',
            passed: hasImplementation,
            details: hasImplementation
              ? undefined
              : 'Missing "## Implementation" section with enclosed ```typescript block.',
          });
        }
        break;
      }

      case 'materialize': {
        // Gating to 'sand':
        // Rule 1: Code file exists if code sidecar
        let codeFileExists = true;
        if (fm.target_code_file) {
          const targetPath = path.resolve(path.dirname(normalizedPath), fm.target_code_file);
          codeFileExists = await this.fsDriver.exists(targetPath);
        }
        result.requirements.push({
          rule: 'Target source code file exists on disk',
          passed: codeFileExists,
          details: codeFileExists
            ? undefined
            : `Target file "${fm.target_code_file}" does not exist on disk.`,
        });

        // Rule 2: Clean typecheck status flag
        const typecheckClean = fm.status_flag !== 'typecheck-failed';
        result.requirements.push({
          rule: 'TypeScript typecheck passed with zero diagnostic errors',
          passed: typecheckClean,
          details: typecheckClean ? undefined : 'Status flag is marked "typecheck-failed".',
        });
        break;
      }

      case 'sand': {
        // Complete phase
        const isClean = fm.status_flag === 'clean';
        result.requirements.push({
          rule: 'AST structural sync is clean with zero drift',
          passed: isClean,
          details: isClean ? undefined : `Status flag is currently "${fm.status_flag}".`,
        });
        break;
      }
    }

    result.canAdvance =
      result.nextPhase !== null &&
      result.requirements.length > 0 &&
      result.requirements.every((r) => r.passed);

    if (!result.canAdvance && result.nextPhase !== null) {
      const failed = result.requirements.filter((r) => !r.passed);
      failed.forEach((f) => result.errors.push(`${f.rule}: ${f.details || 'failed'}`));
    }

    return result;
  }

  /**
   * Safely advances the lifecycle phase of an OKF document.
   */
  public async advancePhase(
    filePath: string,
    targetPhase?: string,
    options: { force?: boolean } = {},
  ): Promise<AdvancePhaseResult> {
    const normalizedPath = normalizePosixPath(filePath);
    const checkResult = await this.checkPhase(normalizedPath);

    const fromPhase = checkResult.currentPhase;
    const toPhase = targetPhase
      ? this.normalizePhase(targetPhase)
      : checkResult.nextPhase || fromPhase;

    const result: AdvancePhaseResult = {
      filePath: normalizedPath,
      success: false,
      fromPhase,
      toPhase,
      errors: [],
    };

    if (!options.force && !checkResult.canAdvance && !targetPhase) {
      result.errors = checkResult.errors;
      return result;
    }

    try {
      const content = await this.fsDriver.readFile(normalizedPath);
      const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!match) {
        result.errors.push('Failed to parse frontmatter block for updating.');
        return result;
      }

      const yamlContent = match[1];
      const body = match[2];
      const parsedYaml: any = yaml.load(yamlContent) || {};

      parsedYaml.phase = toPhase;
      if (toPhase === 'materialize') {
        parsedYaml.status = 'materialized';
      } else if (toPhase === 'spec') {
        parsedYaml.status = 'spec';
      }

      const updatedYaml = yaml.dump(parsedYaml, { lineWidth: -1 }).trim();
      const updatedContent = `---\n${updatedYaml}\n---\n${body}`;

      await this.fsDriver.writeFile(normalizedPath, updatedContent);

      if (this.graphEngine) {
        try {
          await this.graphEngine.indexFile(normalizedPath);
        } catch {
          // Ignore index update error
        }
      }

      result.success = true;
      return result;
    } catch (err: any) {
      result.errors.push(`Failed to write updated phase: ${err.message || err}`);
      return result;
    }
  }

  /**
   * Generates a workspace-wide phase status matrix.
   */
  public async getWorkspacePhaseMatrix(): Promise<WorkspacePhaseMatrix> {
    if (this.graphEngine) {
      const report = await this.graphEngine.getPhaseStatus();
      const sidecarsWithChecks = await Promise.all(
        report.sidecars.map(async (s) => {
          let canAdvance = false;
          let nextPhase: string | null = null;
          try {
            const check = await this.checkPhase(s.filePath);
            canAdvance = check.canAdvance;
            nextPhase = check.nextPhase;
          } catch {
            // Ignore single sidecar check error
          }

          return {
            ...s,
            canAdvance,
            nextPhase,
          };
        }),
      );

      return {
        matrix: report.matrix,
        summary: report.summary,
        sidecars: sidecarsWithChecks,
      };
    }

    return {
      matrix: {},
      summary: { conceptualize: 0, grill: 0, spec: 0, materialize: 0, sand: 0, total: 0 },
      sidecars: [],
    };
  }
}

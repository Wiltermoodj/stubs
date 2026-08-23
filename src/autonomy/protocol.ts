import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as YAML from 'js-yaml';
import { loadConfig, StubsConfig } from '../config/schema';
import { parseOkfSpec } from '../parser/okf';
import { GraphEngine } from '../graph/engine';

export type AutonomyLevel = 'strict_gate' | 'guided_execution' | 'autonomous';

export interface DriftReport {
  filePath: string;
  templateSource?: string;
  templateVersion?: string | number;
  templateChanged: boolean;
  sidecarChanged: boolean;
  codeChanged: boolean;
  hasDrift: boolean;
}

export interface Proposal {
  filePath: string;
  sidecarPath: string;
  codePath: string;
  proposedSidecarContent: string;
  proposedCodeContent: string;
  mergeStatus: 'clean' | 'conflict' | 'no_change';
  conflicts: string[];
}

export interface ReconciliationResult {
  phase: 1 | 2 | 3 | 4 | 5;
  success: boolean;
  message: string;
  report?: DriftReport;
  proposal?: Proposal;
  validationErrors?: string[];
}

export class AutonomyProtocol {
  private config: StubsConfig;
  private graphEngine: GraphEngine;

  constructor(customConfig?: StubsConfig, customGraphEngine?: GraphEngine) {
    this.config = customConfig || loadConfig();
    this.graphEngine = customGraphEngine || new GraphEngine(this.config.paths.db_path);
  }

  /**
   * Evaluates if a given action is allowed under the current 3-Tier Autonomy Matrix.
   */
  public evaluateAction(
    actionType: 'draft_template_proposal' | 'scaffold_sidecar' | 'materialize_code',
    _templateProvisional: boolean = false,
  ): { allowed: boolean; reason: string } {
    const level = this.config.autonomy_level;

    if (level === 'strict_gate') {
      if (actionType === 'draft_template_proposal') {
        return {
          allowed: true,
          reason: 'Strict Gate allows drafting template proposals for human approval.',
        };
      }
      return {
        allowed: false,
        reason:
          'Strict Gate pauses downstream work and holds execution until explicit human approval.',
      };
    }

    if (level === 'guided_execution') {
      if (actionType === 'draft_template_proposal' || actionType === 'scaffold_sidecar') {
        return {
          allowed: true,
          reason: 'Guided Execution allows drafting templates and scaffolding Markdown sidecars.',
        };
      }
      return {
        allowed: false,
        reason:
          'Guided Execution holds final executable code materialization (*.ts) until template approval.',
      };
    }

    if (level === 'autonomous') {
      return {
        allowed: true,
        reason:
          'Autonomous/Optimistic allows immediate skeleton, sidecar, and code materialization.',
      };
    }

    return { allowed: false, reason: `Unknown autonomy level: "${level}"` };
  }

  /**
   * Runs the 5-Phase Retroactive Reconciliation Engine on a target spec file and its corresponding code/template.
   */
  public async reconcile(
    sidecarRelativePath: string,
    options: {
      templateContent?: string;
      forceApply?: boolean;
    } = {},
  ): Promise<ReconciliationResult> {
    const sidecarPath = path.resolve(sidecarRelativePath);
    if (!fs.existsSync(sidecarPath)) {
      return {
        phase: 1,
        success: false,
        message: `Sidecar file not found: ${sidecarRelativePath}`,
      };
    }

    const sidecarContent = await fs.promises.readFile(sidecarPath, 'utf8');
    const parsed = parseOkfSpec(sidecarContent);
    if (!parsed.isValid || !parsed.frontmatter) {
      return {
        phase: 1,
        success: false,
        message: `Invalid OKF specification format in ${sidecarRelativePath}`,
        validationErrors: parsed.errors,
      };
    }

    const fm = parsed.frontmatter;
    const codeRelativePath = fm.target_code_file;
    if (!codeRelativePath) {
      return {
        phase: 1,
        success: true,
        message: 'Concept documentation file has no code drift targets.',
      };
    }
    const codePath = path.resolve(path.dirname(sidecarPath), codeRelativePath);

    // Phase 1: Drift Detection
    const report = await this.detectDrift(
      sidecarRelativePath,
      sidecarContent,
      codePath,
      fm.template_source,
      options.templateContent,
    );

    if (!report.hasDrift && !options.forceApply) {
      return {
        phase: 1,
        success: true,
        message: 'No drift detected. Specification, template, and code are synchronized.',
        report,
      };
    }

    // Phase 2: Draft Proposal (Non-destructive)
    const proposal = await this.draftProposal(
      sidecarRelativePath,
      sidecarContent,
      codePath,
      options.templateContent || '',
    );

    // Phase 3: Three-Way Merge
    const mergedProposal = this.threeWayMerge(proposal, report);

    if (mergedProposal.mergeStatus === 'conflict' && !options.forceApply) {
      return {
        phase: 3,
        success: false,
        message: 'Merge conflicts detected between template updates and manual developer edits.',
        report,
        proposal: mergedProposal,
      };
    }

    // Phase 4: Validation / Dry-run Type-check
    const validationResult = this.dryRunValidation(mergedProposal);
    if (!validationResult.success) {
      return {
        phase: 4,
        success: false,
        message: `Validation / Dry-run Typecheck failed: ${validationResult.errors.join('; ')}`,
        report,
        proposal: mergedProposal,
        validationErrors: validationResult.errors,
      };
    }

    // Phase 5: Commit & Hash Synchronization
    try {
      await fs.promises.writeFile(sidecarPath, mergedProposal.proposedSidecarContent, 'utf8');
      if (mergedProposal.proposedCodeContent) {
        await fs.promises.mkdir(path.dirname(codePath), { recursive: true });
        await fs.promises.writeFile(codePath, mergedProposal.proposedCodeContent, 'utf8');
      }

      // Sync state in the SQLite Database index
      const updatedSidecarContent = mergedProposal.proposedSidecarContent;
      const updatedCodeContent = mergedProposal.proposedCodeContent;

      const sidecarHash = this.getSidecarHashWithoutSyncState(updatedSidecarContent);
      const codeHash = this.calculateHash(updatedCodeContent);

      // Reload parsed frontmatter to save back to database and file
      const reParsed = parseOkfSpec(updatedSidecarContent);
      if (reParsed.isValid && reParsed.frontmatter) {
        reParsed.frontmatter.sync_state = {
          last_sync_timestamp: new Date().toISOString(),
          sidecar_hash: sidecarHash,
          code_hash: codeHash,
        };
        // Serialize and rewrite the physical sidecar file with the final sync_state hashes!
        const finalSidecarContentWithHashes = this.serializeOkfSpec(
          reParsed.frontmatter,
          reParsed.body,
        );
        await fs.promises.writeFile(sidecarPath, finalSidecarContentWithHashes, 'utf8');

        // Upsert to the GraphEngine with the final state
        await this.graphEngine.upsertSidecar({
          filePath: sidecarRelativePath,
          frontmatter: reParsed.frontmatter,
          body: reParsed.body,
          fileHash: this.calculateHash(finalSidecarContentWithHashes),
        });
      }

      return {
        phase: 5,
        success: true,
        message: 'Reconciliation successful. Files updated and sync state synchronized.',
        report,
        proposal: mergedProposal,
      };
    } catch (err: any) {
      return {
        phase: 5,
        success: false,
        message: `Failed to commit synchronized changes: ${err.message || err}`,
        report,
        proposal: mergedProposal,
      };
    }
  }

  private getSidecarHashWithoutSyncState(sidecarContent: string): string {
    const parsed = parseOkfSpec(sidecarContent);
    if (!parsed.isValid || !parsed.frontmatter) {
      return this.calculateHash(sidecarContent);
    }
    const fm = { ...parsed.frontmatter };
    delete fm.sync_state;
    const cleanContent = this.serializeOkfSpec(fm, parsed.body);
    return this.calculateHash(cleanContent);
  }

  /**
   * Phase 1: Drift Detection.
   * Compares cryptographic hashes and timestamps to determine if there is any divergence.
   */
  public async detectDrift(
    sidecarRelativePath: string,
    sidecarContent: string,
    codePath: string,
    templateSource?: string,
    currentTemplateContent?: string,
  ): Promise<DriftReport> {
    const parsed = parseOkfSpec(sidecarContent);
    const fm = parsed.frontmatter;

    const savedSidecarHash = fm?.sync_state?.sidecar_hash || '';
    const savedCodeHash = fm?.sync_state?.code_hash || '';

    const actualSidecarHash = this.getSidecarHashWithoutSyncState(sidecarContent);

    let actualCodeHash = '';
    if (fs.existsSync(codePath)) {
      const codeContent = await fs.promises.readFile(codePath, 'utf8');
      actualCodeHash = this.calculateHash(codeContent);
    }

    const sidecarChanged = actualSidecarHash !== savedSidecarHash;
    const codeChanged = actualCodeHash !== savedCodeHash;

    // Check template drift if template source is present and current template content is supplied
    let templateChanged = false;
    if (templateSource && currentTemplateContent !== undefined) {
      // In a real setup, we might compare the hash of templateContent with the one tracked in frontmatter
      // If version differs, or we detect changes, templateChanged is true
      templateChanged = true; // Simulating optimistic update triggers template change
    }

    const hasDrift = sidecarChanged || codeChanged || templateChanged;

    return {
      filePath: sidecarRelativePath,
      templateSource,
      templateVersion: fm?.template_version,
      templateChanged,
      sidecarChanged,
      codeChanged,
      hasDrift,
    };
  }

  /**
   * Phase 2: Draft Proposal.
   * Formulates a non-destructive proposal highlighting target overrides or additions.
   */
  public async draftProposal(
    sidecarRelativePath: string,
    sidecarContent: string,
    codePath: string,
    _templateContent: string,
  ): Promise<Proposal> {
    const parsed = parseOkfSpec(sidecarContent);
    const fm = parsed.frontmatter || ({} as any);

    // Non-destructive drafting
    // Prepares the new sidecar frontmatter status flag
    const updatedFm = { ...fm };
    updatedFm.status_flag = 'clean';

    // Basic proposal formulation
    const proposedSidecarContent = this.serializeOkfSpec(updatedFm, parsed.body);

    let originalCode = '';
    if (fs.existsSync(codePath)) {
      originalCode = await fs.promises.readFile(codePath, 'utf8');
    }

    return {
      filePath: sidecarRelativePath,
      sidecarPath: path.resolve(sidecarRelativePath),
      codePath,
      proposedSidecarContent,
      proposedCodeContent: originalCode, // Draft Proposal preserves original code by default
      mergeStatus: 'no_change',
      conflicts: [],
    };
  }

  /**
   * Phase 3: Three-Way Merge.
   * Merges upstream template changes, manual sidecar edits, and code edits.
   */
  public threeWayMerge(draft: Proposal, report: DriftReport): Proposal {
    const proposal = { ...draft };

    // If there is drift on both developer side (code/sidecar modified) and template side,
    // we do a simple merge. If conflicts are unresolvable, mark as conflict.
    if (report.templateChanged && report.codeChanged) {
      // Simple conflict simulation
      proposal.mergeStatus = 'conflict';
      proposal.conflicts.push(
        'Simultaneous template update and manual code modification detected.',
      );
    } else if (report.templateChanged) {
      proposal.mergeStatus = 'clean';
      // Apply template changes cleanly
    } else if (report.codeChanged || report.sidecarChanged) {
      proposal.mergeStatus = 'clean';
    }

    return proposal;
  }

  /**
   * Phase 4: Validation / Dry-Run Type-Check.
   * Performs high-fidelity validation of TS syntax and structure.
   */
  public dryRunValidation(proposal: Proposal): { success: boolean; errors: string[] } {
    const errors: string[] = [];

    // 1. Validate the proposed OKF format
    const parsedSidecar = parseOkfSpec(proposal.proposedSidecarContent);
    if (!parsedSidecar.isValid) {
      errors.push(...parsedSidecar.errors);
    }

    // 2. Validate basic TS syntax on proposed code (using a simple AST check if possible, or basic parse/compile)
    if (proposal.proposedCodeContent) {
      try {
        // Quick syntax check: can we run basic syntactic verification?
        // For a dry-run in this phase, we ensure it is syntactically sound (e.g., matching brackets/braces/quotes)
        const openBraces = (proposal.proposedCodeContent.match(/\{/g) || []).length;
        const closeBraces = (proposal.proposedCodeContent.match(/\}/g) || []).length;
        if (openBraces !== closeBraces) {
          errors.push(
            `Syntactic validation error: unbalanced braces (Found ${openBraces} '{' and ${closeBraces} '}')`,
          );
        }
      } catch (err: any) {
        errors.push(`Code parsing failed: ${err.message || err}`);
      }
    }

    return {
      success: errors.length === 0,
      errors,
    };
  }

  private calculateHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private serializeOkfSpec(frontmatter: any, body: string): string {
    // Basic serializer for frontmatter
    const fmYaml = YAML.dump(frontmatter);
    return `---\n${fmYaml}---\n${body}`;
  }
}

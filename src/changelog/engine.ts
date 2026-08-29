import * as path from 'path';
import { execSync } from 'child_process';
import * as yaml from 'js-yaml';
import { normalizePosixPath } from '../graph/engine';
import { FileStorageDriver, NodeFileSystem } from '../storage';
import { loadConfig } from '../config/schema';

export interface AdrChange {
  id: string;
  summary: string;
  type: 'added' | 'removed' | 'modified';
  file: string;
}

export interface ExportChange {
  name: string;
  type: 'added' | 'removed' | 'modified';
  file: string;
  details?: string;
}

export interface PhaseTransition {
  file: string;
  fromPhase?: string;
  toPhase?: string;
  fromStatusFlag?: string;
  toStatusFlag?: string;
}

export interface SpecDiff {
  file: string;
  status: 'added' | 'modified' | 'deleted';
  adrs: AdrChange[];
  exports: ExportChange[];
  phaseTransition?: PhaseTransition;
}

export interface ChangelogSummary {
  totalChangedSpecs: number;
  adrsAdded: number;
  adrsModified: number;
  adrsRemoved: number;
  exportsAdded: number;
  exportsRemoved: number;
  phaseTransitions: number;
}

export interface ArchitecturalChangelog {
  fromRef?: string;
  toRef?: string;
  summary: ChangelogSummary;
  diffs: SpecDiff[];
  generatedAt: string;
}

export interface ChangelogOptions {
  since?: string;
  from?: string;
  to?: string;
  outputPath?: string;
  configPath?: string;
  specsDir?: string;
}

export class ChangelogEngine {
  private fsDriver: FileStorageDriver;

  constructor(options?: { fsDriver?: FileStorageDriver }) {
    this.fsDriver = options?.fsDriver || new NodeFileSystem();
  }

  /**
   * Helper to safely extract YAML frontmatter object.
   */
  private extractFrontmatter(content: string): any {
    if (!content) return null;
    const match = content.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    try {
      return yaml.load(match[1]) || {};
    } catch {
      return null;
    }
  }

  /**
   * Compares two OKF sidecar specification states to extract architectural diffs.
   */
  public diffSpecs(
    oldContent: string | null,
    newContent: string | null,
    filePath: string,
  ): SpecDiff {
    const normPath = normalizePosixPath(filePath);

    if (!oldContent && newContent) {
      const newFm = this.extractFrontmatter(newContent) || {};
      const adrs: AdrChange[] = (newFm.decisions || []).map((d: any) => ({
        id: d.id || 'ADR-NEW',
        summary: d.summary || '',
        type: 'added' as const,
        file: normPath,
      }));
      const exports: ExportChange[] = (newFm.exports || []).map((e: string) => ({
        name: e,
        type: 'added' as const,
        file: normPath,
      }));

      return {
        file: normPath,
        status: 'added',
        adrs,
        exports,
        phaseTransition: newFm.phase
          ? { file: normPath, toPhase: newFm.phase, toStatusFlag: newFm.status_flag }
          : undefined,
      };
    }

    if (oldContent && !newContent) {
      const oldFm = this.extractFrontmatter(oldContent) || {};
      const adrs: AdrChange[] = (oldFm.decisions || []).map((d: any) => ({
        id: d.id || 'ADR-OLD',
        summary: d.summary || '',
        type: 'removed' as const,
        file: normPath,
      }));
      const exports: ExportChange[] = (oldFm.exports || []).map((e: string) => ({
        name: e,
        type: 'removed' as const,
        file: normPath,
      }));

      return {
        file: normPath,
        status: 'deleted',
        adrs,
        exports,
      };
    }

    const oldFm = this.extractFrontmatter(oldContent || '') || {};
    const newFm = this.extractFrontmatter(newContent || '') || {};

    const adrs: AdrChange[] = [];
    const oldAdrs = (oldFm.decisions || []) as Array<{ id: string; summary: string }>;
    const newAdrs = (newFm.decisions || []) as Array<{ id: string; summary: string }>;

    const oldAdrMap = new Map(oldAdrs.map((d) => [d.id, d.summary]));
    const newAdrMap = new Map(newAdrs.map((d) => [d.id, d.summary]));

    // Newly added ADRs
    for (const [id, summary] of newAdrMap.entries()) {
      if (!oldAdrMap.has(id)) {
        adrs.push({ id, summary, type: 'added', file: normPath });
      } else if (oldAdrMap.get(id) !== summary) {
        adrs.push({ id, summary, type: 'modified', file: normPath });
      }
    }
    // Removed ADRs
    for (const [id, summary] of oldAdrMap.entries()) {
      if (!newAdrMap.has(id)) {
        adrs.push({ id, summary, type: 'removed', file: normPath });
      }
    }

    // Export changes
    const exports: ExportChange[] = [];
    const oldExports = new Set<string>((oldFm.exports || []) as string[]);
    const newExports = new Set<string>((newFm.exports || []) as string[]);

    for (const exp of newExports) {
      if (!oldExports.has(exp)) {
        exports.push({ name: exp, type: 'added', file: normPath });
      }
    }
    for (const exp of oldExports) {
      if (!newExports.has(exp)) {
        exports.push({ name: exp, type: 'removed', file: normPath });
      }
    }

    // Phase transition
    let phaseTransition: PhaseTransition | undefined;
    if (
      oldFm.phase !== newFm.phase ||
      oldFm.status !== newFm.status ||
      oldFm.status_flag !== newFm.status_flag
    ) {
      phaseTransition = {
        file: normPath,
        fromPhase: oldFm.phase || oldFm.status,
        toPhase: newFm.phase || newFm.status,
        fromStatusFlag: oldFm.status_flag,
        toStatusFlag: newFm.status_flag,
      };
    }

    return {
      file: normPath,
      status: 'modified',
      adrs,
      exports,
      phaseTransition,
    };
  }

  /**
   * Generates complete semantic architectural changelog across a git revision range.
   */
  public async generateChangelog(options: ChangelogOptions = {}): Promise<ArchitecturalChangelog> {
    const config = loadConfig(options.configPath);
    const specsDir = options.specsDir || config.paths?.specs_dir || 'src';

    const fromRef = options.from || options.since;
    const toRef = options.to || 'HEAD';

    const diffs: SpecDiff[] = [];

    try {
      // Determine git diff file list
      let gitDiffCmd = '';
      if (fromRef) {
        gitDiffCmd = `git diff --name-status ${fromRef} ${toRef}`;
      } else {
        gitDiffCmd = 'git status --porcelain';
      }

      const rawOutput = execSync(gitDiffCmd, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const lines = rawOutput.split('\n').filter((l) => l.trim().length > 0);

      for (const line of lines) {
        let statusCode = '';
        let filePath = '';

        if (fromRef) {
          const parts = line.trim().split(/\s+/);
          statusCode = parts[0];
          filePath = parts[1];
        } else {
          statusCode = line.substring(0, 2).trim();
          filePath = line.substring(3).trim();
        }

        if (!filePath.endsWith('.md') && !filePath.endsWith('.ts')) continue;
        if (!filePath.startsWith(specsDir) && !filePath.startsWith('knowledge/')) continue;

        let oldContent: string | null = null;
        let newContent: string | null = null;

        if (statusCode.startsWith('D')) {
          // File was deleted
          try {
            oldContent = fromRef
              ? execSync(`git show ${fromRef}:${filePath}`, {
                  encoding: 'utf8',
                  stdio: ['pipe', 'pipe', 'ignore'],
                })
              : '';
          } catch {
            oldContent = '';
          }
        } else if (statusCode.startsWith('A') || statusCode === '??') {
          // File was added
          try {
            newContent = await this.fsDriver.readFile(filePath);
          } catch {
            newContent = null;
          }
        } else {
          // File was modified
          try {
            oldContent = fromRef
              ? execSync(`git show ${fromRef}:${filePath}`, {
                  encoding: 'utf8',
                  stdio: ['pipe', 'pipe', 'ignore'],
                })
              : execSync(`git show HEAD:${filePath}`, {
                  encoding: 'utf8',
                  stdio: ['pipe', 'pipe', 'ignore'],
                });
          } catch {
            oldContent = '';
          }

          try {
            newContent = await this.fsDriver.readFile(filePath);
          } catch {
            newContent = null;
          }
        }

        const diff = this.diffSpecs(oldContent, newContent, filePath);
        if (
          diff.adrs.length > 0 ||
          diff.exports.length > 0 ||
          diff.phaseTransition ||
          diff.status !== 'modified'
        ) {
          diffs.push(diff);
        }
      }
    } catch {
      // Git command fallback: return empty diffs gracefully if not inside git repo
    }

    const summary: ChangelogSummary = {
      totalChangedSpecs: diffs.length,
      adrsAdded: diffs.reduce((acc, d) => acc + d.adrs.filter((a) => a.type === 'added').length, 0),
      adrsModified: diffs.reduce(
        (acc, d) => acc + d.adrs.filter((a) => a.type === 'modified').length,
        0,
      ),
      adrsRemoved: diffs.reduce(
        (acc, d) => acc + d.adrs.filter((a) => a.type === 'removed').length,
        0,
      ),
      exportsAdded: diffs.reduce(
        (acc, d) => acc + d.exports.filter((e) => e.type === 'added').length,
        0,
      ),
      exportsRemoved: diffs.reduce(
        (acc, d) => acc + d.exports.filter((e) => e.type === 'removed').length,
        0,
      ),
      phaseTransitions: diffs.filter((d) => d.phaseTransition !== undefined).length,
    };

    const changelog: ArchitecturalChangelog = {
      fromRef,
      toRef,
      summary,
      diffs,
      generatedAt: new Date().toISOString(),
    };

    if (options.outputPath) {
      const rendered = this.renderMarkdown(changelog);
      const dir = path.dirname(options.outputPath);
      await this.fsDriver.mkdir(dir, { recursive: true });
      await this.fsDriver.writeFile(options.outputPath, rendered);
    }

    return changelog;
  }

  /**
   * Renders the architectural changelog into standard GitHub-flavored markdown.
   */
  public renderMarkdown(changelog: ArchitecturalChangelog): string {
    const lines: string[] = [];
    lines.push('# Semantic Architectural Changelog');
    lines.push(
      `> **Range:** ${changelog.fromRef || 'Working Tree'} $\\rightarrow$ ${changelog.toRef || 'HEAD'} | **Generated:** ${changelog.generatedAt}`,
    );
    lines.push('');

    // Summary Metric Badges
    lines.push('## Executive Summary');
    lines.push('| Metric | Count |');
    lines.push('| ------ | ----- |');
    lines.push(`| **Specifications Changed** | ${changelog.summary.totalChangedSpecs} |`);
    lines.push(
      `| **Architectural Decisions (ADRs)** | +${changelog.summary.adrsAdded} added / ~${changelog.summary.adrsModified} modified / -${changelog.summary.adrsRemoved} removed |`,
    );
    lines.push(
      `| **Public Interface Contracts** | +${changelog.summary.exportsAdded} exports / -${changelog.summary.exportsRemoved} removed |`,
    );
    lines.push(`| **Lifecycle Phase Advances** | ${changelog.summary.phaseTransitions} |`);
    lines.push('');

    if (changelog.diffs.length === 0) {
      lines.push('✓ **No architectural or specification changes detected.**');
      return lines.join('\n');
    }

    // 1. Architectural Decisions (ADRs) Section
    const allAdrs = changelog.diffs.flatMap((d) => d.adrs);
    if (allAdrs.length > 0) {
      lines.push('## Architectural Decisions (ADRs)');
      for (const adr of allAdrs) {
        const symbol =
          adr.type === 'added'
            ? '✨ [NEW]'
            : adr.type === 'modified'
              ? '🔄 [MODIFIED]'
              : '🗑️ [REMOVED]';
        lines.push(`- **${symbol} \`${adr.id}\` in \`${adr.file}\`**: ${adr.summary}`);
      }
      lines.push('');
    }

    // 2. Public Contract Drift Section
    const allExports = changelog.diffs.flatMap((d) => d.exports);
    if (allExports.length > 0) {
      lines.push('## Public Contract & Signature Drift');
      for (const exp of allExports) {
        const symbol =
          exp.type === 'added'
            ? '🟢 Added export'
            : exp.type === 'removed'
              ? '🔴 Removed export'
              : '🟡 Modified';
        lines.push(`- **${symbol} \`${exp.name}\`** in \`${exp.file}\``);
      }
      lines.push('');
    }

    // 3. Lifecycle Phase Transitions Section
    const transitions = changelog.diffs
      .map((d) => d.phaseTransition)
      .filter((p): p is PhaseTransition => p !== undefined);

    if (transitions.length > 0) {
      lines.push('## Lifecycle Phase Transitions');
      for (const t of transitions) {
        lines.push(
          `- \`${t.file}\`: \`${t.fromPhase || 'draft'}\` $\\rightarrow$ **\`${t.toPhase || 'spec'}\`**`,
        );
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}

import * as path from 'path';
import {
  parseOkfSpec,
  extractFileTreeBlocks,
  parseFileTreeEntries,
  FileTreeEntry,
} from '../parser/okf';
import { GraphEngine, normalizePosixPath } from '../graph/engine';
import { TemplateEngine } from '../templates/engine';
import { FileStorageDriver, NodeFileSystem } from '../storage';

export interface CreateConceptOptions {
  title: string;
  type?: 'concept-doc' | 'initiative-plan' | 'planning-map';
  domain?: string;
  initiative?: string;
  description?: string;
  targetPath?: string;
  tags?: string[];
  problemStatement?: string;
  architectureOverview?: string;
  filetree?: string;
}

export interface CreateConceptResult {
  filePath: string;
  content: string;
  isCreated: boolean;
}

export interface ScaffoldResult {
  docPath: string;
  created: string[];
  skipped: string[];
  errors: string[];
}

export interface ConceptInfo {
  filePath: string;
  title: string;
  type: string;
  phase: string;
  initiative?: string;
  description?: string;
}

export class ConceptEngine {
  private fsDriver: FileStorageDriver;
  private graphEngine?: GraphEngine;
  private templateEngine: TemplateEngine;

  constructor(
    options: {
      fsDriver?: FileStorageDriver;
      graphEngine?: GraphEngine;
      templatesDir?: string;
    } = {},
  ) {
    this.fsDriver = options.fsDriver || new NodeFileSystem();
    this.graphEngine = options.graphEngine;
    this.templateEngine = new TemplateEngine(options.templatesDir);
  }

  /**
   * Helper to convert string to URL/file-friendly slug
   */
  private slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Creates a new conceptual document or initiative plan from template molds.
   */
  public async createConcept(options: CreateConceptOptions): Promise<CreateConceptResult> {
    const type = options.type || 'concept-doc';
    const slug = this.slugify(options.title || 'untitled-concept');

    let targetFilePath = options.targetPath;
    if (!targetFilePath) {
      if (type === 'initiative-plan') {
        targetFilePath = `knowledge/planning/${slug}-plan.md`;
      } else if (type === 'planning-map') {
        targetFilePath = `knowledge/planning/planning-map.md`;
      } else {
        if (options.domain) {
          targetFilePath = `src/${this.slugify(options.domain)}/concept.md`;
        } else {
          targetFilePath = `knowledge/planning/${slug}.md`;
        }
      }
    }

    const normalizedPath = normalizePosixPath(targetFilePath);
    const moldName = `${type}.md.tpl`;
    let renderedContent: string;

    const templateData = {
      title: options.title,
      type,
      description: options.description || `${options.title} conceptual architecture specification.`,
      tags: options.tags || ['concept', 'architecture', this.slugify(options.title)],
      phase: 'conceptualize',
      status: 'spec',
      version: 1,
      status_flag: 'clean',
      initiative: options.initiative || '',
      problem_statement: options.problemStatement || '',
      architecture_overview: options.architectureOverview || '',
      filetree: options.filetree || '',
      default_initiative: options.initiative || options.title,
    };

    try {
      renderedContent = await this.templateEngine.renderTemplate(moldName, templateData);
    } catch {
      // Fallback default generation if mold is not found on disk
      if (type === 'initiative-plan') {
        renderedContent = `---
title: "${options.title}"
type: initiative-plan
description: "${options.description || 'Implementation roadmap and multi-agent task tracker.'}"
tags:
  - planning
  - roadmap
  - initiative
phase: conceptualize
status: spec
version: 1
status_flag: clean
${options.initiative ? `initiative: ${options.initiative}\n` : ''}---

# ${options.title}

## Executive Summary
${options.description || 'High-level objective and execution plan.'}

## Planned Architecture & File Tree Blueprint
\`\`\`filetree
src/
  ${this.slugify(options.title)}/
    engine.ts # [NEW] Core engine implementation
    engine.ts.md # [NEW] Spec sidecar
\`\`\`

## Phase-by-Phase Execution & Task Tracker

### Phase 1: Conceptualize & Specification Scaffolding
- [ ] Define domain boundaries and conceptual file tree.
- [ ] Scaffold initial specifications.

### Phase 2: Grill & Stress-Testing
- [ ] Interrogate architectural trade-offs and resolve open questions.

### Phase 3: Spec & Sidecar Definition
- [ ] Complete OKF sidecar contracts and type signatures.

### Phase 4: Materialization & Core Implementation
- [ ] Materialize executable source code and run compiler typechecks.

### Phase 5: Sanding, Testing & Verification
- [ ] Run full test suite and confirm zero AST drift.
`;
      } else {
        renderedContent = `---
title: "${options.title}"
type: concept-doc
description: "${options.description || 'Conceptual architecture and domain specification.'}"
tags:
  - concept
  - domain
  - architecture
phase: conceptualize
status: spec
version: 1
status_flag: clean
${options.initiative ? `initiative: ${options.initiative}\n` : ''}---

# ${options.title}

## Problem Framing & Domain Scope
${options.problemStatement || 'Describe the core problem domain and functional scope.'}

## Architectural Concepts & Domain Model
${options.architectureOverview || 'Detail domain entities and invariants.'}

## Planned File Tree Blueprint
\`\`\`filetree
src/
  ${this.slugify(options.title)}/
    engine.ts.md # [NEW] Core sidecar specification
\`\`\`

## Decisions & Alternatives Considered
- **ADR-001:** Initial design rationale.
`;
      }
    }

    const dir = path.dirname(normalizedPath);
    if (dir && dir !== '.' && !(await this.fsDriver.exists(dir))) {
      await this.fsDriver.mkdir(dir, { recursive: true });
    }

    await this.fsDriver.writeFile(normalizedPath, renderedContent);

    if (this.graphEngine) {
      try {
        await this.graphEngine.indexFile(normalizedPath);
      } catch {
        // Non-blocking index attempt
      }
    }

    return {
      filePath: normalizedPath,
      content: renderedContent,
      isCreated: true,
    };
  }

  /**
   * Scaffolds empty directories, starter code files, and OKF sidecar stubs from a concept document's filetree.
   */
  public async scaffoldFileTreeFromDoc(
    docPath: string,
    options: { dryRun?: boolean; overwrite?: boolean } = {},
  ): Promise<ScaffoldResult> {
    const result: ScaffoldResult = {
      docPath: normalizePosixPath(docPath),
      created: [],
      skipped: [],
      errors: [],
    };

    if (!(await this.fsDriver.exists(docPath))) {
      result.errors.push(`Document not found at path: "${docPath}"`);
      return result;
    }

    let content: string;
    try {
      content = await this.fsDriver.readFile(docPath);
    } catch (err: any) {
      result.errors.push(`Failed to read document: ${err.message || err}`);
      return result;
    }

    const parsed = parseOkfSpec(content);
    const treeBlocks = extractFileTreeBlocks(content);
    const entries: FileTreeEntry[] = [];

    for (const block of treeBlocks) {
      entries.push(...parseFileTreeEntries(block));
    }

    if (parsed.frontmatter?.planned_files) {
      for (const pf of parsed.frontmatter.planned_files) {
        if (typeof pf === 'string') {
          entries.push({ path: pf, type: pf.endsWith('.md') ? 'spec' : 'file' });
        } else if (pf && typeof pf === 'object') {
          entries.push({
            path: pf.path,
            type: (pf.type || (pf.path.endsWith('.md') ? 'spec' : 'file')) as
              'file' | 'dir' | 'spec',
            description: pf.description,
          });
        }
      }
    }

    if (entries.length === 0) {
      return result;
    }

    for (const entry of entries) {
      const targetPath = normalizePosixPath(entry.path);
      const isDir = entry.type === 'dir' || targetPath.endsWith('/');

      try {
        if (isDir) {
          if (!(await this.fsDriver.exists(targetPath))) {
            if (!options.dryRun) {
              await this.fsDriver.mkdir(targetPath, { recursive: true });
            }
            result.created.push(targetPath);
          } else {
            result.skipped.push(targetPath);
          }
          continue;
        }

        const parentDir = path.dirname(targetPath);
        if (parentDir && parentDir !== '.' && !(await this.fsDriver.exists(parentDir))) {
          if (!options.dryRun) {
            await this.fsDriver.mkdir(parentDir, { recursive: true });
          }
        }

        const fileExists = await this.fsDriver.exists(targetPath);
        if (fileExists && !options.overwrite) {
          result.skipped.push(targetPath);
          continue;
        }

        if (!options.dryRun) {
          if (entry.type === 'spec' || targetPath.endsWith('.md')) {
            const fileName = path.basename(targetPath);
            const title = fileName.replace(/\.(ts|js|py)?\.md$/, '');
            const targetCode = targetPath.endsWith('.ts.md')
              ? `./${fileName.replace(/\.md$/, '')}`
              : undefined;

            const skeletonContent = `---
title: "${title} Spec"
type: "${targetCode ? 'sidecar-spec' : 'concept-doc'}"
description: "${entry.description || 'Specification sidecar.'}"
tags:
  - ${this.slugify(title)}
  - spec
status: skeleton
version: 1
phase: spec
${targetCode ? `target_code_file: "${targetCode}"\n` : ''}status_flag: clean
exports: []
---

# ${title} Specification

## Overview
${entry.description || 'Module specification and API contracts.'}

${
  targetCode
    ? `## Implementation

\`\`\`typescript
// Implementation stub for ${title}
\`\`\`
`
    : ''
}`;
            await this.fsDriver.writeFile(targetPath, skeletonContent);
          } else {
            // Normal source or helper file stub
            const headerComment = `// ${path.basename(targetPath)} — Stub implementation\n`;
            await this.fsDriver.writeFile(targetPath, headerComment);
          }
        }

        result.created.push(targetPath);
      } catch (err: any) {
        result.errors.push(`Failed to scaffold "${entry.path}": ${err.message || err}`);
      }
    }

    return result;
  }

  /**
   * Lists all conceptual documents, initiative plans, and planning maps.
   */
  public async listConcepts(searchDir: string = '.'): Promise<ConceptInfo[]> {
    if (this.graphEngine) {
      const hub = await this.graphEngine.getPlanningHub();
      const list: ConceptInfo[] = [];

      hub.initiatives.forEach((i) => {
        list.push({
          filePath: i.filePath,
          title: i.title,
          type: i.type,
          phase: i.phase,
          description: '',
        });
      });

      hub.concepts.forEach((c) => {
        list.push({
          filePath: c.filePath,
          title: c.title,
          type: c.type,
          phase: c.phase,
          description: c.description,
        });
      });

      if (list.length > 0) {
        return list;
      }
    }

    // Direct filesystem scan fallback
    const results: ConceptInfo[] = [];
    const scanDir = async (dir: string) => {
      try {
        const entries = await this.fsDriver.readDir(dir);
        for (const entry of entries) {
          if (
            entry === 'node_modules' ||
            entry === '.git' ||
            entry === '.stubs' ||
            entry === 'dist'
          ) {
            continue;
          }
          const fullPath = dir === '.' ? entry : `${dir}/${entry}`;
          try {
            const sub = await this.fsDriver.readDir(fullPath);
            if (sub) {
              await scanDir(fullPath);
            }
          } catch {
            if (entry.endsWith('.md')) {
              try {
                const content = await this.fsDriver.readFile(fullPath);
                if (content.trim().startsWith('---')) {
                  const parsed = parseOkfSpec(content);
                  if (
                    parsed.isValid &&
                    ['concept-doc', 'initiative-plan', 'planning-map', 'architecture-doc'].includes(
                      parsed.frontmatter?.type || '',
                    )
                  ) {
                    results.push({
                      filePath: normalizePosixPath(fullPath),
                      title: parsed.frontmatter?.title || entry,
                      type: parsed.frontmatter?.type || 'concept-doc',
                      phase: parsed.frontmatter?.phase || 'conceptualize',
                      initiative: parsed.frontmatter?.initiative,
                      description: parsed.frontmatter?.description,
                    });
                  }
                }
              } catch {
                // Ignore file read/parse errors
              }
            }
          }
        }
      } catch {
        // Ignore directory read errors
      }
    };

    await scanDir(searchDir);
    return results;
  }
}

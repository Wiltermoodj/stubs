import { promises as fs } from 'fs';
import * as path from 'path';
import {
  extractFileTreeBlocks,
  parseFileTreeEntries,
  extractMarkdownChecklists,
  parseOkfSpec,
} from '../src/parser/okf';
import { ConceptEngine } from '../src/concept/engine';

describe('Concept Engine & File Tree Parser Unit Tests', () => {
  const testDir = path.join(__dirname, 'temp_concept_test');

  beforeAll(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe('OKF Markdown Filetree & Checklist Extractors', () => {
    it('should extract filetree blocks from markdown', () => {
      const markdown = `
# System Architecture

Here is the blueprint:

\`\`\`filetree
knowledge/
  planning/
    planning-map.md             # [NEW] Master Planning Hub index
    lifecycle-expansion-plan.md # [NEW] Initiative plan
src/
  parser/
    okf.ts                      # [MODIFY] OKF parser
\`\`\`

And tasks:
- [ ] Task 1
- [x] Task 2
`;

      const blocks = extractFileTreeBlocks(markdown);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toContain('planning-map.md');

      const entries = parseFileTreeEntries(blocks[0]);
      expect(entries.length).toBeGreaterThanOrEqual(4);

      const planMap = entries.find((e) => e.path.endsWith('planning-map.md'));
      expect(planMap).toBeDefined();
      expect(planMap?.type).toBe('spec');
      expect(planMap?.description).toBe('[NEW] Master Planning Hub index');
      expect(planMap?.path).toBe('knowledge/planning/planning-map.md');

      const okfTs = entries.find((e) => e.path.endsWith('okf.ts'));
      expect(okfTs).toBeDefined();
      expect(okfTs?.type).toBe('file');
      expect(okfTs?.description).toBe('[MODIFY] OKF parser');
    });

    it('should extract markdown checklists with line numbers', () => {
      const markdown = `
Line 1
- [ ] First uncompleted task
Line 3
- [x] Second completed task
- [X] Third uppercase completed task
`;
      const checklists = extractMarkdownChecklists(markdown);
      expect(checklists).toHaveLength(3);
      expect(checklists[0]).toEqual({
        text: 'First uncompleted task',
        completed: false,
        line: 3,
      });
      expect(checklists[1]).toEqual({
        text: 'Second completed task',
        completed: true,
        line: 5,
      });
      expect(checklists[2]).toEqual({
        text: 'Third uppercase completed task',
        completed: true,
        line: 6,
      });
    });
  });

  describe('ConceptEngine Scaffolding and Document Generation', () => {
    it('should create a new concept document from mold', async () => {
      const engine = new ConceptEngine();
      const docPath = path.join(testDir, 'analytics-concept.md');

      const result = await engine.createConcept({
        title: 'Realtime Analytics',
        type: 'concept-doc',
        description: 'Streaming analytics and metrics aggregation.',
        targetPath: docPath,
      });

      expect(result.isCreated).toBe(true);
      expect(result.filePath).toBe(docPath);

      const content = await fs.readFile(docPath, 'utf8');
      const parsed = parseOkfSpec(content);
      expect(parsed.isValid).toBe(true);
      expect(parsed.frontmatter?.title).toBe('Realtime Analytics');
      expect(parsed.frontmatter?.type).toBe('concept-doc');
      expect(parsed.frontmatter?.phase).toBe('conceptualize');
    });

    it('should scaffold file tree blueprint on disk from document', async () => {
      const engine = new ConceptEngine();
      const docPath = path.join(testDir, 'feature-plan.md');

      const blueprintDoc = `---
title: "Search Feature"
type: initiative-plan
description: "Search system"
tags: ["search"]
phase: conceptualize
status: spec
version: 1
status_flag: clean
---

# Search Feature Blueprint

\`\`\`filetree
tests/temp_concept_test/
  search/
    core.ts # [NEW] Search core
    core.ts.md # [NEW] Search spec sidecar
\`\`\`
`;

      await fs.writeFile(docPath, blueprintDoc, 'utf8');

      const scaffoldResult = await engine.scaffoldFileTreeFromDoc(docPath);
      expect(scaffoldResult.errors).toHaveLength(0);

      const targetSpec = path.join(testDir, 'search', 'core.ts.md');
      const targetCode = path.join(testDir, 'search', 'core.ts');

      const specExists = await fs
        .access(targetSpec)
        .then(() => true)
        .catch(() => false);
      const codeExists = await fs
        .access(targetCode)
        .then(() => true)
        .catch(() => false);

      expect(specExists).toBe(true);
      expect(codeExists).toBe(true);

      const specContent = await fs.readFile(targetSpec, 'utf8');
      const parsedSpec = parseOkfSpec(specContent);
      expect(parsedSpec.isValid).toBe(true);
      expect(parsedSpec.frontmatter?.type).toBe('sidecar-spec');
      expect(parsedSpec.frontmatter?.target_code_file).toBe('./core.ts');
    });
  });
});

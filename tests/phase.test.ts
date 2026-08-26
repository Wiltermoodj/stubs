import { promises as fs } from 'fs';
import * as path from 'path';
import { PhaseEngine } from '../src/phase/engine';
import { parseOkfSpec } from '../src/parser/okf';

describe('Phase Engine 5-Phase Lifecycle State Machine Tests', () => {
  const testDir = path.join(__dirname, 'temp_phase_test');

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

  it('should normalize phase names correctly', () => {
    const engine = new PhaseEngine();
    expect(engine.normalizePhase('conceptualize')).toBe('conceptualize');
    expect(engine.normalizePhase('Concept')).toBe('conceptualize');
    expect(engine.normalizePhase('grill')).toBe('grill');
    expect(engine.normalizePhase('spec')).toBe('spec');
    expect(engine.normalizePhase('scaffold')).toBe('spec');
    expect(engine.normalizePhase('materialize')).toBe('materialize');
    expect(engine.normalizePhase('sand')).toBe('sand');
    expect(engine.normalizePhase('sand-audit')).toBe('sand');
    expect(engine.normalizePhase(null)).toBe('spec');
  });

  it('should evaluate gating rules from conceptualize to grill', async () => {
    const engine = new PhaseEngine();
    const docPath = path.join(testDir, 'concept.md');

    // Missing filetree blueprint
    await fs.writeFile(
      docPath,
      `---
title: "Sample Concept"
type: "concept-doc"
description: "A detailed description of the concept."
tags: ["concept"]
phase: "conceptualize"
status: "spec"
version: 1
status_flag: "clean"
---
# Sample Concept
No filetree here.
`,
      'utf8',
    );

    let checkResult = await engine.checkPhase(docPath);
    expect(checkResult.currentPhase).toBe('conceptualize');
    expect(checkResult.nextPhase).toBe('grill');
    expect(checkResult.canAdvance).toBe(false);

    // Add filetree blueprint
    await fs.writeFile(
      docPath,
      `---
title: "Sample Concept"
type: "concept-doc"
description: "A detailed description of the concept."
tags: ["concept"]
phase: "conceptualize"
status: "spec"
version: 1
status_flag: "clean"
---
# Sample Concept

\`\`\`filetree
src/
  sample.ts
\`\`\`
`,
      'utf8',
    );

    checkResult = await engine.checkPhase(docPath);
    expect(checkResult.canAdvance).toBe(true);

    // Advance phase
    const advanceResult = await engine.advancePhase(docPath);
    expect(advanceResult.success).toBe(true);
    expect(advanceResult.fromPhase).toBe('conceptualize');
    expect(advanceResult.toPhase).toBe('grill');

    const updatedContent = await fs.readFile(docPath, 'utf8');
    const parsed = parseOkfSpec(updatedContent);
    expect(parsed.frontmatter?.phase).toBe('grill');
  });

  it('should block advance from grill to spec when user notes are pending', async () => {
    const engine = new PhaseEngine();
    const docPath = path.join(testDir, 'grill-spec.md');

    await fs.writeFile(
      docPath,
      `---
title: "Grill Test"
type: "concept-doc"
description: "Grilling phase test"
tags: ["grill"]
phase: "grill"
status: "spec"
version: 1
status_flag: "clean"
user_notes:
  - id: "NOTE-1"
    timestamp: "2026-08-26T00:00:00Z"
    text: "Should we use PostgreSQL or SQLite?"
    status: "pending"
---
# Grill Test
`,
      'utf8',
    );

    const checkResult = await engine.checkPhase(docPath);
    expect(checkResult.currentPhase).toBe('grill');
    expect(checkResult.nextPhase).toBe('spec');
    expect(checkResult.canAdvance).toBe(false);
    expect(checkResult.errors.some((e) => e.includes('pending'))).toBe(true);
  });
});

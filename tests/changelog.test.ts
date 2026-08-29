import { promises as fs } from 'fs';
import * as path from 'path';
import { ChangelogEngine } from '../src/changelog/engine';

describe('Changelog Engine & Semantic Architectural Release Notes Tests', () => {
  const testDir = path.join(__dirname, 'temp_changelog_test');

  beforeAll(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('diffs sidecar specifications detecting new ADRs and modified summaries', () => {
    const engine = new ChangelogEngine();

    const oldSpec = `---
title: Payment Engine
type: sidecar-spec
description: Old payment engine
status: spec
version: 1
exports:
  - processPayment
decisions:
  - id: ADR-001
    summary: Use Stripe API for card processing.
---
# Old Spec
`;

    const newSpec = `---
title: Payment Engine
type: sidecar-spec
description: New payment engine
status: materialized
version: 2
exports:
  - processPayment
  - refundPayment
decisions:
  - id: ADR-001
    summary: Use Stripe and Adyen APIs for multi-gateway fallback.
  - id: ADR-002
    summary: Tokenize card PANs at client edge.
---
# New Spec
`;

    const diff = engine.diffSpecs(oldSpec, newSpec, 'src/billing/payment.ts.md');

    expect(diff.status).toBe('modified');
    // ADR changes
    expect(diff.adrs.length).toBe(2);
    expect(diff.adrs.find((a) => a.id === 'ADR-002')?.type).toBe('added');
    expect(diff.adrs.find((a) => a.id === 'ADR-001')?.type).toBe('modified');

    // Export changes
    expect(diff.exports.length).toBe(1);
    expect(diff.exports[0].name).toBe('refundPayment');
    expect(diff.exports[0].type).toBe('added');

    // Phase transition
    expect(diff.phaseTransition).toBeDefined();
    expect(diff.phaseTransition?.fromPhase).toBe('spec');
    expect(diff.phaseTransition?.toPhase).toBe('materialized');
  });

  it('diffs added and deleted sidecar specifications', () => {
    const engine = new ChangelogEngine();

    const newSpec = `---
title: New Service
type: sidecar-spec
description: Brand new service
status: spec
version: 1
exports:
  - NewService
decisions:
  - id: ADR-100
    summary: First decision.
---
# New Service
`;

    // Added
    const addDiff = engine.diffSpecs(null, newSpec, 'src/new/service.ts.md');
    expect(addDiff.status).toBe('added');
    expect(addDiff.adrs.length).toBe(1);
    expect(addDiff.adrs[0].type).toBe('added');
    expect(addDiff.exports.length).toBe(1);
    expect(addDiff.exports[0].type).toBe('added');

    // Deleted
    const delDiff = engine.diffSpecs(newSpec, null, 'src/old/service.ts.md');
    expect(delDiff.status).toBe('deleted');
    expect(delDiff.adrs.length).toBe(1);
    expect(delDiff.adrs[0].type).toBe('removed');
    expect(delDiff.exports.length).toBe(1);
    expect(delDiff.exports[0].type).toBe('removed');
  });

  it('renders a formatted markdown release report with executive summary and badges', () => {
    const engine = new ChangelogEngine();

    const diff = engine.diffSpecs(
      `---
title: Auth
type: sidecar-spec
description: Auth
status: spec
version: 1
exports: [login]
decisions: [{ id: ADR-001, summary: Old summary }]
---`,
      `---
title: Auth
type: sidecar-spec
description: Auth
status: materialized
version: 2
exports: [login, logout]
decisions: [{ id: ADR-001, summary: New summary }, { id: ADR-002, summary: WebAuthn }]
---`,
      'src/auth/service.ts.md',
    );

    const changelog = {
      fromRef: 'v1.0.0',
      toRef: 'v1.1.0',
      summary: {
        totalChangedSpecs: 1,
        adrsAdded: 1,
        adrsModified: 1,
        adrsRemoved: 0,
        exportsAdded: 1,
        exportsRemoved: 0,
        phaseTransitions: 1,
      },
      diffs: [diff],
      generatedAt: new Date().toISOString(),
    };

    const md = engine.renderMarkdown(changelog);

    expect(md).toContain('# Semantic Architectural Changelog');
    expect(md).toContain('Executive Summary');
    expect(md).toContain('+1 added / ~1 modified / -0 removed');
    expect(md).toContain('ADR-002');
    expect(md).toContain('logout');
    expect(md).toContain('`spec` $\\rightarrow$ **`materialized`**');
  });

  it('writes changelog file when outputPath option is supplied', async () => {
    const engine = new ChangelogEngine();
    const outPath = path.join(testDir, 'CHANGELOG.md');

    const changelog = await engine.generateChangelog({
      outputPath: outPath,
    });

    expect(changelog).toBeDefined();
    expect(await fs.stat(outPath)).toBeDefined();
  });
});

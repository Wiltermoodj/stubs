import { promises as fs } from 'fs';
import * as path from 'path';
import { MockEngine } from '../src/mock/engine';

describe('Mock Engine & Spec-Driven Test Scaffolding Tests', () => {
  const testDir = path.join(__dirname, 'temp_mock_test');

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

  it('generates a Jest test scaffold from a sidecar spec with ADRs and exported functions', async () => {
    const sidecarPath = path.join(testDir, 'payment-gateway.ts.md');
    const codePath = path.join(testDir, 'payment-gateway.ts');

    await fs.writeFile(
      sidecarPath,
      `---
title: Payment Gateway Service
type: sidecar-spec
description: Handles credit card charges and tokenization.
tags: [billing, payments]
phase: spec
status: spec
version: 1
status_flag: clean
exports:
  - PaymentGatewayEngine
  - processPayment
  - PaymentConfig
decisions:
  - id: ADR-001
    summary: Always tokenize PAN numbers before transmitting to third-party APIs.
    date: "2026-08-28"
---
# Payment Gateway Service
`,
      'utf8',
    );

    await fs.writeFile(
      codePath,
      `
export interface PaymentConfig {
  apiKey: string;
}

export function processPayment(amount: number, config: PaymentConfig): boolean {
  return amount > 0;
}

export class PaymentGatewayEngine {
  constructor() {}
  public charge(amount: number): boolean {
    return true;
  }
}
`,
      'utf8',
    );

    const mockEngine = new MockEngine();
    const result = await mockEngine.generateTestScaffold(sidecarPath, {
      outputPath: path.join(testDir, 'payment-gateway.test.ts'),
      framework: 'jest',
      dryRun: true,
    });

    expect(result.sourceFilePath).toBe(sidecarPath.replace(/\\/g, '/'));
    expect(result.framework).toBe('jest');
    expect(result.exportedSymbols).toContain('PaymentConfig');
    expect(result.exportedSymbols).toContain('processPayment');
    expect(result.exportedSymbols).toContain('PaymentGatewayEngine');

    // Verify generated test code contents
    expect(result.generatedCode).toContain(
      'import {\n  PaymentConfig,\n  processPayment,\n  PaymentGatewayEngine,\n}',
    );
    expect(result.generatedCode).toContain("describe('PaymentGatewayEngine'");
    expect(result.generatedCode).toContain("describe('processPayment()'");
    expect(result.generatedCode).toContain(
      'should adhere to ADR-001 (Always tokenize PAN numbers before transmitting to third-party APIs.)',
    );
  });

  it('generates Vitest-compatible test harness when requested', async () => {
    const sidecarPath = path.join(testDir, 'auth-helper.ts.md');
    await fs.writeFile(
      sidecarPath,
      `---
title: Auth Helper
type: sidecar-spec
description: Auth utility functions.
tags: [auth]
phase: spec
status: spec
version: 1
status_flag: clean
exports:
  - verifyToken
---
# Auth Helper
`,
      'utf8',
    );

    const mockEngine = new MockEngine();
    const result = await mockEngine.generateTestScaffold(sidecarPath, {
      outputPath: path.join(testDir, 'auth-helper.test.ts'),
      framework: 'vitest',
      dryRun: true,
    });

    expect(result.framework).toBe('vitest');
    expect(result.generatedCode).toContain(
      "import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';",
    );
  });

  it('writes test scaffold to disk and respects force overwrite flag', async () => {
    const sidecarPath = path.join(testDir, 'disk-target.ts.md');
    const outTestPath = path.join(testDir, 'disk-target.test.ts');

    await fs.writeFile(
      sidecarPath,
      `---
title: Disk Target
type: sidecar-spec
description: Testing disk writes.
tags: [test]
phase: spec
status: spec
version: 1
status_flag: clean
exports:
  - DiskEngine
---
# Disk Target
`,
      'utf8',
    );

    const mockEngine = new MockEngine();

    // 1. Initial write
    const res1 = await mockEngine.generateTestScaffold(sidecarPath, {
      outputPath: outTestPath,
      dryRun: false,
    });
    expect(res1.written).toBe(true);
    expect(await fs.stat(outTestPath)).toBeDefined();

    // 2. Second write without force should not overwrite
    const res2 = await mockEngine.generateTestScaffold(sidecarPath, {
      outputPath: outTestPath,
      dryRun: false,
      force: false,
    });
    expect(res2.written).toBe(false);

    // 3. Third write with force should overwrite
    const res3 = await mockEngine.generateTestScaffold(sidecarPath, {
      outputPath: outTestPath,
      dryRun: false,
      force: true,
    });
    expect(res3.written).toBe(true);
  });
});

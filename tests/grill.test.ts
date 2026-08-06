import * as fs from 'fs';
import * as path from 'path';
import { GrillEngine, GrillState } from '../src/grill/engine';
import { CliRouter } from '../src/cli/router';
import { parseOkfSpec } from '../src/parser/okf';

describe('Interactive Grill Engine & Re-Grilling', () => {
  const tempFile = path.resolve(__dirname, 'test_grill_module.ts.md');
  const validContent = `---
title: "Auth Spec"
type: "sidecar-spec"
description: "Authentication specification sidecar"
tags: ["auth", "jwt"]
status: "spec"
version: 1
target_code_file: "./auth.ts"
status_flag: "clean"
context_object: "AuthContext"
decisions:
  - id: "DEC-001"
    summary: "Use HS256 algorithm for signing"
    date: "2026-08-05"
---
# Authentication Module Specification

This is the specification body.
`;

  beforeEach(() => {
    fs.writeFileSync(tempFile, validContent, 'utf8');
  });

  afterEach(() => {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  });

  it('should execute the Grill Engine state machine successfully and transition through states', async () => {
    const engine = new GrillEngine();
    const states: GrillState[] = [];
    let stateDuringGrillingStatus: string | null = null;

    await engine.grill(tempFile, {
      depth: 'light_probe',
      nonInteractive: true,
      onStateChange: (state) => {
        states.push(state);
        if (state === 'GRILLING') {
          // Read physical file content during the grilling phase to verify intermediate state
          const content = fs.readFileSync(tempFile, 'utf8');
          const parsed = parseOkfSpec(content);
          stateDuringGrillingStatus = parsed.frontmatter?.status || null;
        }
      },
    });

    // Check state sequence
    expect(states).toContain('INIT');
    expect(states).toContain('PARSING');
    expect(states).toContain('GENERATING_QUESTIONS');
    expect(states).toContain('GRILLING');
    expect(states).toContain('SAVING');
    expect(states).toContain('DONE');

    // Confirm intermediate file status was set to 'grilling'
    expect(stateDuringGrillingStatus).toBe('grilling');

    // Confirm final file status was returned to 'spec'
    const finalContent = fs.readFileSync(tempFile, 'utf8');
    const finalParsed = parseOkfSpec(finalContent);
    expect(finalParsed.frontmatter?.status).toBe('spec');

    // Confirm user notes were updated
    expect(finalParsed.frontmatter?.user_notes).toBeDefined();
    expect(finalParsed.frontmatter?.user_notes?.length).toBe(2);
    expect(finalParsed.frontmatter?.user_notes?.[0].status).toBe('resolved');

    // Confirm body has discussion section
    expect(finalParsed.body).toContain('## Grilling & Discussion (Light Probe)');
  });

  it('should generate the correct question counts and content for different depth matrices', async () => {
    const engine = new GrillEngine();

    // 1. Light Probe (1-2 questions)
    let finalParsed = await runGrillAndGetParsed(engine, tempFile, 'light_probe', [
      'Ans 1',
      'Ans 2',
    ]);
    expect(finalParsed.frontmatter?.user_notes?.length).toBe(2);
    expect(finalParsed.body).toContain('Ans 1');
    expect(finalParsed.body).toContain('Ans 2');
    expect(finalParsed.body).toContain("Regarding the module's public interface");

    // Reset file
    fs.writeFileSync(tempFile, validContent, 'utf8');

    // 2. Standard Drill (2-4 questions)
    finalParsed = await runGrillAndGetParsed(engine, tempFile, 'standard_drill', [
      'Ans A',
      'Ans B',
      'Ans C',
      'Ans D',
    ]);
    expect(finalParsed.frontmatter?.user_notes?.length).toBe(4);
    expect(finalParsed.body).toContain('Ans A');
    expect(finalParsed.body).toContain('Ans D');
    expect(finalParsed.body).toContain(
      'How does the context object `AuthContext` capture environment',
    );
    expect(finalParsed.body).toContain('"define errors out of existence"');

    // Reset file
    fs.writeFileSync(tempFile, validContent, 'utf8');

    // 3. Deep Interrogation (4-6 questions)
    finalParsed = await runGrillAndGetParsed(engine, tempFile, 'deep_interrogation', [
      'Ans I',
      'Ans II',
      'Ans III',
      'Ans IV',
      'Ans V',
      'Ans VI',
    ]);
    expect(finalParsed.frontmatter?.user_notes?.length).toBe(6);
    expect(finalParsed.body).toContain('Ans I');
    expect(finalParsed.body).toContain('Ans VI');
    expect(finalParsed.body).toContain('DEC-001');
    expect(finalParsed.body).toContain('concurrent execution');
    expect(finalParsed.body).toContain('security boundaries');
  });

  it('should support customized answers in non-interactive mode', async () => {
    const engine = new GrillEngine();
    const customAnswers = ['Custom Answer 1', 'Custom Answer 2'];

    await engine.grill(tempFile, {
      depth: 'light_probe',
      nonInteractive: true,
      answers: customAnswers,
    });

    const parsed = parseOkfSpec(fs.readFileSync(tempFile, 'utf8'));
    expect(parsed.frontmatter?.user_notes?.[0].text).toContain('Custom Answer 1');
    expect(parsed.frontmatter?.user_notes?.[1].text).toContain('Custom Answer 2');
  });

  it('should integrate with the CLI Router grill command', async () => {
    const router = new CliRouter();
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      // 1. Fail if no file is passed
      let code = await router.route(['grill']);
      expect(code).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('requires a file path argument'),
      );

      // 2. Fail if target file doesn't exist
      code = await router.route(['grill', 'non-existent.ts.md']);
      expect(code).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('File not found at'));

      // 3. Fail if invalid depth is passed
      code = await router.route(['grill', tempFile, '--depth', 'ultra_drill']);
      expect(code).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid depth "ultra_drill"'));

      // 4. Run successfully on valid file
      code = await router.route(['grill', tempFile, '--depth', 'light_probe', '--non-interactive']);
      expect(code).toBe(0);

      const parsed = parseOkfSpec(fs.readFileSync(tempFile, 'utf8'));
      expect(parsed.frontmatter?.status).toBe('spec');
      expect(parsed.frontmatter?.user_notes?.length).toBe(2);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

async function runGrillAndGetParsed(
  engine: GrillEngine,
  filePath: string,
  depth: 'light_probe' | 'standard_drill' | 'deep_interrogation',
  answers: string[],
) {
  await engine.grill(filePath, {
    depth,
    nonInteractive: true,
    answers,
  });
  return parseOkfSpec(fs.readFileSync(filePath, 'utf8'));
}

import { CliRouter } from '../src/cli/router';
import * as path from 'path';
import * as fs from 'fs';

describe('CLI Router', () => {
  let router: CliRouter;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    router = new CliRouter();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('should print help when no command is passed', async () => {
    const code = await router.route([]);
    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('stubs - AI Agent Sidecar Specification Framework'),
    );
  });

  it('should print help when help flag is passed', async () => {
    const code = await router.route(['--help']);
    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  it('should print version when version flag is passed', async () => {
    const code = await router.route(['-v']);
    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('stubs version'));
  });

  it('should print error and return 1 for unknown command', async () => {
    const code = await router.route(['unknown-cmd']);
    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown command "unknown-cmd"'));
  });

  it('should run serve command successfully', async () => {
    const code = await router.route(['serve']);
    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Starting stubs Web Portal'));
  });

  it('should fail validation if validate is called without arguments', async () => {
    const code = await router.route(['validate']);
    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('requires a file path argument'));
  });

  it('should fail validation if target file does not exist', async () => {
    const code = await router.route(['validate', 'non-existent-file.ts.md']);
    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('File not found at'));
  });

  it('should succeed validation with a valid OKF sidecar file', async () => {
    const tempFilePath = path.resolve(__dirname, 'temp_valid.ts.md');
    const validContent = `---
title: "Temp Spec"
type: "sidecar-spec"
description: "Temporary spec for testing"
tags: ["test"]
status: "spec"
version: 1
target_code_file: "./temp.ts"
status_flag: "clean"
---
# Content
`;
    fs.writeFileSync(tempFilePath, validContent, 'utf8');

    try {
      const code = await router.route(['validate', tempFilePath]);
      expect(code).toBe(0);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Validation succeeded for'));
    } finally {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
  });

  it('should fail validation with an invalid OKF sidecar file', async () => {
    const tempFilePath = path.resolve(__dirname, 'temp_invalid.ts.md');
    const invalidContent = `---
title: "Temp Spec"
# Missing other fields
---
`;
    fs.writeFileSync(tempFilePath, invalidContent, 'utf8');

    try {
      const code = await router.route(['validate', tempFilePath]);
      expect(code).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Validation failed for'));
    } finally {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
  });
});

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

  describe('install command', () => {
    let originalFetch: typeof global.fetch;
    let originalCwd: () => string;
    let tempDir: string;

    beforeEach(() => {
      originalFetch = global.fetch;
      originalCwd = process.cwd;
      tempDir = path.resolve(
        __dirname,
        'temp_install_test_' + Math.random().toString(36).substring(7),
      );
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      fs.mkdirSync(tempDir, { recursive: true });
      process.cwd = () => tempDir;
    });

    afterEach(() => {
      global.fetch = originalFetch;
      process.cwd = originalCwd;
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should install skill and files successfully and update .gitignore', async () => {
      global.fetch = jest.fn().mockImplementation((url: string) => {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          arrayBuffer: () => Promise.resolve(Buffer.from(`mock content for ${url}`).buffer),
        });
      }) as any;

      const code = await router.route(['install']);
      expect(code).toBe(0);

      // Verify directory structure and files
      expect(fs.existsSync(path.join(tempDir, '.agents/skills/stubs/SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.agents/skills/stubs/.gitignore'))).toBe(true);

      const expectedSubSkills = [
        'auditing',
        'changelog',
        'conceptualizing',
        'context',
        'context-mapping',
        'diagram',
        'grilling',
        'lint',
        'materialization',
        'mock',
        'pruning',
        'sanding',
      ];
      for (const subSkill of expectedSubSkills) {
        expect(
          fs.existsSync(path.join(tempDir, `.agents/skills/stubs/sub-skills/${subSkill}/SKILL.md`)),
        ).toBe(true);
      }
      expect(fs.existsSync(path.join(tempDir, '.gitignore'))).toBe(true);

      const gitignore = fs.readFileSync(path.join(tempDir, '.gitignore'), 'utf8');
      expect(gitignore).toContain('.stubs/graph.sqlite*');
      expect(gitignore).toContain('.stubs/*.sqlite');
    });

    it('should fail install if target directory already exists and force is not specified', async () => {
      fs.mkdirSync(path.join(tempDir, '.agents/skills/stubs'), { recursive: true });

      const code = await router.route(['install']);
      expect(code).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('already exists'));
    });

    it('should succeed install if target directory already exists and force is specified', async () => {
      fs.mkdirSync(path.join(tempDir, '.agents/skills/stubs'), { recursive: true });

      global.fetch = jest.fn().mockImplementation((url: string) => {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          arrayBuffer: () => Promise.resolve(Buffer.from(`mock content for ${url}`).buffer),
        });
      }) as any;

      const code = await router.route(['install', '--force']);
      expect(code).toBe(0);
      expect(fs.existsSync(path.join(tempDir, '.agents/skills/stubs/SKILL.md'))).toBe(true);
    });

    it('should handle custom repo and branch arguments', async () => {
      const mockFetch = jest.fn().mockImplementation((url: string) => {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          arrayBuffer: () => Promise.resolve(Buffer.from(`mock content for ${url}`).buffer),
        });
      });
      global.fetch = mockFetch as any;

      const code = await router.route([
        'install',
        '--repo',
        'myowner/myrepo',
        '--branch',
        'feature-branch',
      ]);
      expect(code).toBe(0);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://raw.githubusercontent.com/myowner/myrepo/feature-branch/'),
      );
    });

    it('should handle download network error gracefully', async () => {
      global.fetch = jest.fn().mockImplementation(() => {
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        });
      }) as any;

      const code = await router.route(['install']);
      expect(code).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to download'));
    });

    it('should update skill and files directly without error when update command is invoked', async () => {
      fs.mkdirSync(path.join(tempDir, '.agents/skills/stubs'), { recursive: true });

      global.fetch = jest.fn().mockImplementation((url: string) => {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          arrayBuffer: () => Promise.resolve(Buffer.from(`updated mock content for ${url}`).buffer),
        });
      }) as any;

      const code = await router.route(['update']);
      expect(code).toBe(0);
      expect(fs.existsSync(path.join(tempDir, '.agents/skills/stubs/SKILL.md'))).toBe(true);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('stubs update completed successfully!'),
      );
    });

    it('should support upgrade alias for update command', async () => {
      fs.mkdirSync(path.join(tempDir, '.agents/skills/stubs'), { recursive: true });

      global.fetch = jest.fn().mockImplementation((url: string) => {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          arrayBuffer: () => Promise.resolve(Buffer.from(`updated mock content for ${url}`).buffer),
        });
      }) as any;

      const code = await router.route(['upgrade']);
      expect(code).toBe(0);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('stubs update completed successfully!'),
      );
    });

    it('should print npm update instructions when package.json dependency is detected', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ devDependencies: { stubs: 'github:Wiltermoodj/stubs' } }),
      );

      global.fetch = jest.fn().mockImplementation((url: string) => {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          arrayBuffer: () => Promise.resolve(Buffer.from(`mock content for ${url}`).buffer),
        });
      }) as any;

      const code = await router.route(['update']);
      expect(code).toBe(0);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Detected stubs installed as an npm package dependency'),
      );
    });

    it('should detect various package managers correctly', () => {
      expect(router.detectPackageManager(tempDir)).toBe('npm');

      fs.writeFileSync(path.join(tempDir, 'pnpm-lock.yaml'), '');
      expect(router.detectPackageManager(tempDir)).toBe('pnpm');
      fs.unlinkSync(path.join(tempDir, 'pnpm-lock.yaml'));

      fs.writeFileSync(path.join(tempDir, 'yarn.lock'), '');
      expect(router.detectPackageManager(tempDir)).toBe('yarn');
      fs.unlinkSync(path.join(tempDir, 'yarn.lock'));

      fs.writeFileSync(path.join(tempDir, 'bun.lockb'), '');
      expect(router.detectPackageManager(tempDir)).toBe('bun');
      fs.unlinkSync(path.join(tempDir, 'bun.lockb'));
    });

    it('should perform comprehensive initialization with templates, skills, and multi-agent adapters', async () => {
      global.fetch = jest.fn().mockImplementation((url: string) => {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          arrayBuffer: () => Promise.resolve(Buffer.from(`mock content for ${url}`).buffer),
        });
      }) as any;

      const code = await router.route(['init', '--all-agents', '--scaffold']);
      expect(code).toBe(0);

      // Verify config
      expect(fs.existsSync(path.join(tempDir, '.stubs/config.json'))).toBe(true);

      // Verify templates seeded
      expect(fs.existsSync(path.join(tempDir, '.stubs/templates'))).toBe(true);
      const templates = fs.readdirSync(path.join(tempDir, '.stubs/templates'));
      expect(templates.length).toBeGreaterThan(0);

      // Verify gitignore
      expect(fs.existsSync(path.join(tempDir, '.gitignore'))).toBe(true);
      const gitignore = fs.readFileSync(path.join(tempDir, '.gitignore'), 'utf8');
      expect(gitignore).toContain('.stubs/graph.sqlite*');

      // Verify Antigravity skills
      expect(fs.existsSync(path.join(tempDir, '.agents/skills/stubs/SKILL.md'))).toBe(true);

      // Verify Claude adapter
      expect(fs.existsSync(path.join(tempDir, '.claude/skills/stubs/SKILL.md'))).toBe(true);

      // Verify Cursor adapter
      expect(fs.existsSync(path.join(tempDir, '.cursor/rules/stubs.mdc'))).toBe(true);

      // Verify scaffolded context map
      expect(fs.existsSync(path.join(tempDir, 'knowledge/architecture/context-map.md'))).toBe(true);
    });

    it('should preserve customized templates during update', async () => {
      global.fetch = jest.fn().mockImplementation((url: string) => {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          arrayBuffer: () => Promise.resolve(Buffer.from(`mock content for ${url}`).buffer),
        });
      }) as any;

      await router.route(['init']);

      const customTemplatePath = path.join(tempDir, '.stubs/templates/my-custom.tpl');
      fs.writeFileSync(customTemplatePath, 'custom mold content', 'utf8');

      const existingServicePath = path.join(tempDir, '.stubs/templates/service.ts.md.tpl');
      if (fs.existsSync(existingServicePath)) {
        fs.writeFileSync(existingServicePath, 'user modified service template', 'utf8');
      }

      const updateCode = await router.route(['update']);
      expect(updateCode).toBe(0);

      // Verify custom template remains intact
      expect(fs.readFileSync(customTemplatePath, 'utf8')).toBe('custom mold content');
      if (fs.existsSync(existingServicePath)) {
        expect(fs.readFileSync(existingServicePath, 'utf8')).toBe('user modified service template');
      }
    });

    it('should run stubs scan and index codebase into graph', async () => {
      fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'src', 'auth.ts'),
        'export class AuthService { public login() { return true; } }',
        'utf8',
      );

      const code = await router.route(['scan', 'src']);
      expect(code).toBe(0);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Codebase AST Indexing Complete'),
      );
    });
  });
});

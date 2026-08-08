import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  resolveToken,
  validateToken,
  listAccessibleRepositories,
  fetchTree,
  fetchFileContents,
  createOrUpdateFile,
  decryptToken,
} from '../src/server/github';
import { handleLogin } from '../src/cli/auth';

describe('GitHub Client API and Auth Credentials Manager', () => {
  const originalEnv = { ...process.env };
  const mockCredsDir = path.join(os.homedir(), '.stubs');
  const mockCredsPath = path.join(mockCredsDir, 'credentials.json');
  let originalCreds: string | null = null;

  beforeAll(() => {
    // Preserve existing credentials if any
    if (fs.existsSync(mockCredsPath)) {
      originalCreds = fs.readFileSync(mockCredsPath, 'utf8');
    }
  });

  afterAll(() => {
    // Restore original credentials if any
    if (originalCreds !== null) {
      if (!fs.existsSync(mockCredsDir)) {
        fs.mkdirSync(mockCredsDir, { recursive: true });
      }
      fs.writeFileSync(mockCredsPath, originalCreds, 'utf8');
    } else {
      if (fs.existsSync(mockCredsPath)) {
        fs.unlinkSync(mockCredsPath);
      }
    }
  });

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    // Clear credentials file before each test
    if (fs.existsSync(mockCredsPath)) {
      fs.unlinkSync(mockCredsPath);
    }
    // Set custom API base to intercept requests via fetch mocks easily
    process.env.GITHUB_API_BASE_URL = 'https://api.github.mock';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('Token Resolution Hierarchy', () => {
    it('should resolve token from STUBS_GITHUB_PAT first', () => {
      process.env.STUBS_GITHUB_PAT = 'env_pat_token';
      process.env.GITHUB_TOKEN = 'env_token';

      // Create a temporary config file
      const configPath = path.join(os.tmpdir(), 'stubs_config_test.json');
      fs.writeFileSync(configPath, JSON.stringify({ github_token: 'config_token' }), 'utf8');

      // Create a mock credentials file
      if (!fs.existsSync(mockCredsDir)) {
        fs.mkdirSync(mockCredsDir, { recursive: true });
      }
      fs.writeFileSync(
        mockCredsPath,
        JSON.stringify({ 'github.com': { token: 'credentials_token' } }),
        'utf8',
      );

      const resolved = resolveToken(configPath);
      expect(resolved).toBe('env_pat_token');

      fs.unlinkSync(configPath);
    });

    it('should resolve token from GITHUB_TOKEN if STUBS_GITHUB_PAT is absent', () => {
      delete process.env.STUBS_GITHUB_PAT;
      process.env.GITHUB_TOKEN = 'env_token';

      const resolved = resolveToken();
      expect(resolved).toBe('env_token');
    });

    it('should resolve token from .stubs/config.json with env expansion support', () => {
      delete process.env.STUBS_GITHUB_PAT;
      delete process.env.GITHUB_TOKEN;
      process.env.GITHUB_PAT_VARIABLE = 'expanded_token_val';

      const configPath = path.join(os.tmpdir(), 'stubs_config_test_env.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({ github_token: '${ENV:GITHUB_PAT_VARIABLE}' }),
        'utf8',
      );

      const resolved = resolveToken(configPath);
      expect(resolved).toBe('expanded_token_val');

      fs.unlinkSync(configPath);
    });

    it('should resolve token from ~/.stubs/credentials.json if env and config are absent', () => {
      delete process.env.STUBS_GITHUB_PAT;
      delete process.env.GITHUB_TOKEN;

      if (!fs.existsSync(mockCredsDir)) {
        fs.mkdirSync(mockCredsDir, { recursive: true });
      }
      fs.writeFileSync(
        mockCredsPath,
        JSON.stringify({ 'github.com': { token: 'credentials_token_hier' } }),
        'utf8',
      );

      const resolved = resolveToken();
      expect(resolved).toBe('credentials_token_hier');
    });
  });

  describe('GitHubClient Methods', () => {
    it('should validate token successfully', async () => {
      const mockUser = {
        login: 'testuser',
        id: 12345,
        name: 'Test User',
        email: 'test@github.mock',
      };

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockImplementation((url, init) => {
        if (url.endsWith('/user')) {
          expect(init.headers['Authorization']).toBe('token valid_mock_token');
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockUser),
          });
        }
        return Promise.reject(new Error('Unknown url'));
      }) as any;

      const user = await validateToken('valid_mock_token');
      expect(user.login).toBe('testuser');
      expect(user.id).toBe(12345);

      global.fetch = originalFetch;
    });

    it('should throw auth error when validation fails', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.endsWith('/user')) {
          return Promise.resolve({
            ok: false,
            status: 401,
            text: () => Promise.resolve('Bad credentials'),
          });
        }
        return Promise.reject(new Error('Unknown url'));
      }) as any;

      await expect(validateToken('invalid_token')).rejects.toThrow(
        /GitHub token validation failed \(Status 401\): Bad credentials/,
      );

      global.fetch = originalFetch;
    });

    it('should list accessible repositories', async () => {
      const mockRepos = [
        {
          full_name: 'owner/repo1',
          default_branch: 'main',
          permissions: { push: true, pull: true },
        },
        {
          full_name: 'owner/repo2',
          default_branch: 'develop',
          permissions: { push: false, pull: true },
        },
      ];

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.includes('/user/repos')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockRepos),
          });
        }
        return Promise.reject(new Error('Unknown url'));
      }) as any;

      const repos = await listAccessibleRepositories('mock_token');
      expect(repos.length).toBe(2);
      expect(repos[0].fullName).toBe('owner/repo1');
      expect(repos[0].defaultBranch).toBe('main');

      global.fetch = originalFetch;
    });

    it('should fetch repository recursive tree', async () => {
      const mockTree = {
        tree: [
          { path: 'src/cli.ts', mode: '100644', type: 'blob', sha: 'sha1', url: 'url1' },
          { path: 'src/server', mode: '040000', type: 'tree', sha: 'sha2', url: 'url2' },
        ],
      };

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.includes('/git/trees/main?recursive=1')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockTree),
          });
        }
        return Promise.reject(new Error('Unknown url'));
      }) as any;

      const tree = await fetchTree('owner', 'repo', 'main', 'mock_token');
      expect(tree.length).toBe(2);
      expect(tree[0].path).toBe('src/cli.ts');
      expect(tree[1].type).toBe('tree');

      global.fetch = originalFetch;
    });

    it('should fetch raw file contents', async () => {
      const rawContent = 'console.log("hello");';

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockImplementation((url, init) => {
        if (url.includes('/contents/src/cli.ts')) {
          expect(init.headers['Accept']).toBe('application/vnd.github.v3.raw');
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve(rawContent),
          });
        }
        return Promise.reject(new Error('Unknown url'));
      }) as any;

      const content = await fetchFileContents('owner', 'repo', 'src/cli.ts', 'main', 'mock_token');
      expect(content).toBe(rawContent);

      global.fetch = originalFetch;
    });

    it('should create or update a file on remote repository', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockImplementation((url, init) => {
        if (url.includes('/contents/src/new-file.ts') && init.method === 'GET') {
          // File does not exist initially
          return Promise.resolve({
            ok: false,
            status: 404,
          });
        }
        if (url.includes('/contents/src/new-file.ts') && init.method === 'PUT') {
          const body = JSON.parse(init.body);
          expect(body.message).toBe('Commit message');
          expect(body.branch).toBe('main');
          // Check base64 content
          const decoded = Buffer.from(body.content, 'base64').toString('utf8');
          expect(decoded).toBe('file content');

          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ content: { name: 'new-file.ts' } }),
          });
        }
        return Promise.reject(new Error('Unknown url'));
      }) as any;

      const res = await createOrUpdateFile(
        'owner',
        'repo',
        'src/new-file.ts',
        'file content',
        'Commit message',
        'main',
        'mock_token',
      );
      expect(res.content.name).toBe('new-file.ts');

      global.fetch = originalFetch;
    });
  });

  describe('Interactive and Non-Interactive handleLogin', () => {
    it('should run handleLogin successfully with non-interactive token options', async () => {
      const mockUser = {
        login: 'testlogin',
        id: 999,
        name: 'Login Tester',
        email: 'tester@github.mock',
      };

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.endsWith('/user')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockUser),
          });
        }
        return Promise.reject(new Error('Unknown url'));
      }) as any;

      const exitCode = await handleLogin({
        token: 'cli_valid_token',
        nonInteractive: true,
      });

      expect(exitCode).toBe(0);

      // Verify file written to ~/.stubs/credentials.json
      expect(fs.existsSync(mockCredsPath)).toBe(true);
      const raw = fs.readFileSync(mockCredsPath, 'utf8');
      const creds = JSON.parse(raw);
      expect(decryptToken(creds['github.com'].token)).toBe('cli_valid_token');
      expect(creds['github.com'].login).toBe('testlogin');

      // Verify mode is secured (chmod 600 - on unix systems)
      if (process.platform !== 'win32') {
        const stats = fs.statSync(mockCredsPath);
        expect(stats.mode & 0o777).toBe(0o600);
      }

      global.fetch = originalFetch;
    });

    it('should fail handleLogin if token is invalid', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.endsWith('/user')) {
          return Promise.resolve({
            ok: false,
            status: 401,
            text: () => Promise.resolve('Bad credentials'),
          });
        }
        return Promise.reject(new Error('Unknown url'));
      }) as any;

      const exitCode = await handleLogin({
        token: 'cli_invalid_token',
        nonInteractive: true,
      });

      expect(exitCode).toBe(1);
      expect(fs.existsSync(mockCredsPath)).toBe(false);

      global.fetch = originalFetch;
    });
  });
});

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
import {
  loadCredentials,
  saveCredentials,
  maskToken,
  encrypt,
  decrypt,
} from '../src/storage/credentials';

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

      // Create a mock credentials file using saveCredentials
      saveCredentials({ 'github.com': { token: 'credentials_token' } });

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

      saveCredentials({ 'github.com': { token: 'credentials_token_hier' } });

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

      // Verify file written to ~/.stubs/credentials.json (encrypted format)
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

  describe('Secure Storage, Input Masking & Redaction Unit Tests', () => {
    it('should successfully encrypt and decrypt credentials payload', () => {
      const plaintext = 'secret-token-payload';
      const encrypted = encrypt(plaintext);

      const parsed = JSON.parse(encrypted);
      expect(parsed.encrypted).toBe(true);
      expect(parsed.salt).toBeDefined();
      expect(parsed.iv).toBeDefined();
      expect(parsed.tag).toBeDefined();
      expect(parsed.ciphertext).toBeDefined();

      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should enforce strict file permissions (0600) on load and throw exception if insecure', () => {
      if (process.platform === 'win32') {
        // Skip chmod checks on Windows
        return;
      }

      const creds = { github_token: 'test_token' };
      saveCredentials(creds);

      // Make the file world-readable (chmod 0644 equivalent or world readable)
      fs.chmodSync(mockCredsPath, 0o644);

      expect(() => loadCredentials()).toThrow(
        /Security Error: Credentials file.*has insecure permissions/,
      );

      // Restore to secure permissions
      fs.chmodSync(mockCredsPath, 0o600);
      const loaded = loadCredentials();
      expect(loaded.github_token).toBe('test_token');
    });

    it('should correctly redact/mask classic and fine-grained PATs in arbitrary strings', () => {
      const classicPat = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz';
      const finePat =
        'github_pat_1234567890abcdefghijklmnopqrstuvwxyz_1234567890abcdefghijklmnopqrstuvwxyz_12345678';
      const normalText = 'This is a normal log message with no token.';

      expect(maskToken(classicPat)).toBe('ghp_****wxyz');
      expect(maskToken(finePat)).toBe('github_pat_****5678');
      expect(maskToken(normalText)).toBe(normalText);

      const mixedText = `An error occurred: token ${classicPat} is invalid.`;
      expect(maskToken(mixedText)).toContain('ghp_****wxyz');
    });

    it('should handle piped non-TTY stdin input in handleLogin', async () => {
      const mockUser = {
        login: 'pipeduser',
        id: 777,
        name: 'Piped User',
        email: 'piped@github.mock',
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

      // Mock process.stdin.isTTY to false and stub 'on' event handlers to simulate piped input
      const originalIsTTY = process.stdin.isTTY;
      process.stdin.isTTY = false;

      const mockStdinOn = jest
        .spyOn(process.stdin, 'on')
        .mockImplementation((event: any, callback: any) => {
          if (event === 'data') {
            callback(Buffer.from('piped_pat_token\n'));
          }
          if (event === 'end') {
            callback();
          }
          return process.stdin;
        });

      const exitCode = await handleLogin({
        nonInteractive: false,
      });

      expect(exitCode).toBe(0);

      const loaded = loadCredentials();
      expect(loaded.github_token).toBe('piped_pat_token');

      mockStdinOn.mockRestore();
      process.stdin.isTTY = originalIsTTY;
      global.fetch = originalFetch;
    });
  });
});

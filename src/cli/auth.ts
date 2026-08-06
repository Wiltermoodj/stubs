import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { GitHubClient } from '../server/github';

/**
 * Handles the login workflow interactive or via provided token option.
 * Stores global credentials in ~/.stubs/credentials.json (chmod 600).
 */
export async function handleLogin(
  options: { token?: string; nonInteractive?: boolean } = {},
): Promise<number> {
  const credsDir = path.join(os.homedir(), '.stubs');
  const credsPath = path.join(credsDir, 'credentials.json');

  let token = options.token;

  if (!token) {
    if (options.nonInteractive) {
      console.error(
        'Error: Token must be provided with --token when running in non-interactive mode.',
      );
      return 1;
    }

    // Prompt user for GitHub Personal Access Token via CLI
    const rl = readline.createInterface({
      input: process.stdin as any,
      output: process.stdout as any,
    });

    const askToken = (): Promise<string> => {
      return new Promise((resolve) => {
        rl.question('Please enter your GitHub Personal Access Token (PAT):\n> ', (answer) => {
          resolve(answer.trim());
        });
      });
    };

    token = await askToken();
    rl.close();
  }

  if (!token) {
    console.error('Error: GitHub Personal Access Token is required.');
    return 1;
  }

  console.log('Validating Personal Access Token with GitHub API...');
  try {
    const client = new GitHubClient(token);
    const user = await client.validateToken();
    console.log(
      `Successfully authenticated as GitHub user: ${user.login} (${user.name || 'No Name'})`,
    );

    // Ensure directory exists
    if (!fs.existsSync(credsDir)) {
      fs.mkdirSync(credsDir, { recursive: true });
    }

    // Read current credentials if they exist
    let credentials: Record<string, any> = {};
    if (fs.existsSync(credsPath)) {
      try {
        const raw = fs.readFileSync(credsPath, 'utf8');
        credentials = JSON.parse(raw);
      } catch {
        // Ignore and write a new one
      }
    }

    // Save token mapped to host 'github.com' and globally
    credentials['github.com'] = {
      token,
      login: user.login,
      updatedAt: new Date().toISOString(),
    };
    credentials.github_token = token;

    fs.writeFileSync(credsPath, JSON.stringify(credentials, null, 2), 'utf8');

    // Chmod 600 (only owner can read and write)
    try {
      fs.chmodSync(credsPath, 0o600);
    } catch (chmodErr: any) {
      console.warn(
        `Warning: Could not set secure file permissions (600) on credentials file: ${chmodErr.message}`,
      );
    }

    console.log(`Global credentials securely stored in ${credsPath}`);
    return 0;
  } catch (error: any) {
    console.error(`Authentication/Validation failed: ${error.message || error}`);
    return 1;
  }
}

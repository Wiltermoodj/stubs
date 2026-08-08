import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { GitHubClient, encryptToken } from '../server/github';

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

  if (token) {
    console.warn(
      'Warning: The --token <pat> command-line argument is deprecated to prevent token leaks in shell history. Please use interactive login or define the STUBS_GITHUB_PAT environment variable instead.',
    );
  }

  if (!token) {
    if (options.nonInteractive) {
      console.error(
        'Error: Token must be provided with --token when running in non-interactive mode.',
      );
      return 1;
    }

    // Prompt user for GitHub Personal Access Token via CLI with masking
    const rl = readline.createInterface({
      input: process.stdin as any,
      output: process.stdout as any,
    }) as any;

    rl.muted = false;
    rl._writeToOutput = function _writeToOutput(stringToWrite: string) {
      if (!rl.muted) {
        process.stdout.write(stringToWrite);
      } else {
        if (stringToWrite === '\r\n' || stringToWrite === '\n' || stringToWrite === '\r') {
          process.stdout.write(stringToWrite);
        } else {
          process.stdout.write('*');
        }
      }
    };

    const askToken = (): Promise<string> => {
      return new Promise((resolve) => {
        rl.question('Please enter your GitHub Personal Access Token (PAT):\n> ', (answer: string) => {
          resolve(answer.trim());
        });
        rl.muted = true;
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

    // Save token mapped to host 'github.com' and globally (encrypted at rest)
    credentials['github.com'] = {
      token: encryptToken(token),
      login: user.login,
      updatedAt: new Date().toISOString(),
    };
    credentials.github_token = encryptToken(token);

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

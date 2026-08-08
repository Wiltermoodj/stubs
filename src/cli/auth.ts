import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { GitHubClient, encryptToken } from '../server/github';
import { loadCredentials, saveCredentials } from '../storage/credentials';

/**
 * Handles the login workflow interactive or via provided token option.
 * Stores global credentials in ~/.stubs/credentials.json (chmod 600).
 */
/**
 * Helper to read token securely from stdin (supports interactive masking and piped input).
 */
async function askTokenMasked(promptMessage: string): Promise<string> {
  if (!process.stdin.isTTY) {
    // Non-TTY / Piped input: read from stdin directly
    return new Promise((resolve) => {
      let data = '';
      process.stdin.on('data', (chunk) => {
        data += chunk;
      });
      process.stdin.on('end', () => {
        resolve(data.trim());
      });
    });
  }

  // Interactive / TTY: read keypresses, echo '*' or silent, and resolve
  return new Promise((resolve) => {
    process.stdout.write(promptMessage);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let input = '';
    const onData = (char: string) => {
      if (char === '\n' || char === '\r' || char === '\u0003') {
        // Enter or Ctrl+C
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        if (char === '\u0003') {
          process.exit(130);
        }
        resolve(input.trim());
        return;
      }
      if (char === '\u007f' || char === '\b') {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
          // Erase last '*' from screen
          process.stdout.write('\b \b');
        }
      } else {
        input += char;
        process.stdout.write('*');
      }
    };

    stdin.on('data', onData);
  });
}

export async function handleLogin(
  options: { token?: string; nonInteractive?: boolean } = {},
): Promise<number> {
  const credsDir = path.join(os.homedir(), '.stubs');
  const credsPath = path.join(credsDir, 'credentials.json');

  // Environment Variable Priority: if set, use it directly without writing to disk
  const envToken = process.env.STUBS_GITHUB_PAT || process.env.GITHUB_TOKEN;
  if (envToken) {
    console.log('Validating environment token (STUBS_GITHUB_PAT/GITHUB_TOKEN)...');
    try {
      const client = new GitHubClient(envToken);
      const user = await client.validateToken();
      console.log(
        `Successfully authenticated as GitHub user: ${user.login} (${user.name || 'No Name'}) via environment variable.`,
      );
      return 0;
    } catch (error: any) {
      console.error(`Validation of environment token failed: ${error.message || error}`);
      return 1;
    }
  }

  let token = options.token;

  if (token) {
    console.warn(
      'Warning: The --token <pat> command-line argument is deprecated to prevent token leaks in shell history. Please use interactive login or define the STUBS_GITHUB_PAT environment variable instead.',
    );
  }

  if (!token) {
    if (options.nonInteractive) {
      console.error('Error: STDIN pipe or interactive prompt is required for token submission.');
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

    // Read current credentials via secure storage
    let credentials: Record<string, any> = {};
    try {
      credentials = loadCredentials();
    } catch {
      // Ignore and write a new one
    }

    // Save token mapped to host 'github.com' and globally (encrypted at rest)
    credentials['github.com'] = {
      token: encryptToken(token),
      login: user.login,
      updatedAt: new Date().toISOString(),
    };
    credentials.github_token = encryptToken(token);

    saveCredentials(credentials);

    // Overwrite and clear raw token from memory immediately after storage
    if (token) {
      const tokenBuf = Buffer.from(token);
      tokenBuf.fill(0);
    }

    token = '';

    console.log(`Global credentials securely stored in ${credsPath}`);
    return 0;
  } catch (error: any) {
    // Clear token if error occurs too
    if (token) {
      const tokenBuf = Buffer.from(token);
      tokenBuf.fill(0);
    }
    // eslint-disable-next-line no-useless-assignment
    token = '';
    console.error(`Authentication/Validation failed: ${error.message || error}`);
    return 1;
  }
}

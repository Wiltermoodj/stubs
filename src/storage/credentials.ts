import * as crypto from 'crypto';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

const credsDir = path.join(os.homedir(), '.stubs');
const credsPath = path.join(credsDir, 'credentials.json');

/**
 * Generate a machine-unique/user-unique stable key for PBKDF2 key derivation.
 */
export function getMachineUniqueKey(): string {
  let userInfo = 'unknown_user';
  try {
    userInfo = os.userInfo().username || 'unknown_user';
  } catch {
    // Fallback inside Docker/CI
  }
  return `${os.hostname()}-${os.platform()}-${os.arch()}-${userInfo}`;
}

/**
 * Encrypt the given plaintext using PBKDF2 and AES-256-GCM.
 */
export function encrypt(plaintext: string): string {
  const password = getMachineUniqueKey();
  const salt = crypto.randomBytes(16);
  // PBKDF2 with 100,000 iterations to derive a 256-bit key
  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  const iv = crypto.randomBytes(12); // Standard 12-byte IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  const payload = {
    encrypted: true,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    ciphertext,
    tag,
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Decrypt the encrypted payload. Falls back to plaintext if the payload is not encrypted.
 */
export function decrypt(encryptedText: string): string {
  let payload: any;
  try {
    payload = JSON.parse(encryptedText);
  } catch {
    // If it's not valid JSON, it might be plaintext or corrupted.
    return encryptedText;
  }

  if (!payload || !payload.encrypted) {
    return encryptedText;
  }

  const password = getMachineUniqueKey();
  const salt = Buffer.from(payload.salt, 'hex');
  const iv = Buffer.from(payload.iv, 'hex');
  const tag = Buffer.from(payload.tag, 'hex');
  const ciphertext = payload.ciphertext;

  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Loads and decrypts credentials from ~/.stubs/credentials.json.
 * Enforces file permission checks (chmod 0600 equivalent) on load.
 */
export function loadCredentials(): Record<string, any> {
  if (!fs.existsSync(credsPath)) {
    return {};
  }

  // Validate strict permissions on Unix systems: enforce 0600 (no world/group readability)
  if (process.platform !== 'win32') {
    try {
      const stat = fs.statSync(credsPath);
      const isGroupOrWorldReadable = (stat.mode & 0o077) !== 0;
      if (isGroupOrWorldReadable) {
        throw new Error(
          `Security Error: Credentials file ${credsPath} has insecure permissions (world/group readable). Enforce 0600 permissions.`,
        );
      }
    } catch (err: any) {
      if (err.message.includes('Security Error')) {
        throw err;
      }
      // Ignore other file-stat errors
    }
  }

  const raw = fs.readFileSync(credsPath, 'utf8').trim();
  if (!raw) return {};

  try {
    const decrypted = decrypt(raw);
    return JSON.parse(decrypted);
  } catch (err: any) {
    // If it's plaintext JSON (for migration from older versions), return it
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !parsed.encrypted) {
        return parsed;
      }
    } catch {
      // Ignore
    }
    throw new Error(`Failed to load and decrypt credentials: ${err.message}`, { cause: err });
  }
}

/**
 * Encrypts and saves credentials to ~/.stubs/credentials.json, enforcing 0600 permissions.
 */
export function saveCredentials(credentials: Record<string, any>): void {
  if (!fs.existsSync(credsDir)) {
    fs.mkdirSync(credsDir, { recursive: true });
  }

  const plaintext = JSON.stringify(credentials, null, 2);
  const encrypted = encrypt(plaintext);

  fs.writeFileSync(credsPath, encrypted, 'utf8');

  // Enforce chmod 0600 on Unix systems
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(credsPath, 0o600);
    } catch (chmodErr: any) {
      console.warn(
        `Warning: Could not set secure file permissions (600) on credentials file: ${chmodErr.message}`,
      );
    }
  }
}

/**
 * Overwrites memory with zero buffers.
 */
export function clearBuffer(buf: Buffer): void {
  buf.fill(0);
}

/**
 * Detects and masks GitHub-patterned Personal Access Tokens (classic and fine-grained).
 */
export function maskToken(text: string): string {
  if (typeof text !== 'string') return text;
  return text.replace(/(ghp_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,})/g, (match) => {
    const isClassic = match.startsWith('ghp_');
    const prefix = isClassic ? 'ghp_' : 'github_pat_';
    const suffix = match.slice(-4);
    return `${prefix}****${suffix}`;
  });
}

/**
 * Applies global console logging interception to automatically mask tokens in any logs.
 */
let isConsoleMasked = false;
export function applyGlobalConsoleMasking(): void {
  if (isConsoleMasked) return;
  isConsoleMasked = true;

  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  console.log = function (...args: any[]) {
    const sanitized = args.map((arg) => (typeof arg === 'string' ? maskToken(arg) : arg));
    originalLog.apply(console, sanitized);
  };

  console.error = function (...args: any[]) {
    const sanitized = args.map((arg) => (typeof arg === 'string' ? maskToken(arg) : arg));
    originalError.apply(console, sanitized);
  };

  console.warn = function (...args: any[]) {
    const sanitized = args.map((arg) => (typeof arg === 'string' ? maskToken(arg) : arg));
    originalWarn.apply(console, sanitized);
  };
}

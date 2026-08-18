import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { loadConfig } from '../config/schema';
import { loadCredentials } from '../storage/credentials';

function getEncryptionKey(): Buffer {
  let machineId = 'stubs_fallback_machine_key';
  try {
    machineId = os.hostname() + '_' + (os.userInfo().username || '');
  } catch {
    // keep fallback
  }
  return crypto.createHash('sha256').update(machineId).digest();
}

export function encryptToken(text: string): string {
  if (!text) return text;
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${tag}:${encrypted}`;
  } catch {
    return text;
  }
}

export function decryptToken(encryptedData: string): string {
  if (!encryptedData) return encryptedData;
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    return encryptedData;
  }

  const [ivHex, tagHex, encryptedHex] = parts;
  if (ivHex.length !== 24 || tagHex.length !== 32) {
    return encryptedData;
  }

  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return encryptedData;
  }
}

export interface GitHubUser {
  login: string;
  id: number;
  name: string | null;
  email: string | null;
}

export interface RepositoryInfo {
  fullName: string;
  name: string;
  defaultBranch: string;
  permissions?: {
    admin: boolean;
    push: boolean;
    pull: boolean;
  };
}

export interface GitHubTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

/**
 * Resolves a token from environment variables or string pattern containing ${ENV:VAR_NAME}.
 */
function resolveEnvPlaceholders(value: string): string {
  if (typeof value !== 'string') return value;
  const match = value.match(/\${ENV:([^}]+)}/);
  if (match) {
    const envVarName = match[1];
    return process.env[envVarName] || '';
  }
  return value;
}

/**
 * Resolves a GitHub token according to the 3-tier resolution hierarchy:
 * 1. STUBS_GITHUB_PAT or GITHUB_TOKEN env variables.
 * 2. .stubs/config.json settings.
 * 3. ~/.stubs/credentials.json.
 */
export function resolveToken(configPath?: string): string {
  // 1. Env vars
  if (process.env.STUBS_GITHUB_PAT) {
    return process.env.STUBS_GITHUB_PAT;
  }
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }

  // 2. config.json
  try {
    const config = loadConfig(configPath);
    // Explicitly casting config to any because we will add these properties in next steps
    const rawConfig = config as any;
    const configToken = rawConfig.github_token || rawConfig.remote?.github_token;
    if (configToken) {
      const resolved = resolveEnvPlaceholders(configToken);
      if (resolved) {
        return resolved;
      }
    }
  } catch {
    // Ignore and proceed
  }

  // 3. ~/.stubs/credentials.json
  try {
    const creds = loadCredentials();
    const token = creds['github.com']?.token || creds.github_token;
    if (token) {
      return decryptToken(token);
    }
  } catch {
    // Ignore
  }

  return '';
}

export class GitHubClient {
  private token: string;
  private baseUrl: string;

  constructor(token?: string, configPath?: string) {
    this.token = token || resolveToken(configPath);
    this.baseUrl = process.env.GITHUB_API_BASE_URL || 'https://api.github.com';
  }

  private getHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': 'stubs-agent-framework',
      Accept: 'application/vnd.github+json',
      ...customHeaders,
    };
    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }
    return headers;
  }

  /**
   * Validates a GitHub Personal Access Token against GET /user.
   * Throws an auth error if invalid.
   */
  public async validateToken(token?: string): Promise<GitHubUser> {
    const activeToken = token || this.token;
    if (!activeToken) {
      throw new Error('No GitHub Personal Access Token provided or resolved.');
    }

    const response = await fetch(`${this.baseUrl}/user`, {
      method: 'GET',
      headers: {
        'User-Agent': 'stubs-agent-framework',
        Accept: 'application/vnd.github+json',
        Authorization: `token ${activeToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub token validation failed (Status ${response.status}): ${errorText}`);
    }

    const data: any = await response.json();
    return {
      login: data.login,
      id: data.id,
      name: data.name || null,
      email: data.email || null,
    };
  }

  /**
   * Retrieves all accessible repositories.
   */
  public async listAccessibleRepositories(): Promise<RepositoryInfo[]> {
    if (!this.token) {
      throw new Error('No GitHub Personal Access Token resolved for listAccessibleRepositories.');
    }

    const response = await fetch(`${this.baseUrl}/user/repos?per_page=100`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to list repositories (Status ${response.status}): ${errorText}`);
    }

    const repos: any = await response.json();
    const reposList = Array.isArray(repos) ? repos : [];
    return reposList.map((repo: any) => ({
      fullName: repo.full_name,
      name: repo.full_name,
      defaultBranch: repo.default_branch,
      permissions: repo.permissions,
    }));
  }

  /**
   * Fetches recursive git tree of a repository branch.
   */
  public async fetchTree(owner: string, repo: string, branch?: string): Promise<GitHubTreeEntry[]> {
    let targetBranch = branch;
    if (!targetBranch) {
      // Fetch repo default branch dynamically
      const repoRes = await fetch(`${this.baseUrl}/repos/${owner}/${repo}`, {
        method: 'GET',
        headers: this.getHeaders(),
      });
      if (repoRes.ok) {
        const repoData: any = await repoRes.json();
        targetBranch = repoData.default_branch || 'main';
      } else {
        targetBranch = 'main';
      }
    }

    const response = await fetch(
      `${this.baseUrl}/repos/${owner}/${repo}/git/trees/${targetBranch}?recursive=1`,
      {
        method: 'GET',
        headers: this.getHeaders(),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch tree for ${owner}/${repo} (Status ${response.status}): ${errorText}`,
      );
    }

    const data: any = await response.json();
    return data.tree || [];
  }

  /**
   * Lists branches for a repository.
   */
  public async listBranches(owner: string, repo: string): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/repos/${owner}/${repo}/branches?per_page=100`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to list branches for ${owner}/${repo} (Status ${response.status}): ${errorText}`,
      );
    }

    const branches: any = await response.json();
    const branchesList = Array.isArray(branches) ? branches : [];
    return branchesList.map((b: any) => b.name);
  }

  /**
   * Reads raw file contents.
   */
  public async fetchFileContents(
    owner: string,
    repo: string,
    path: string,
    branch?: string,
  ): Promise<string> {
    let url = `${this.baseUrl}/repos/${owner}/${repo}/contents/${path}`;
    if (branch) {
      url += `?ref=${branch}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders({
        Accept: 'application/vnd.github.v3.raw',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch file contents for ${path} (Status ${response.status}): ${errorText}`,
      );
    }

    // Try parsing as text first
    const text = await response.text();
    try {
      // In case GitHub returns JSON structure with base64 (if headers weren't processed correctly or mock responded with JSON)
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && typeof parsed.content === 'string') {
        const encoding = parsed.encoding || 'base64';
        if (encoding === 'base64') {
          return Buffer.from(parsed.content.replace(/\s/g, ''), 'base64').toString('utf8');
        }
      }
    } catch {
      // It was raw text, return it directly
    }

    return text;
  }

  /**
   * Commits updated file directly to a branch.
   */
  public async createOrUpdateFile(
    owner: string,
    repo: string,
    path: string,
    content: string,
    message: string,
    branch: string,
  ): Promise<any> {
    // 1. Get existing file metadata if it exists to retrieve the sha
    let sha: string | undefined;
    try {
      const metaUrl = `${this.baseUrl}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
      const metaRes = await fetch(metaUrl, {
        method: 'GET',
        headers: this.getHeaders(),
      });
      if (metaRes.ok) {
        const metaData: any = await metaRes.json();
        sha = metaData.sha;
      }
    } catch {
      // Assume file is new
    }

    // 2. Put file contents
    const putUrl = `${this.baseUrl}/repos/${owner}/${repo}/contents/${path}`;
    const body: any = {
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch,
    };
    if (sha) {
      body.sha = sha;
    }

    const response = await fetch(putUrl, {
      method: 'PUT',
      headers: this.getHeaders({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to create or update file ${path} (Status ${response.status}): ${errorText}`,
      );
    }

    return await response.json();
  }
}

/**
 * Standalone wrappers matching standard signatures for flexible usage.
 */
export async function validateToken(token: string): Promise<GitHubUser> {
  const client = new GitHubClient(token);
  return await client.validateToken();
}

export async function listAccessibleRepositories(token?: string): Promise<RepositoryInfo[]> {
  const client = new GitHubClient(token);
  return await client.listAccessibleRepositories();
}

export async function fetchTree(
  owner: string,
  repo: string,
  branch?: string,
  token?: string,
): Promise<GitHubTreeEntry[]> {
  const client = new GitHubClient(token);
  return await client.fetchTree(owner, repo, branch);
}

export async function fetchFileContents(
  owner: string,
  repo: string,
  path: string,
  branch?: string,
  token?: string,
): Promise<string> {
  const client = new GitHubClient(token);
  return await client.fetchFileContents(owner, repo, path, branch);
}

export async function listBranches(owner: string, repo: string, token?: string): Promise<string[]> {
  const client = new GitHubClient(token);
  return await client.listBranches(owner, repo);
}

export async function createOrUpdateFile(
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch: string,
  token?: string,
): Promise<any> {
  const client = new GitHubClient(token);
  return await client.createOrUpdateFile(owner, repo, path, content, message, branch);
}

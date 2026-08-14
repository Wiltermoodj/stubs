import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as yaml from 'js-yaml';
import { GraphEngine } from '../graph/engine';

export function extractExports(code: string): string[] {
  const exports: string[] = [];
  const regex = /^\s*export\s+(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([a-zA-Z0-9_$]+)/gm;
  let match;
  while ((match = regex.exec(code)) !== null) {
    if (match[1]) {
      exports.push(match[1]);
    }
  }
  const namedExportsRegex = /^\s*export\s*\{([^}]+)\}/gm;
  while ((match = namedExportsRegex.exec(code)) !== null) {
    const names = match[1].split(',').map(n => {
      const parts = n.trim().split(/\s+as\s+/);
      return parts[parts.length - 1].trim();
    }).filter(Boolean);
    exports.push(...names);
  }
  return Array.from(new Set(exports));
}
import { loadConfig, StubsConfig } from '../config/schema';
import { maskToken } from '../storage/credentials';
import { parseOkfSpec } from '../parser/okf';
import { stringifyOkfSpec } from '../materializer/engine';
import { TemplateEngine } from '../templates/engine';
import {
  GitHubClient,
  listAccessibleRepositories,
  listBranches,
  fetchTree,
  fetchFileContents,
  createOrUpdateFile,
} from './github';

export class PortalServer {
  private port: number;
  private graphEngine: GraphEngine;
  private config: StubsConfig;
  private server: http.Server | null = null;
  private watcher: fs.FSWatcher | null = null;
  private clients: http.ServerResponse[] = [];
  private debounceTimer: NodeJS.Timeout | null = null;

  // Cache remote GraphEngine instances keyed by "repo#branch"
  private remoteGraphs: Map<string, GraphEngine> = new Map();
  // Store dynamic templates in remote mode
  private remoteTemplates: Map<
    string,
    { name: string; content: string; isDraft: boolean; version: string }[]
  > = new Map();

  private currentRepo: string = '';
  private currentBranch: string = '';

  constructor(graphEngine: GraphEngine, port = 3000, configPath?: string) {
    this.graphEngine = graphEngine;
    this.port = port;
    this.config = loadConfig(configPath);
  }

  /**
   * Starts the background HTTP server and the filesystem watcher.
   */
  public async start(): Promise<void> {
    await this.graphEngine.initialize();

    // Auto-index workspace on startup
    try {
      await this.graphEngine.indexWorkspace(this.config.paths.specs_dir);
    } catch (err: any) {
      console.error(`[PortalServer] Initial workspace indexing failed: ${err.message || err}`);
    }

    // Setup some default templates for interactive Template Workbench demo if empty
    try {
      const templatesDir = path.resolve(this.config.paths.templates_dir);
      if (!fs.existsSync(templatesDir)) {
        fs.mkdirSync(templatesDir, { recursive: true });
      }
      const files = fs.readdirSync(templatesDir);

      // Ensure we have at least one provisional draft template for the workbench
      const hasProvisional = files.some((f) => f.toLowerCase().includes('provisional'));
      if (!hasProvisional) {
        fs.writeFileSync(
          path.join(templatesDir, 'controller-v1.0-provisional.ts.md.tpl'),
          `# Controller Mold (Draft Proposal)
Provisional template for human review.
- Project: {{project_name}}
- Version: v1.0-provisional
`,
          'utf8',
        );
      }

      // Also populate standard service template if empty
      if (!files.includes('service.ts.md.tpl')) {
        fs.writeFileSync(
          path.join(templatesDir, 'service.ts.md.tpl'),
          `# Service Mold (Active)
Using EJS/Handlebars to render a standard service module.
- Project: {{project_name}}
- Version: {{version}}
`,
          'utf8',
        );
      }
    } catch (err: any) {
      console.error(`[PortalServer] Default template setup failed: ${err.message || err}`);
    }

    this.server = http.createServer((req, res) => {
      const originalWrite = res.write;
      const originalEnd = res.end;

      res.write = function (chunk: any, encoding?: any, callback?: any): boolean {
        if (typeof chunk === 'string') {
          chunk = maskToken(chunk);
        } else if (Buffer.isBuffer(chunk)) {
          const str = chunk.toString('utf8');
          if (str.includes('ghp_') || str.includes('github_pat_')) {
            chunk = Buffer.from(maskToken(str), 'utf8');
          }
        }
        return originalWrite.call(res, chunk, encoding, callback);
      } as any;

      res.end = function (chunk?: any, encoding?: any, callback?: any): any {
        if (typeof chunk === 'string') {
          chunk = maskToken(chunk);
        } else if (Buffer.isBuffer(chunk)) {
          const str = chunk.toString('utf8');
          if (str.includes('ghp_') || str.includes('github_pat_')) {
            chunk = Buffer.from(maskToken(str), 'utf8');
          }
        }
        return originalEnd.call(res, chunk, encoding, callback);
      } as any;

      this.handleRequest(req, res);
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(this.port, () => {
        console.log(`[PortalServer] stubs serve mode active on http://localhost:${this.port}`);
        this.startFileWatcher();
        resolve();
      });

      this.server!.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Stops the background HTTP server and filesystem watcher.
   */
  public async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    // Close all SSE client connections
    for (const client of this.clients) {
      client.end();
    }
    this.clients = [];

    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          this.server = null;
          console.log('[PortalServer] Server stopped.');
          resolve();
        });
      });
    }
  }

  /**
   * Helper to parse JSON request bodies
   */
  private async parseJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          if (!body) {
            resolve({});
            return;
          }
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', (err) => reject(err));
    });
  }

  /**
   * Resolves appropriate GraphEngine based on parameters
   */
  private async resolveGraphEngine(
    parsedUrl: URL,
  ): Promise<{ engine: GraphEngine; isRemote: boolean; repo: string; branch: string }> {
    const mode = parsedUrl.searchParams.get('mode') || (this.config.remote ? 'remote' : 'local');
    if (mode === 'remote') {
      const repo = parsedUrl.searchParams.get('repo') || this.config.remote?.repo || '';
      const branch =
        parsedUrl.searchParams.get('branch') || this.config.remote?.default_branch || 'main';
      if (!repo) {
        return { engine: this.graphEngine, isRemote: false, repo: '', branch: '' };
      }

      if (repo !== this.currentRepo || branch !== this.currentBranch) {
        this.currentRepo = repo;
        this.currentBranch = branch;
        this.broadcast('branch:changed', { repo, branch, timestamp: new Date().toISOString() });
      }

      const key = `${repo}#${branch}`;
      if (this.remoteGraphs.has(key)) {
        return { engine: this.remoteGraphs.get(key)!, isRemote: true, repo, branch };
      }
      // Create and initialize new in-memory SQLite database
      const engine = new GraphEngine(':memory:');
      await engine.initialize();
      this.remoteGraphs.set(key, engine);

      // Fetch and ingest remote specs
      await this.ingestRemoteSpecs(engine, repo, branch);

      return { engine, isRemote: true, repo, branch };
    }
    return { engine: this.graphEngine, isRemote: false, repo: '', branch: '' };
  }

  private async ingestRemoteSpecs(
    engine: GraphEngine,
    repo: string,
    branch: string,
  ): Promise<void> {
    const [owner, name] = repo.split('/');
    if (!owner || !name) return;

    try {
      const client = new GitHubClient();
      const tree = await client.fetchTree(owner, name, branch);

      // Filter specs ending in .ts.md or .md and having Frontmatter
      const specFiles = tree.filter(
        (entry) =>
          entry.type === 'blob' && (entry.path.endsWith('.ts.md') || entry.path.endsWith('.md')),
      );

      for (const spec of specFiles) {
        try {
          const content = await client.fetchFileContents(owner, name, spec.path, branch);
          if (content.trim().startsWith('---')) {
            const parsed = parseOkfSpec(content);
            if (parsed.isValid && parsed.frontmatter) {
              const fileHash = crypto.createHash('sha256').update(content).digest('hex');
              await engine.upsertSidecar({
                filePath: spec.path,
                frontmatter: parsed.frontmatter,
                body: parsed.body,
                fileHash,
              });
            }
          }
        } catch (e: any) {
          console.error(`[PortalServer] Error loading remote file ${spec.path}:`, e.message || e);
        }
      }

      // Also ingest remote templates for listTemplates
      const templates: { name: string; content: string; isDraft: boolean; version: string }[] = [];
      const templateDir = this.config.paths.templates_dir || '.stubs/templates';
      const templateFiles = tree.filter(
        (entry) =>
          entry.type === 'blob' &&
          entry.path.startsWith(templateDir) &&
          entry.path.endsWith('.tpl'),
      );

      for (const tpl of templateFiles) {
        try {
          const content = await client.fetchFileContents(owner, name, tpl.path, branch);
          const baseName = path.basename(tpl.path);
          const isDraft =
            baseName.toLowerCase().includes('provisional') ||
            baseName.toLowerCase().includes('draft');
          const version = isDraft ? 'v1.0-provisional' : 'v1.0';
          templates.push({
            name: baseName,
            content,
            isDraft,
            version,
          });
        } catch (e: any) {
          console.error(
            `[PortalServer] Error loading remote template ${tpl.path}:`,
            e.message || e,
          );
        }
      }
      this.remoteTemplates.set(`${repo}#${branch}`, templates);

      // Broadcast SSE for github:sync
      this.broadcast('github:sync', { repo, branch, timestamp: new Date().toISOString() });
    } catch (err: any) {
      console.error(
        `[PortalServer] Failed to ingest remote specs/templates for ${repo}#${branch}:`,
        err.message || err,
      );
    }
  }

  /**
   * Handle incoming HTTP requests.
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // 0. GitHub API endpoints
      if (
        (pathname === '/api/v1/repos' || pathname === '/api/v1/github/repos') &&
        req.method === 'GET'
      ) {
        const repoParam = parsedUrl.searchParams.get('repo');
        if (repoParam) {
          const [owner, repoName] = repoParam.split('/');
          if (!owner || !repoName) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid "repo" format, expected owner/repo' }));
            return;
          }
          try {
            const branches = await listBranches(owner, repoName);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ branches }));
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message || err }));
          }
          return;
        }

        try {
          const repos = await listAccessibleRepositories();

          // Let's flag repositories containing `.stubs/` or `*.ts.md` sidecar specifications
          const enrichedRepos = await Promise.all(
            repos.map(async (repo) => {
              let hasStubs = false;
              try {
                const [owner, name] = repo.fullName.split('/');
                const tree = await fetchTree(owner, name, repo.defaultBranch);
                hasStubs = tree.some(
                  (item) =>
                    item.path.startsWith('.stubs/') ||
                    item.path.endsWith('.ts.md') ||
                    item.path.endsWith('.ts.md.tpl'),
                );
              } catch {
                // Ignore errors
              }
              return { ...repo, hasStubs };
            }),
          );

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ repositories: enrichedRepos }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || err }));
        }
        return;
      }

      if (
        (pathname === '/api/v1/branches' || pathname === '/api/v1/github/branches') &&
        req.method === 'GET'
      ) {
        const repoParam = parsedUrl.searchParams.get('repo');
        if (!repoParam) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing "repo" parameter' }));
          return;
        }
        const [owner, repoName] = repoParam.split('/');
        if (!owner || !repoName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid "repo" format, expected owner/repo' }));
          return;
        }
        try {
          const branches = await listBranches(owner, repoName);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ branches }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || err }));
        }
        return;
      }

      // 1. Dashboard UI Root - PWA primary
      if (pathname === '/' && req.method === 'GET') {
        const pwaIndex = path.resolve(__dirname, '../../dist/web/index.html');
        if (fs.existsSync(pwaIndex)) {
          const html = fs.readFileSync(pwaIndex, 'utf8');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
          return;
        }

        const missing = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Stubs PWA not built</title>
</head>
<body>
  <p>The PWA build is missing. Run <code>npm run build:web</code> and restart.</p>
</body>
</html>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(missing);
        return;
      }

      // 1c. Legacy dashboard fallback
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this.getDashboardHtml());
      return;

      // 1b. PWA static assets
      const pwaRoot = path.resolve(__dirname, '../../dist/web');
      const pwaAssetPaths = new Set([
        '/app.js',
        '/app.js.map',
        '/sql-wasm.wasm',
        '/sql-wasm-browser.wasm',
        '/manifest.json',
        '/sw.js',
      ]);
      if (pwaAssetPaths.has(pathname) && req.method === 'GET') {
        const safeRelative = pathname.startsWith('/') ? pathname.slice(1) : pathname;
        const filePath = path.join(pwaRoot, safeRelative);
        if (fs.existsSync(filePath)) {
          const ext = path.extname(filePath);
          const mimeMap: Record<string, string> = {
            '.js': 'application/javascript',
            '.map': 'application/json',
            '.wasm': 'application/wasm',
            '.json': 'application/json',
          };
          res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream' });
          fs.createReadStream(filePath).pipe(res);
          return;
        }
      }

      // 2. SSE Event Stream (with v1 alias support)
      if ((pathname === '/api/events' || pathname === '/api/v1/events') && req.method === 'GET') {
        this.registerSseClient(req, res);
        return;
      }

      // 3. API endpoints
      if ((pathname === '/api/graph' || pathname === '/api/v1/graph') && req.method === 'GET') {
        const { engine, isRemote, repo } = await this.resolveGraphEngine(parsedUrl);
        const files = await engine.getFilesIndexed();
        const sidecars = [];
        for (const file of files) {
          const sidecar = await engine.getSidecar(file);
          if (sidecar) {
            sidecars.push(sidecar);
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ sidecars, projectName: isRemote ? repo : this.config.project_name }),
        );
        return;
      }

      // GET directives with optional status filter support
      if (
        (pathname === '/api/directives' || pathname === '/api/v1/directives') &&
        req.method === 'GET'
      ) {
        const { engine } = await this.resolveGraphEngine(parsedUrl);
        const filterStatus = parsedUrl.searchParams.get('status') || 'pending';
        let query =
          'SELECT file_path as filePath, note_id as id, timestamp, text, status FROM user_notes';
        const params: any[] = [];
        if (filterStatus !== 'all') {
          query += ' WHERE status = ?';
          params.push(filterStatus);
        }
        query += ' ORDER BY timestamp DESC;';

        const rows = await engine.all(query, params);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ directives: rows }));
        return;
      }

      // POST directives: add a new pending note to the sidecar file's frontmatter
      if (pathname === '/api/v1/directives' && req.method === 'POST') {
        const { engine, isRemote, repo, branch } = await this.resolveGraphEngine(parsedUrl);
        const body = await this.parseJsonBody(req);
        const { filePath, text, id } = body;

        if (!filePath || !text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing "filePath" or "text" parameter in body' }));
          return;
        }

        let content = '';
        let resolvedPath = '';
        if (isRemote) {
          const [owner, repoName] = repo.split('/');
          content = await fetchFileContents(owner, repoName, filePath, branch);
        } else {
          resolvedPath = path.isAbsolute(filePath)
            ? filePath
            : path.resolve(process.cwd(), filePath);

          if (!fs.existsSync(resolvedPath)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `File not found at ${resolvedPath}` }));
            return;
          }
          content = await fs.promises.readFile(resolvedPath, 'utf8');
        }

        const parsed = parseOkfSpec(content);
        if (!parsed.isValid || !parsed.frontmatter) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: 'Invalid sidecar OKF specification frontmatter',
              details: parsed.errors,
            }),
          );
          return;
        }

        const noteId = id || `NOTE-${Date.now()}`;
        const newNote = {
          id: noteId,
          timestamp: new Date().toISOString(),
          text,
          status: 'pending',
        };

        const notes = parsed.frontmatter.user_notes || [];
        notes.push(newNote);
        parsed.frontmatter.user_notes = notes;

        const newContent = stringifyOkfSpec(parsed.frontmatter, parsed.body);
        const fileHash = crypto.createHash('sha256').update(newContent).digest('hex');

        if (isRemote) {
          const [owner, repoName] = repo.split('/');
          await createOrUpdateFile(
            owner,
            repoName,
            filePath,
            newContent,
            `Add user note ${noteId}`,
            branch,
          );
          await engine.upsertSidecar({
            filePath,
            frontmatter: parsed.frontmatter,
            body: parsed.body,
            fileHash,
          });
        } else {
          await fs.promises.writeFile(resolvedPath, newContent, 'utf8');
          const relativePath = path.relative(process.cwd(), resolvedPath).replace(/\\/g, '/');
          await engine.upsertSidecar({
            filePath: relativePath,
            frontmatter: parsed.frontmatter,
            body: parsed.body,
            fileHash,
          });
        }

        // Broadcast SSE
        this.broadcast('directive:created', {
          filePath: isRemote
            ? filePath
            : path.relative(process.cwd(), resolvedPath).replace(/\\/g, '/'),
          note: newNote,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, note: newNote }));
        return;
      }

      // POST directives/resolve: resolve an existing pending note inside the sidecar
      if (pathname === '/api/v1/directives/resolve' && req.method === 'POST') {
        const { engine, isRemote, repo, branch } = await this.resolveGraphEngine(parsedUrl);
        const body = await this.parseJsonBody(req);
        const { filePath, id } = body;

        if (!filePath || !id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing "filePath" or "id" parameter in body' }));
          return;
        }

        let content = '';
        let resolvedPath = '';
        if (isRemote) {
          const [owner, repoName] = repo.split('/');
          content = await fetchFileContents(owner, repoName, filePath, branch);
        } else {
          resolvedPath = path.isAbsolute(filePath)
            ? filePath
            : path.resolve(process.cwd(), filePath);

          if (!fs.existsSync(resolvedPath)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `File not found at ${resolvedPath}` }));
            return;
          }
          content = await fs.promises.readFile(resolvedPath, 'utf8');
        }

        const parsed = parseOkfSpec(content);
        if (!parsed.isValid || !parsed.frontmatter) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid sidecar OKF specification frontmatter' }));
          return;
        }

        const notes = parsed.frontmatter.user_notes || [];
        const note = notes.find((n) => n.id === id);
        if (!note) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Directive ${id} not found in file` }));
          return;
        }

        note.status = 'resolved';

        const newContent = stringifyOkfSpec(parsed.frontmatter, parsed.body);
        const fileHash = crypto.createHash('sha256').update(newContent).digest('hex');

        if (isRemote) {
          const [owner, repoName] = repo.split('/');
          await createOrUpdateFile(
            owner,
            repoName,
            filePath,
            newContent,
            `Resolve note ${id}`,
            branch,
          );
          await engine.upsertSidecar({
            filePath,
            frontmatter: parsed.frontmatter,
            body: parsed.body,
            fileHash,
          });
        } else {
          await fs.promises.writeFile(resolvedPath, newContent, 'utf8');
          const relativePath = path.relative(process.cwd(), resolvedPath).replace(/\\/g, '/');
          await engine.upsertSidecar({
            filePath: relativePath,
            frontmatter: parsed.frontmatter,
            body: parsed.body,
            fileHash,
          });
        }

        this.broadcast('graph:updated', { timestamp: new Date().toISOString() });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, note }));
        return;
      }

      // GET templates: list registered templates and pending drafts
      if (
        (pathname === '/api/templates' || pathname === '/api/v1/templates') &&
        req.method === 'GET'
      ) {
        const { isRemote, repo, branch } = await this.resolveGraphEngine(parsedUrl);
        if (isRemote) {
          const cached = this.remoteTemplates.get(`${repo}#${branch}`) || [];
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ templates: cached }));
          return;
        }

        const templateEngine = new TemplateEngine(this.config.paths.templates_dir);
        const templatesList = await templateEngine.listTemplates();
        const resultTemplates = [];

        for (const name of templatesList) {
          const isDraft =
            name.toLowerCase().includes('provisional') || name.toLowerCase().includes('draft');
          const version = isDraft ? 'v1.0-provisional' : 'v1.0';
          const templatePath = templateEngine.getTemplatePath(name);
          let content = '';
          try {
            content = await fs.promises.readFile(templatePath, 'utf8');
          } catch {
            // Silently ignore if file reading fails
          }
          resultTemplates.push({ name, isDraft, version, content });
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ templates: resultTemplates }));
        return;
      }

      // POST templates/approve: inline approval/rejection forms of pending drafts
      if (pathname === '/api/v1/templates/approve' && req.method === 'POST') {
        const { isRemote, repo, branch } = await this.resolveGraphEngine(parsedUrl);
        const body = await this.parseJsonBody(req);
        const { templateName, approved } = body;

        if (!templateName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing "templateName" parameter in body' }));
          return;
        }

        if (isRemote) {
          const [owner, repoName] = repo.split('/');
          const templateDir = this.config.paths.templates_dir || '.stubs/templates';
          const oldPath = `${templateDir}/${templateName}`;

          const key = `${repo}#${branch}`;
          const cached = this.remoteTemplates.get(key) || [];
          const tplObj = cached.find((t) => t.name === templateName);
          if (!tplObj) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Template not found: ${templateName}` }));
            return;
          }

          if (approved) {
            let newName = templateName;
            if (templateName.includes('-v1.0-provisional')) {
              newName = templateName.replace('-v1.0-provisional', '');
            } else if (templateName.includes('-provisional')) {
              newName = templateName.replace('-provisional', '');
            } else {
              newName = templateName.replace('.tpl', '-approved.tpl');
            }
            const newPath = `${templateDir}/${newName}`;

            // Create new template at new path with the same content
            await createOrUpdateFile(
              owner,
              repoName,
              newPath,
              tplObj.content,
              `Approve template ${templateName}`,
              branch,
            );

            // Delete old provisional draft (by committing empty or mock delete via createOrUpdateFile/GitHub APIs as needed,
            // or simply updating the file contents of the template to be active - in typical GitHub we commit the file name change).
            // For simplicty & robustness on standard GitHub API contents PUT, writing the approved and leaving provisional is fine or deleting it.
            // Let's delete it if possible, or commit with deletion if GitHub API supports. In GitHub REST API we can delete a file using DELETE /repos/{owner}/{repo}/contents/{path}.
            // Let's trigger a DELETE or just create approved and remove provisional from cache.
            try {
              const client = new GitHubClient();
              const metaUrl = `${client['baseUrl']}/repos/${owner}/${repoName}/contents/${oldPath}?ref=${branch}`;
              const metaRes = await fetch(metaUrl, {
                method: 'GET',
                headers: client['getHeaders'](),
              });
              if (metaRes.ok) {
                const metaData: any = await metaRes.json();
                const delUrl = `${client['baseUrl']}/repos/${owner}/${repoName}/contents/${oldPath}`;
                await fetch(delUrl, {
                  method: 'DELETE',
                  headers: client['getHeaders']({ 'Content-Type': 'application/json' }),
                  body: JSON.stringify({
                    message: `Delete provisional draft ${templateName}`,
                    sha: metaData.sha,
                    branch,
                  }),
                });
              }
            } catch (err: any) {
              console.error(
                `[PortalServer] Optional remote file delete failed:`,
                err.message || err,
              );
            }

            // Update cache
            tplObj.name = newName;
            tplObj.isDraft = false;
            tplObj.version = 'v1.0';

            this.broadcast('graph:updated', { type: 'template_approved', templateName, newName });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                success: true,
                message: `Template approved and renamed to ${newName} on remote repository.`,
              }),
            );
          } else {
            // Delete provisional draft
            try {
              const client = new GitHubClient();
              const metaUrl = `${client['baseUrl']}/repos/${owner}/${repoName}/contents/${oldPath}?ref=${branch}`;
              const metaRes = await fetch(metaUrl, {
                method: 'GET',
                headers: client['getHeaders'](),
              });
              if (metaRes.ok) {
                const metaData: any = await metaRes.json();
                const delUrl = `${client['baseUrl']}/repos/${owner}/${repoName}/contents/${oldPath}`;
                await fetch(delUrl, {
                  method: 'DELETE',
                  headers: client['getHeaders']({ 'Content-Type': 'application/json' }),
                  body: JSON.stringify({
                    message: `Reject draft template ${templateName}`,
                    sha: metaData.sha,
                    branch,
                  }),
                });
              }
            } catch (err: any) {
              console.error(
                `[PortalServer] Optional remote file delete failed:`,
                err.message || err,
              );
            }

            // Update cache
            this.remoteTemplates.set(
              key,
              cached.filter((t) => t.name !== templateName),
            );

            this.broadcast('graph:updated', { type: 'template_rejected', templateName });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                success: true,
                message: 'Template draft rejected and deleted from remote repository.',
              }),
            );
          }
          return;
        }

        const templatesDir = path.resolve(this.config.paths.templates_dir);
        const templatePath = path.resolve(templatesDir, templateName);

        if (!fs.existsSync(templatePath)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Template file not found at ${templatePath}` }));
          return;
        }

        if (approved) {
          // Rename provisional draft template to active template
          let newName = templateName;
          if (templateName.includes('-v1.0-provisional')) {
            newName = templateName.replace('-v1.0-provisional', '');
          } else if (templateName.includes('-provisional')) {
            newName = templateName.replace('-provisional', '');
          } else {
            newName = templateName.replace('.tpl', '-approved.tpl');
          }
          const newPath = path.resolve(templatesDir, newName);
          await fs.promises.rename(templatePath, newPath);

          this.broadcast('graph:updated', { type: 'template_approved', templateName, newName });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              message: `Template approved and renamed to ${newName}`,
            }),
          );
        } else {
          // Reject draft -> delete provisional file
          await fs.promises.unlink(templatePath);

          this.broadcast('graph:updated', { type: 'template_rejected', templateName });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ success: true, message: 'Template draft rejected and deleted' }),
          );
        }
        return;
      }

      if (pathname === '/api/search' && req.method === 'GET') {
        const { engine } = await this.resolveGraphEngine(parsedUrl);
        const q = parsedUrl.searchParams.get('q') || '';
        const tagsParam = parsedUrl.searchParams.get('tags');
        const tags = tagsParam ? tagsParam.split(',').filter(Boolean) : undefined;
        const boundsParam = parsedUrl.searchParams.get('bounds');
        const bounds = boundsParam ? boundsParam.split(',').filter(Boolean) : undefined;

        const results = await engine.search(q, { tags, bounds });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results }));
        return;
      }

      if (pathname === '/api/sidecar' && req.method === 'GET') {
        const { engine } = await this.resolveGraphEngine(parsedUrl);
        const filePath = parsedUrl.searchParams.get('path');
        if (!filePath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing path parameter' }));
          return;
        }

        const sidecar = await engine.getSidecar(filePath);
        if (!sidecar) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Sidecar specification not found' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sidecar }));
        return;
      }

      // GET /api/v1/bootstrap/scan
      if (pathname === '/api/v1/bootstrap/scan' && req.method === 'GET') {
        const { isRemote, repo, branch } = await this.resolveGraphEngine(parsedUrl);
        let unbootstrapped: string[] = [];

        if (isRemote) {
          const [owner, name] = repo.split('/');
          const client = new GitHubClient();
          const tree = await client.fetchTree(owner, name, branch);

          const tsFiles = tree.filter(entry =>
            entry.type === 'blob' &&
            entry.path.endsWith('.ts') &&
            !entry.path.endsWith('.d.ts') &&
            !entry.path.startsWith('node_modules/') &&
            !entry.path.startsWith('.git/') &&
            !entry.path.startsWith('.stubs/') &&
            !entry.path.startsWith('dist/') &&
            !entry.path.startsWith('build/')
          ).map(e => e.path);

          const mdFiles = new Set(
            tree.filter(entry => entry.type === 'blob' && entry.path.endsWith('.ts.md')).map(e => e.path)
          );

          unbootstrapped = tsFiles.filter(tsFile => !mdFiles.has(`${tsFile}.md`));
        } else {
          const result = await this.scanLocalWorkspace();
          unbootstrapped = result.unbootstrapped;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ files: unbootstrapped }));
        return;
      }

      // POST /api/v1/bootstrap/preview
      if (pathname === '/api/v1/bootstrap/preview' && req.method === 'POST') {
        const { isRemote, repo, branch } = await this.resolveGraphEngine(parsedUrl);
        const body = await this.parseJsonBody(req);
        const { filePath, templateName } = body;

        if (!filePath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing filePath in request body' }));
          return;
        }

        let code = '';
        if (isRemote) {
          const [owner, name] = repo.split('/');
          const client = new GitHubClient();
          code = await client.fetchFileContents(owner, name, filePath, branch);
        } else {
          const fullPath = path.resolve(process.cwd(), filePath);
          if (fs.existsSync(fullPath)) {
            code = await fs.promises.readFile(fullPath, 'utf8');
          }
        }

        // Extract public exports
        const exportsList = extractExports(code);

        // Fetch template content
        let templateContent = '';
        if (templateName) {
          if (isRemote) {
            // Find in remoteTemplates cache
            const cached = this.remoteTemplates.get(`${repo}#${branch}`) || [];
            const tpl = cached.find(t => t.name === templateName);
            if (tpl) {
              templateContent = tpl.content;
            }
          }
          if (!templateContent) {
            const templateEngine = new TemplateEngine(this.config.paths.templates_dir);
            const templatePath = templateEngine.getTemplatePath(templateName);
            if (fs.existsSync(templatePath)) {
              templateContent = await fs.promises.readFile(templatePath, 'utf8');
            }
          }
        }

        if (!templateContent) {
          templateContent = `# {{title}} Specification

Generated skeleton specification for {{title}}.

- Target Code File: {{target_code_file}}
- Status: skeleton
- Version: 1

## Module Overview
Provides lightweight, secure interfaces.

## Interfaces
No custom interfaces specified yet.
`;
        }

        const filename = path.basename(filePath);
        const title = filename.replace(/\.ts$/, '').split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

        const templateData = {
          project_name: this.config.project_name || 'stubs',
          version: '1.0.0',
          title: title,
          target_code_file: `./${filename}`,
          exports: exportsList
        };

        const templateEngine = new TemplateEngine(this.config.paths.templates_dir);
        const rendered = templateEngine.renderString(templateContent, templateData);

        const fm = {
          title: `${title} Spec`,
          type: 'sidecar-spec',
          description: `Generated skeleton specification for ${title}.`,
          tags: [],
          status: 'skeleton',
          version: 1,
          target_code_file: `./${filename}`,
          status_flag: 'clean',
          exports: exportsList
        };

        const yamlHeader = `---\n${yaml.dump(fm)}---\n`;
        const fullContent = yamlHeader + '\n' + rendered;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content: fullContent }));
        return;
      }

      // POST /api/v1/bootstrap/commit
      if (pathname === '/api/v1/bootstrap/commit' && req.method === 'POST') {
        const { engine, isRemote, repo, branch } = await this.resolveGraphEngine(parsedUrl);
        const body = await this.parseJsonBody(req);
        const { files } = body; // Array of { filePath: string, content: string }

        if (!files || !Array.isArray(files)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing or invalid files array in request body' }));
          return;
        }

        for (const fileItem of files) {
          const { filePath, content } = fileItem;
          const mdPath = `${filePath}.md`;

          if (isRemote) {
            const [owner, name] = repo.split('/');
            const client = new GitHubClient();
            await client.createOrUpdateFile(
              owner,
              name,
              mdPath,
              content,
              `Bootstrap sidecar ${mdPath}`,
              branch,
            );

            // Also upsert in-memory SQL for immediate UI updates
            const parsed = parseOkfSpec(content);
            if (parsed.isValid && parsed.frontmatter) {
              const fileHash = crypto.createHash('sha256').update(content).digest('hex');
              await engine.upsertSidecar({
                filePath: mdPath,
                frontmatter: parsed.frontmatter,
                body: parsed.body,
                fileHash,
              });
            }
          } else {
            const fullPath = path.resolve(process.cwd(), mdPath);
            await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.promises.writeFile(fullPath, content, 'utf8');

            // Index inside graphEngine
            const parsed = parseOkfSpec(content);
            if (parsed.isValid && parsed.frontmatter) {
              const fileHash = crypto.createHash('sha256').update(content).digest('hex');
              await this.graphEngine.upsertSidecar({
                filePath: mdPath,
                frontmatter: parsed.frontmatter,
                body: parsed.body,
                fileHash,
              });
            }
          }
        }

        // Reindex local workspace to keep everything fully aligned
        if (!isRemote) {
          await this.graphEngine.indexWorkspace(this.config.paths.specs_dir);
        }

        // Broadcast sync & update events
        this.broadcast('github:sync', { repo, branch, timestamp: new Date().toISOString() });
        this.broadcast('graph:updated', { timestamp: new Date().toISOString() });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // 404 fallback
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err: any) {
      console.error(`[PortalServer] Error handling request ${req.url}:`, err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error', details: err.message || err }));
    }
  }

  /**
   * Registers a client connection for Server-Sent Events (SSE).
   */
  private registerSseClient(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // Write initial connected payload
    res.write(
      `data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`,
    );

    this.clients.push(res);

    req.on('close', () => {
      this.clients = this.clients.filter((client) => client !== res);
    });
  }

  /**
   * Broadcasts data to all registered SSE clients.
   */
  private broadcast(event: string, data: any): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch (err) {
        console.error('[PortalServer] Failed to write to SSE client:', err);
      }
    }
  }

  /**
   * Starts watching filesystem changes under specs_dir.
   */
  private startFileWatcher(): void {
    const specsDir = path.resolve(this.config.paths.specs_dir);
    if (!fs.existsSync(specsDir)) {
      console.warn(`[Watcher] Warning: Watch directory "${specsDir}" does not exist.`);
      return;
    }

    console.log(`[Watcher] Starting OS-level filesystem watcher on "${specsDir}"...`);

    try {
      this.watcher = fs.watch(specsDir, { recursive: true }, (eventType, filename) => {
        if (filename && (filename.endsWith('.ts.md') || filename.endsWith('.md'))) {
          this.reindexAndBroadcast();
        }
      });
    } catch (err: any) {
      // Fallback for non-recursive environments
      console.warn(
        `[Watcher] Recursive watch failed: ${err.message || err}. Falling back to standard watch.`,
      );
      try {
        this.watcher = fs.watch(specsDir, (eventType, filename) => {
          if (filename && (filename.endsWith('.ts.md') || filename.endsWith('.md'))) {
            this.reindexAndBroadcast();
          }
        });
      } catch (innerErr: any) {
        console.error(`[Watcher] Failed to initialize watcher: ${innerErr.message || innerErr}`);
      }
    }
  }

  /**
   * Debounces indexing execution and streams updates to clients.
   */
  private reindexAndBroadcast(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      try {
        const specsDir = this.config.paths.specs_dir;
        console.log(`[Watcher] File modification detected. Re-indexing workspace: "${specsDir}"`);

        await this.graphEngine.indexWorkspace(specsDir);

        const files = await this.graphEngine.getFilesIndexed();
        const sidecars = [];
        for (const file of files) {
          const sidecar = await this.graphEngine.getSidecar(file);
          if (sidecar) {
            sidecars.push(sidecar);
          }
        }
        const directives = await this.graphEngine.getPendingDirectives();

        // Broadcast standard update event
        this.broadcast('update', {
          sidecars,
          directives,
          timestamp: new Date().toISOString(),
        });

        // Broadcast specific events: 'file:changed', 'graph:updated', 'drift:detected'
        this.broadcast('file:changed', { timestamp: new Date().toISOString() });
        this.broadcast('graph:updated', { timestamp: new Date().toISOString() });
        this.broadcast('drift:detected', { timestamp: new Date().toISOString() });
      } catch (err: any) {
        console.error('[Watcher] Re-indexing failed:', err.message || err);
      }
    }, 150);
  }

  private async scanLocalWorkspace(): Promise<{ unbootstrapped: string[] }> {
    const tsFiles: string[] = [];
    const mdFiles: Set<string> = new Set();

    const recurse = async (currentDir: string) => {
      if (!fs.existsSync(currentDir)) return;
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relativePath = path.relative(process.cwd(), fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          if (
            entry.name === 'node_modules' ||
            entry.name === '.git' ||
            entry.name === '.stubs' ||
            entry.name === 'dist' ||
            entry.name === 'build'
          ) {
            continue;
          }
          await recurse(fullPath);
        } else if (entry.isFile()) {
          if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
            tsFiles.push(relativePath);
          } else if (entry.name.endsWith('.ts.md')) {
            mdFiles.add(relativePath);
          }
        }
      }
    };

    await recurse(process.cwd());

    const unbootstrapped = tsFiles.filter(tsFile => {
      const expectedMd = `${tsFile}.md`;
      return !mdFiles.has(expectedMd);
    });

    return { unbootstrapped };
  }

  /**
   * HTML Content for the stubs web dashboard portal.
   */
  private getDashboardHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>stubs Web Portal</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    /* Spacing scale rules & modular type sizes in accordance with GUIDELINES.md */
    body {
      background-color: oklch(0.15 0.02 240); /* Theme: dark neutral foundations */
      color: oklch(0.85 0.02 240);
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
    }
    .custom-scroll::-webkit-scrollbar {
      width: 6px;
    }
    .custom-scroll::-webkit-scrollbar-track {
      background: oklch(0.18 0.02 240);
    }
    .custom-scroll::-webkit-scrollbar-thumb {
      background: oklch(0.3 0.02 240);
      border-radius: 4px;
    }
    /* Dynamic feedback colors via OKLCH */
    .connection-live {
      background-color: oklch(0.627 0.265 150 / 0.15);
      border-color: oklch(0.627 0.265 150 / 0.3);
      color: oklch(0.627 0.265 150);
    }
    .connection-dead {
      background-color: oklch(0.627 0.265 20 / 0.15);
      border-color: oklch(0.627 0.265 20 / 0.3);
      color: oklch(0.627 0.265 20);
    }
    /* Toast slide transition with cubic-bezier */
    .toast-enter {
      animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    @keyframes slideIn {
      from { transform: translateY(100%) scale(0.9); opacity: 0; }
      to { transform: translateY(0) scale(1); opacity: 1; }
    }
  </style>
</head>
<body class="min-h-screen flex flex-col antialiased">

  <!-- Header Bar -->
  <header class="border-b border-slate-800 bg-slate-900/40 backdrop-blur px-6 py-4 flex items-center justify-between shadow-sm z-50">
    <div class="flex items-center space-x-4">
      <span class="text-xl">🧩</span>
      <div>
        <h1 class="text-lg font-semibold tracking-tight text-white flex items-center space-x-2">
          <span>stubs Web Portal</span>
          <span class="text-xs bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded-full font-mono">v1.4.0</span>
        </h1>
        <p class="text-xs text-slate-400">Subsystem: <span id="active-subsystem" class="font-mono text-slate-300">src</span></p>
      </div>
    </div>

    <!-- Repository & Branch Switcher -->
    <div class="flex items-center space-x-3 bg-slate-950 border border-slate-800/80 p-1.5 rounded-lg">
      <div class="flex items-center bg-slate-900 border border-slate-800 rounded px-2.5 py-1">
        <label for="mode-toggle" class="text-[10px] font-bold text-slate-400 mr-1.5 uppercase">Mode</label>
        <select id="mode-toggle" onchange="toggleMode()" class="bg-transparent text-xs text-white focus:outline-none font-semibold">
          <option value="local" class="bg-slate-900">Local</option>
          <option value="remote" class="bg-slate-900">Remote (GitHub)</option>
        </select>
      </div>

      <div id="remote-switcher-controls" class="hidden flex items-center space-x-2">
        <div class="flex items-center bg-slate-900 border border-slate-800 rounded px-2 py-1">
          <label for="repo-select" class="text-[10px] font-bold text-slate-400 mr-1.5 uppercase">Repo</label>
          <select id="repo-select" onchange="selectRepo()" class="bg-transparent text-xs text-white focus:outline-none max-w-[140px] font-semibold">
            <option value="">-- Choose Repo --</option>
          </select>
          <input type="text" id="custom-repo-input" placeholder="or owner/repo" onkeydown="handleCustomRepoKey(event)" class="bg-transparent text-xs text-white placeholder-slate-600 focus:outline-none ml-2 border-l border-slate-800 pl-2 w-24 font-mono" />
        </div>

        <div class="flex items-center bg-slate-900 border border-slate-800 rounded px-2 py-1">
          <label for="branch-select" class="text-[10px] font-bold text-slate-400 mr-1.5 uppercase">Branch</label>
          <select id="branch-select" onchange="selectBranch()" class="bg-transparent text-xs text-white focus:outline-none max-w-[100px] font-mono">
            <option value="main">main</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Live Search Bar -->
    <div class="flex-1 max-w-sm mx-4 relative">
      <input
        type="text"
        id="search-input"
        placeholder="Search sidecars (FTS5 priority: text, tags, bounds)..."
        class="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all duration-200"
      />
      <div class="absolute right-3 top-2 text-[10px] text-slate-500 font-mono pointer-events-none" id="search-count">0 files</div>
    </div>

    <div class="flex items-center space-x-4">
      <!-- Bootstrap Codebase Button -->
      <button
        onclick="openBootstrapModal()"
        class="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-3 py-1.5 rounded-lg transition-all active:scale-95 shadow-sm"
      >
        ⚡ Bootstrap Codebase
      </button>
      <!-- Connectivity Status Badge -->
      <div id="connection-badge" class="flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors duration-300 connection-dead">
        <span class="h-2 w-2 rounded-full animate-pulse bg-current" id="connection-dot"></span>
        <span id="connection-text">Disconnected</span>
      </div>
      <div class="text-right text-xs text-slate-400">
        <p>Sync Engine</p>
        <p id="last-updated" class="font-mono text-slate-300">Never</p>
      </div>
    </div>
  </header>

  <!-- Split Pane Layout -->
  <div class="flex-1 flex overflow-hidden">

    <!-- Left Sidebar: Specifications Explorer -->
    <aside class="w-1/3 border-r border-slate-800 flex flex-col bg-slate-900/10">
      <div class="flex-1 overflow-y-auto custom-scroll p-4 space-y-6">

        <!-- sidecar explorer list -->
        <div>
          <h2 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Specification Sidecars</h2>
          <div id="sidecars-list" class="space-y-2">
            <!-- Dynamic Sidecars -->
            <p class="text-xs text-slate-500 italic p-2">Loading sidecars...</p>
          </div>
        </div>

      </div>
    </aside>

    <!-- Center Pane: Detailed Inspector / 1-Hop Ego Graph Viewer -->
    <main class="flex-1 border-r border-slate-800 flex flex-col bg-slate-950/20 overflow-y-auto custom-scroll" id="detail-pane">
      <div class="flex-1 flex flex-col items-center justify-center text-slate-500 p-8">
        <span class="text-4xl mb-4">🔍</span>
        <h3 class="text-sm font-semibold text-slate-300">No Specification Selected</h3>
        <p class="text-xs max-w-xs text-center mt-1 text-slate-400">Select any sidecar to drill into its structured details, ADR ledger, and visual 1-hop dependencies.</p>
      </div>
    </main>

    <!-- Right Sidebar: Directives Panel & Template Workbench -->
    <aside class="w-1/3 flex flex-col bg-slate-900/15">

      <!-- Tabs Navigation -->
      <div class="flex border-b border-slate-800 bg-slate-950/20">
        <button
          onclick="switchRightTab('directives')"
          id="tab-directives-btn"
          class="flex-1 py-3 text-xs font-semibold uppercase tracking-wider text-center border-b-2 border-indigo-500 text-indigo-400 transition-colors duration-200"
        >
          Directives
        </button>
        <button
          onclick="switchRightTab('templates')"
          id="tab-templates-btn"
          class="flex-1 py-3 text-xs font-semibold uppercase tracking-wider text-center border-b-2 border-transparent text-slate-400 hover:text-slate-200 transition-colors duration-200"
        >
          Template Workbench
        </button>
      </div>

      <!-- Right Tab Content Container -->
      <div class="flex-1 overflow-y-auto custom-scroll p-4">

        <!-- Directives Tab Content -->
        <div id="tab-directives-panel" class="space-y-6">

          <!-- Submit Human Directive Note Form -->
          <div class="bg-slate-900/35 border border-slate-800 p-4 rounded-xl space-y-3 shadow-sm">
            <h3 class="text-xs font-semibold text-slate-200">Submit New Directive Note</h3>

            <div class="space-y-1">
              <!-- Label above inputs in compliance with ADR 0025 -->
              <label for="new-directive-file" class="block text-[11px] font-medium text-slate-400">Target Sidecar</label>
              <select
                id="new-directive-file"
                class="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
              >
                <option value="">-- Choose Sidecar File --</option>
              </select>
            </div>

            <div class="space-y-1">
              <label for="new-directive-text" class="block text-[11px] font-medium text-slate-400">Directive Prompt Canvas</label>
              <textarea
                id="new-directive-text"
                rows="3"
                placeholder="Type instructions... (Press ⌘Enter or Ctrl+Enter to submit)"
                class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 placeholder-slate-600 resize-y min-h-[60px]"
                onkeydown="handleDirectiveKeyDown(event)"
              ></textarea>
            </div>

            <div class="flex justify-end pt-1">
              <button
                onclick="submitDirective()"
                class="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-4 py-2 rounded-lg transition-colors duration-150 shadow-sm"
              >
                Send Directive
              </button>
            </div>
          </div>

          <!-- Directives List Header & Filter -->
          <div class="border-t border-slate-800/80 pt-4 space-y-3">
            <div class="flex items-center justify-between">
              <h2 class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Human Directives</h2>
              <div class="flex space-x-1.5 bg-slate-950 border border-slate-800/80 p-0.5 rounded-lg text-[10px]">
                <button onclick="filterDirectives('pending')" id="dir-filter-pending" class="px-2.5 py-1 rounded-md font-medium bg-slate-800 text-white">Pending</button>
                <button onclick="filterDirectives('resolved')" id="dir-filter-resolved" class="px-2.5 py-1 rounded-md font-medium text-slate-400">Resolved</button>
                <button onclick="filterDirectives('all')" id="dir-filter-all" class="px-2.5 py-1 rounded-md font-medium text-slate-400">All</button>
              </div>
            </div>

            <div id="directives-list" class="space-y-3">
              <p class="text-xs text-slate-500 italic p-2">No directives registered.</p>
            </div>
          </div>

        </div>

        <!-- Templates Tab Content -->
        <div id="tab-templates-panel" class="hidden space-y-6">
          <div>
            <h3 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Template Workbench</h3>
            <p class="text-[11px] text-slate-400 mb-4">Manage registered code templates and inline draft proposals for autonomous execution permissions.</p>
            <div id="templates-list" class="space-y-3">
              <p class="text-xs text-slate-500 italic p-2">Scanning templates...</p>
            </div>
          </div>
        </div>

      </div>
    </aside>

  </div>

  <!-- Bootstrap Codebase Modal -->
  <div id="bootstrap-modal" class="fixed inset-0 bg-black/80 z-50 flex items-center justify-center hidden px-4">
    <div class="bg-slate-900 border border-slate-800 w-full max-w-4xl h-[85vh] p-6 rounded-2xl shadow-2xl flex flex-col space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3 shrink-0">
        <div class="flex items-center space-x-2.5">
          <span class="text-xl">⚡</span>
          <div>
            <h2 class="text-base font-semibold text-white tracking-tight">Bootstrap Specification Sidecars</h2>
            <p class="text-xs text-slate-400">Generate OKF skeleton sidecars for TypeScript files missing specs.</p>
          </div>
        </div>
        <button onclick="closeBootstrapModal()" class="text-slate-500 hover:text-slate-300 text-sm p-1">✕</button>
      </div>

      <!-- Main Columns Split -->
      <div class="flex-1 flex overflow-hidden gap-4 min-h-0">
        <!-- Left Pane: Checklist of un-bootstrapped files -->
        <div class="w-1/2 flex flex-col space-y-3 border-r border-slate-800 pr-4">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-semibold text-slate-200">Un-bootstrapped TS Files</h3>
            <div class="flex space-x-3">
              <button onclick="toggleAllBootstrapCheckboxes(true)" class="text-[10px] text-indigo-400 hover:underline">Select All</button>
              <button onclick="toggleAllBootstrapCheckboxes(false)" class="text-[10px] text-slate-500 hover:underline">Deselect All</button>
            </div>
          </div>

          <!-- Checklist container -->
          <div id="bootstrap-files-list" class="flex-1 overflow-y-auto custom-scroll space-y-2 bg-slate-950/40 p-3 rounded-xl border border-slate-800/80">
            <p class="text-xs text-slate-500 italic">No files scanned yet.</p>
          </div>
        </div>

        <!-- Right Pane: Generation Configuration and Preview -->
        <div class="w-1/2 flex flex-col space-y-4">
          <!-- Template selector -->
          <div class="space-y-1.5 shrink-0">
            <label for="bootstrap-template-select" class="block text-[11px] font-medium text-slate-400">Base Template Mold</label>
            <select
              id="bootstrap-template-select"
              onchange="onBootstrapTemplateChange()"
              class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
            >
              <option value="">-- Use Default OKF Skeleton --</option>
            </select>
          </div>

          <!-- Preview container -->
          <div class="flex-1 flex flex-col min-h-0">
            <div class="flex items-center justify-between mb-1.5 shrink-0">
              <h3 class="text-xs font-semibold text-slate-200">Specification Preview</h3>
              <span id="preview-filename-badge" class="text-[10px] font-mono text-indigo-400 truncate max-w-[200px]">None selected</span>
            </div>
            <div class="flex-1 bg-slate-950 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
              <pre class="flex-1 p-3 text-[10px] text-slate-300 font-mono overflow-y-auto custom-scroll whitespace-pre-wrap select-all leading-relaxed" id="bootstrap-preview-text">Select a file on the left to preview generated specification content...</pre>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer Buttons -->
      <div class="flex items-center justify-between border-t border-slate-800 pt-3 shrink-0">
        <span id="bootstrap-status-info" class="text-xs text-slate-500 italic">0 files selected for bootstrapping.</span>
        <div class="flex space-x-2">
          <button onclick="commitBootstrapSidecars()" id="bootstrap-commit-btn" class="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-5 py-2.5 rounded-lg active:scale-95 transition-all shadow-sm" disabled>
            Commit Specifications
          </button>
          <button onclick="closeBootstrapModal()" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs px-4 py-2.5 rounded-lg active:scale-95 transition-all">
            Cancel
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Toast Overlay System (Max 3 visible) -->
  <div id="toast-container" class="fixed bottom-6 right-6 flex flex-col space-y-2 z-50 pointer-events-none"></div>

  <script>
    let sidecars = [];
    let directives = [];
    let templates = [];
    let selectedPath = null;
    let currentDirFilter = 'pending';
    let rightTab = 'directives';
    let toastQueue = [];

    // Dual-Mode State
    let currentMode = 'local';
    let currentRepo = '';
    let currentBranch = 'main';

    let bootstrapFiles = [];
    let bootstrapSelectedFile = null;

    async function openBootstrapModal() {
      const modal = document.getElementById('bootstrap-modal');
      modal.classList.remove('hidden');

      // 1. Scan for un-bootstrapped files
      const listContainer = document.getElementById('bootstrap-files-list');
      listContainer.innerHTML = '<p class="text-xs text-slate-500 italic p-2">Scanning workspace for unbootstrapped files...</p>';

      try {
        const scanRes = await fetch('/api/v1/bootstrap/scan' + getQueryParams());
        const scanData = await scanRes.json();
        bootstrapFiles = scanData.files || [];

        if (bootstrapFiles.length === 0) {
          listContainer.innerHTML = '<p class="text-xs text-slate-500 italic p-2">All TypeScript files in the codebase have corresponding sidecar specifications!</p>';
        } else {
          listContainer.innerHTML = bootstrapFiles.map((file, idx) => \`
            <div class="flex items-center justify-between p-2 hover:bg-slate-900/50 rounded-lg transition-all">
              <label class="flex items-center space-x-2.5 cursor-pointer truncate mr-2">
                <input
                  type="checkbox"
                  class="bootstrap-file-chk rounded border-slate-800 bg-slate-950 text-indigo-600 focus:ring-indigo-500"
                  value="\${file}"
                  onchange="onBootstrapCheckboxChange()"
                />
                <span class="text-xs text-slate-300 font-medium truncate">\${file}</span>
              </label>
              <button
                onclick="previewBootstrapFile('\${file}')"
                class="text-[10px] text-indigo-400 hover:underline cursor-pointer shrink-0 font-medium px-2 py-1 bg-slate-900 border border-slate-800/80 rounded"
              >
                Preview
              </button>
            </div>
          \`).join('');
        }
      } catch (err) {
        listContainer.innerHTML = '<p class="text-xs text-rose-400 font-semibold p-2">Failed to scan workspace.</p>';
      }

      // 2. Load templates dropdown
      const templateSelect = document.getElementById('bootstrap-template-select');
      templateSelect.innerHTML = '<option value="">-- Use Default OKF Skeleton --</option>';

      try {
        const templatesRes = await fetch('/api/v1/templates' + getQueryParams());
        const templatesData = await templatesRes.json();
        const tpls = templatesData.templates || [];

        tpls.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t.name;
          opt.textContent = t.name + (t.isDraft ? ' (draft)' : '');
          templateSelect.appendChild(opt);
        });
      } catch (err) {
        console.error('Failed to load templates:', err);
      }

      // Reset preview and status
      bootstrapSelectedFile = null;
      document.getElementById('bootstrap-preview-text').textContent = 'Select a file on the left to preview generated specification content...';
      document.getElementById('preview-filename-badge').textContent = 'None selected';
      updateBootstrapStatus();
    }

    function closeBootstrapModal() {
      document.getElementById('bootstrap-modal').classList.add('hidden');
    }

    function toggleAllBootstrapCheckboxes(checked) {
      const chks = document.querySelectorAll('.bootstrap-file-chk');
      chks.forEach(chk => chk.checked = checked);
      updateBootstrapStatus();
    }

    function onBootstrapCheckboxChange() {
      updateBootstrapStatus();
    }

    async function previewBootstrapFile(filePath) {
      bootstrapSelectedFile = filePath;
      document.getElementById('preview-filename-badge').textContent = filePath;
      const previewText = document.getElementById('bootstrap-preview-text');
      previewText.textContent = 'Generating preview...';

      const templateName = document.getElementById('bootstrap-template-select').value;

      try {
        const res = await fetch('/api/v1/bootstrap/preview' + getQueryParams(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath, templateName })
        });
        const data = await res.json();
        if (data.content) {
          previewText.textContent = data.content;
        } else {
          previewText.textContent = 'Error generating preview: ' + (data.error || 'unknown');
        }
      } catch (err) {
        previewText.textContent = 'Failed to fetch generation preview.';
      }
    }

    function onBootstrapTemplateChange() {
      if (bootstrapSelectedFile) {
        previewBootstrapFile(bootstrapSelectedFile);
      }
    }

    function updateBootstrapStatus() {
      const chks = document.querySelectorAll('.bootstrap-file-chk:checked');
      const count = chks.length;
      document.getElementById('bootstrap-status-info').textContent = \`\${count} file(s) selected for bootstrapping.\`;
      document.getElementById('bootstrap-commit-btn').disabled = (count === 0);
    }

    async function commitBootstrapSidecars() {
      const chks = document.querySelectorAll('.bootstrap-file-chk:checked');
      if (chks.length === 0) return;

      const commitBtn = document.getElementById('bootstrap-commit-btn');
      commitBtn.disabled = true;
      commitBtn.textContent = 'Committing...';

      const filesToCommit = [];
      const templateName = document.getElementById('bootstrap-template-select').value;

      showToast(\`Generating sidecars for \${chks.length} files...\`, "info");

      // Generate preview/content for each selected file
      for (const chk of chks) {
        const filePath = chk.value;
        try {
          const res = await fetch('/api/v1/bootstrap/preview' + getQueryParams(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath, templateName })
          });
          const data = await res.json();
          if (data.content) {
            filesToCommit.push({ filePath, content: data.content });
          } else {
            showToast(\`Skipped \${filePath}: generation failed.\`, "error");
          }
        } catch (err) {
          showToast(\`Skipped \${filePath}: fetch failed.\`, "error");
        }
      }

      if (filesToCommit.length === 0) {
        showToast("No valid files generated. Aborting commit.", "error");
        commitBtn.textContent = 'Commit Specifications';
        commitBtn.disabled = false;
        return;
      }

      showToast(\`Committing \${filesToCommit.length} sidecar files...\`, "info");

      try {
        const commitRes = await fetch('/api/v1/bootstrap/commit' + getQueryParams(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: filesToCommit })
        });
        const commitData = await commitRes.json();
        if (commitData.success) {
          showToast(\`Successfully bootstrapped \${filesToCommit.length} sidecars!\`, "success");
          closeBootstrapModal();
          initWorkspace(); // Refresh workspace specs list
        } else {
          showToast("Commit failed: " + (commitData.error || 'unknown'), "error");
        }
      } catch (err) {
        showToast("Error executing bootstrap commit.", "error");
      } finally {
        commitBtn.textContent = 'Commit Specifications';
        commitBtn.disabled = false;
      }
    }

    function getQueryParams() {
      if (currentMode === 'remote' && currentRepo) {
        return \`?mode=remote&repo=\${encodeURIComponent(currentRepo)}&branch=\${encodeURIComponent(currentBranch)}\`;
      }
      return '';
    }

    async function toggleMode() {
      const mode = document.getElementById('mode-toggle').value;
      currentMode = mode;
      const remoteControls = document.getElementById('remote-switcher-controls');
      if (mode === 'remote') {
        remoteControls.classList.remove('hidden');
        await loadRemoteRepos();
      } else {
        remoteControls.classList.add('hidden');
        currentRepo = '';
        currentBranch = 'main';
        await initWorkspace();
      }
    }

    async function loadRemoteRepos() {
      try {
        const res = await fetch('/api/v1/repos');
        const data = await res.json();
        const repoSelect = document.getElementById('repo-select');

        if (data.repositories && Array.isArray(data.repositories)) {
          repoSelect.innerHTML = '<option value="">-- Choose Repo --</option>' +
            data.repositories.map(r => {
              const star = r.hasStubs ? '⭐ ' : '';
              return \`<option value="\${r.fullName}">\${star}\${r.fullName}</option>\`;
            }).join('');
        }
      } catch (err) {
        showToast("Failed to load GitHub repositories", "error");
      }
    }

    async function selectRepo() {
      const repo = document.getElementById('repo-select').value;
      if (repo) {
        currentRepo = repo;
        await loadBranches(repo);
      }
    }

    async function handleCustomRepoKey(event) {
      if (event.key === 'Enter') {
        const custom = document.getElementById('custom-repo-input').value.trim();
        if (custom) {
          currentRepo = custom;
          await loadBranches(custom);
        }
      }
    }

    async function loadBranches(repo) {
      try {
        const res = await fetch(\`/api/v1/repos?repo=\${encodeURIComponent(repo)}\`);
        const data = await res.json();
        const branchSelect = document.getElementById('branch-select');

        if (data.branches && Array.isArray(data.branches)) {
          branchSelect.innerHTML = data.branches.map(b => \`<option value="\${b}">\${b}</option>\`).join('');
          currentBranch = data.branches.includes('main') ? 'main' : data.branches[0];
          branchSelect.value = currentBranch;
          await initWorkspace();
        }
      } catch (err) {
        showToast("Failed to load branches for repository", "error");
      }
    }

    async function selectBranch() {
      currentBranch = document.getElementById('branch-select').value;
      await initWorkspace();
    }

    // Trigger Toast Notification
    function showToast(message, type = 'info') {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');

      // Dynamic styling with zero static alert colors at rest
      const borderOklch = type === 'error' ? 'oklch(0.627 0.265 20)' : 'oklch(0.5 0.2 240)';

      toast.className = "toast-enter pointer-events-auto p-3.5 rounded-xl border bg-slate-900/95 shadow-lg max-w-sm text-xs flex flex-col space-y-1";
      toast.style.borderColor = borderOklch;

      toast.innerHTML = \`
        <div class="flex items-center justify-between">
          <span class="font-semibold text-white uppercase tracking-wider text-[10px]">\${type} notification</span>
          <button onclick="this.parentElement.parentElement.remove()" class="text-slate-500 hover:text-slate-300 text-[10px]">✕</button>
        </div>
        <p class="text-slate-300 leading-relaxed">\${message}</p>
      \`;

      container.appendChild(toast);

      // Enforce max 3 concurrent toasts
      if (container.children.length > 3) {
        container.children[0].remove();
      }

      // Auto dismiss after 3 seconds
      setTimeout(() => {
        if (toast.parentElement) {
          toast.remove();
        }
      }, 3000);
    }

    // Connect to SSE Bridge (V1 and default endpoints)
    function connectSse() {
      const sse = new EventSource('/api/v1/events');
      const badge = document.getElementById('connection-badge');
      const dot = document.getElementById('connection-dot');
      const text = document.getElementById('connection-text');

      sse.onopen = () => {
        badge.className = "flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors duration-300 connection-live";
        text.textContent = "Live Stream Active";
        showToast("Connected to system SSE bridge.", "success");
      };

      sse.onerror = () => {
        badge.className = "flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors duration-300 connection-dead";
        text.textContent = "Disconnected";
        showToast("Connection to SSE stream lost. Retrying...", "error");
      };

      // General Update Event
      sse.addEventListener('update', (e) => {
        const data = JSON.parse(e.data);
        sidecars = data.sidecars;
        document.getElementById('last-updated').textContent = new Date(data.timestamp).toLocaleTimeString();
        renderSidecarList();
        populateSidecarSelect();
        fetchDirectives();
        if (selectedPath) {
          fetchAndShowSidecarDetail(selectedPath);
        }
      });

      // Specific Requirements Real-Time Listeners
      sse.addEventListener('file:changed', (e) => {
        showToast("File change event detected in workspace specs.", "info");
      });

      sse.addEventListener('graph:updated', (e) => {
        showToast("Workspace dependency graph updated dynamically.", "info");
        fetchDirectives();
        fetchTemplates();
        if (selectedPath) {
          fetchAndShowSidecarDetail(selectedPath);
        }
      });

      sse.addEventListener('directive:created', (e) => {
        const data = JSON.parse(e.data);
        showToast(\`New human directive created for \${data.filePath}\`, "info");
        fetchDirectives();
      });

      sse.addEventListener('drift:detected', (e) => {
        showToast("Active sync drift check run successfully.", "info");
      });

      sse.addEventListener('github:sync', (e) => {
        const data = JSON.parse(e.data);
        showToast(\`Remote GitHub specifications synchronized for \${data.repo} (\${data.branch})\`, "success");
        initWorkspace();
      });

      sse.addEventListener('branch:changed', (e) => {
        const data = JSON.parse(e.data);
        showToast(\`Branch switched to \${data.branch} on \n\${data.repo}\`, "info");
        initWorkspace();
      });
    }

    // Fetch initial workspace specifications
    async function initWorkspace() {
      try {
        const res = await fetch('/api/graph' + getQueryParams());
        const data = await res.json();
        sidecars = data.sidecars || [];

        document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();
        document.getElementById('active-subsystem').textContent = data.projectName || 'src';

        renderSidecarList();
        populateSidecarSelect();
        fetchDirectives();
        fetchTemplates();
      } catch (err) {
        showToast("Failed to initialize workspace data", "error");
      }
    }

    // Fetch Directives from API
    async function fetchDirectives() {
      try {
        const res = await fetch(\`/api/v1/directives?status=\${currentDirFilter}\` + (getQueryParams() ? '&' + getQueryParams().substring(1) : ''));
        const data = await res.json();
        directives = data.directives || [];
        renderDirectivesList();
      } catch (err) {
        console.error("Error fetching directives:", err);
      }
    }

    // Fetch Templates from API
    async function fetchTemplates() {
      try {
        const res = await fetch('/api/v1/templates' + getQueryParams());
        const data = await res.json();
        templates = data.templates || [];
        renderTemplatesList();
      } catch (err) {
        console.error("Error fetching templates:", err);
      }
    }

    // Switch Right Panel Tabs
    function switchRightTab(tab) {
      rightTab = tab;
      const directivesTab = document.getElementById('tab-directives-btn');
      const templatesTab = document.getElementById('tab-templates-btn');
      const directivesPanel = document.getElementById('tab-directives-panel');
      const templatesPanel = document.getElementById('tab-templates-panel');

      if (tab === 'directives') {
        directivesTab.className = "flex-1 py-3 text-xs font-semibold uppercase tracking-wider text-center border-b-2 border-indigo-500 text-indigo-400 transition-all duration-200";
        templatesTab.className = "flex-1 py-3 text-xs font-semibold uppercase tracking-wider text-center border-b-2 border-transparent text-slate-400 hover:text-slate-200 transition-all duration-200";
        directivesPanel.classList.remove('hidden');
        templatesPanel.classList.add('hidden');
      } else {
        templatesTab.className = "flex-1 py-3 text-xs font-semibold uppercase tracking-wider text-center border-b-2 border-indigo-500 text-indigo-400 transition-all duration-200";
        directivesTab.className = "flex-1 py-3 text-xs font-semibold uppercase tracking-wider text-center border-b-2 border-transparent text-slate-400 hover:text-slate-200 transition-all duration-200";
        templatesPanel.classList.remove('hidden');
        directivesPanel.classList.add('hidden');
      }
    }

    // Populate Sidebar Sidecars List (includes FTS5 client-side search filtering)
    function renderSidecarList() {
      const q = document.getElementById('search-input').value.toLowerCase();

      const filtered = sidecars.filter(s => {
        const titleMatch = s.frontmatter.title?.toLowerCase().includes(q);
        const pathMatch = s.filePath.toLowerCase().includes(q);
        const descMatch = s.frontmatter.description?.toLowerCase().includes(q);
        const tagsMatch = s.frontmatter.tags?.some(t => t.toLowerCase().includes(q));
        return titleMatch || pathMatch || descMatch || tagsMatch;
      });

      document.getElementById('search-count').textContent = \`\${filtered.length} files\`;

      const listContainer = document.getElementById('sidecars-list');
      if (filtered.length === 0) {
        listContainer.innerHTML = \`<p class="text-xs text-slate-500 italic p-2">No matching sidecars found.</p>\`;
        return;
      }

      // Render sidecars list adhering strictly to Concept C (Sub-label stacking, zero badge color clutter)
      listContainer.innerHTML = filtered.map(s => {
        const isSelected = s.filePath === selectedPath;
        const fm = s.frontmatter;
        return \`
          <div
            onclick="selectSidecar('\${s.filePath}')"
            class="p-3.5 rounded-xl border cursor-pointer transition-all duration-150 \${
              isSelected
                ? 'bg-slate-800/75 border-indigo-500/80'
                : 'bg-slate-900/40 border-slate-800/80 hover:bg-slate-800/30 hover:border-slate-700/60'
            }"
          >
            <!-- Concept C sublabel stacking for metadata Display -->
            <div class="flex flex-col">
              <span class="text-xs font-medium text-slate-200 truncate">\${fm.title || 'Untitled'}</span>
              <span class="text-[10px] text-slate-500 font-mono tracking-wide mt-1">
                \${s.filePath}
              </span>
              <span class="text-[10px] text-slate-400/80 font-mono mt-1.5 flex items-center justify-between border-t border-slate-800/30 pt-1">
                <span>status: \${fm.status} | flag: \${fm.status_flag}</span>
                <span class="text-indigo-400">v\${fm.version || 1}</span>
              </span>
            </div>
          </div>
        \`;
      }).join('');
    }

    // Populate Sidecar Selection Input in the form
    function populateSidecarSelect() {
      const select = document.getElementById('new-directive-file');
      const val = select.value;

      select.innerHTML = \`
        <option value="">-- Choose Sidecar File --</option>
        \${sidecars.map(s => \`<option value="\${s.filePath}">\${s.filePath}</option>\`).join('')}
      \`;

      if (val && sidecars.some(s => s.filePath === val)) {
        select.value = val;
      }
    }

    // Filter Directives Action
    function filterDirectives(status) {
      currentDirFilter = status;
      ['pending', 'resolved', 'all'].forEach(st => {
        const btn = document.getElementById(\`dir-filter-\${st}\`);
        if (st === status) {
          btn.className = "px-2.5 py-1 rounded-md font-medium bg-slate-800 text-white";
        } else {
          btn.className = "px-2.5 py-1 rounded-md font-medium text-slate-400 hover:text-slate-200 transition-colors";
        }
      });
      fetchDirectives();
    }

    // Submit New Human Directive Note
    async function submitDirective() {
      const fileInput = document.getElementById('new-directive-file');
      const textInput = document.getElementById('new-directive-text');

      const filePath = fileInput.value;
      const text = textInput.value.trim();

      if (!filePath) {
        showToast("Please choose a target sidecar file first.", "error");
        return;
      }
      if (!text) {
        showToast("Directive text cannot be empty.", "error");
        return;
      }

      // Optimistic UI response
      const mockId = 'NOTE-' + Date.now();
      const optimisticNote = {
        id: mockId,
        timestamp: new Date().toISOString(),
        text: text,
        status: 'pending',
        filePath: filePath
      };

      if (currentDirFilter === 'pending' || currentDirFilter === 'all') {
        directives.unshift(optimisticNote);
        renderDirectivesList();
      }

      textInput.value = '';
      showToast("Sending directive note to workspace...", "info");

      try {
        const res = await fetch('/api/v1/directives' + getQueryParams(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath, text })
        });
        const data = await res.json();
        if (data.success) {
          showToast("Directive saved successfully inside sidecar spec.", "success");
        } else {
          showToast("Failed to post directive: " + data.error, "error");
          fetchDirectives(); // revert optimistic
        }
      } catch (err) {
        showToast("Error sending directive", "error");
        fetchDirectives(); // revert optimistic
      }
    }

    // Resolve human directive inline
    async function resolveDirective(filePath, id) {
      showToast("Marking directive as resolved...", "info");

      // Optimistic UI updates
      directives = directives.filter(d => d.id !== id);
      renderDirectivesList();

      try {
        const res = await fetch('/api/v1/directives/resolve' + getQueryParams(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath, id })
        });
        const data = await res.json();
        if (data.success) {
          showToast("Directive marked resolved cleanly.", "success");
        } else {
          showToast("Error: " + data.error, "error");
          fetchDirectives();
        }
      } catch (err) {
        showToast("Failed to resolve directive", "error");
        fetchDirectives();
      }
    }

    // Submit directive keyboard shortcut (⌘Enter)
    function handleDirectiveKeyDown(event) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        submitDirective();
      }
    }

    // Render Directives List Pane
    function renderDirectivesList() {
      const container = document.getElementById('directives-list');
      if (directives.length === 0) {
        container.innerHTML = \`<p class="text-xs text-slate-500 italic p-2">No directives matching this state.</p>\`;
        return;
      }

      container.innerHTML = directives.map(d => {
        const isPending = d.status === 'pending';
        return \`
          <div class="p-3 bg-slate-900/60 border border-slate-800 rounded-xl space-y-1.5 shadow-sm hover:border-slate-700 transition-all">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-mono text-slate-400">\${d.id}</span>
              <span class="text-[9px] font-mono text-slate-500">\${new Date(d.timestamp).toLocaleTimeString()}</span>
            </div>
            <p class="text-xs text-slate-200 font-medium leading-relaxed">\${d.text}</p>
            <div class="flex items-center justify-between pt-1 border-t border-slate-800/40">
              <span onclick="selectSidecar('\${d.filePath}')" class="text-[9px] font-mono text-indigo-400 hover:underline cursor-pointer truncate max-w-[150px]">
                File: \${d.filePath}
              </span>
              \${isPending ? \`
                <button
                  onclick="resolveDirective('\${d.filePath}', '\${d.id}')"
                  class="text-[9px] font-semibold text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 border border-slate-800 hover:border-emerald-500/20 px-2 py-0.5 rounded transition-all"
                >
                  Mark Resolved
                </button>
              \` : \`
                <span class="text-[9px] font-mono text-slate-500 font-semibold uppercase tracking-wider">Resolved</span>
              \`}
            </div>
          </div>
        \`;
      }).join('');
    }

    // Render Template Workbench list and inline forms
    function renderTemplatesList() {
      const container = document.getElementById('templates-list');
      if (templates.length === 0) {
        container.innerHTML = \`<p class="text-xs text-slate-500 italic p-2">No templates found on disk.</p>\`;
        return;
      }

      container.innerHTML = templates.map(t => {
        const statusClass = t.isDraft ? 'text-amber-400' : 'text-emerald-400';
        return \`
          <div class="p-3.5 bg-slate-950/40 border border-slate-800 rounded-xl space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold text-white truncate max-w-[200px]">\${t.name}</span>
              <span class="text-[10px] font-mono font-semibold \${statusClass}">\${t.version}</span>
            </div>

            <pre class="bg-slate-950/80 p-2 border border-slate-900 rounded-lg text-[10px] text-slate-400 max-h-[80px] overflow-y-auto font-mono custom-scroll">\${escapeHtml(t.content)}</pre>

            \${t.isDraft ? \`
              <div class="flex items-center space-x-2 pt-1">
                <button
                  onclick="approveTemplate('\${t.name}', true)"
                  class="flex-1 py-1 px-3 bg-slate-800 hover:bg-indigo-600/20 text-indigo-400 hover:border-indigo-500/40 border border-slate-800 rounded-lg text-[10px] font-semibold transition-all"
                >
                  Approve Template
                </button>
                <button
                  onclick="approveTemplate('\${t.name}', false)"
                  class="py-1 px-3 bg-slate-950 hover:bg-rose-950/20 text-rose-500 hover:border-rose-500/30 border border-slate-900 rounded-lg text-[10px] font-semibold transition-all"
                >
                  Reject
                </button>
              </div>
            \` : \`
              <p class="text-[9px] text-slate-500 font-mono italic">Template fully active & registered.</p>
            \`}
          </div>
        \`;
      }).join('');
    }

    // Execute Template Approval / Rejection
    async function approveTemplate(templateName, approved) {
      showToast(approved ? "Approving template draft..." : "Rejecting template draft...", "info");

      try {
        const res = await fetch('/api/v1/templates/approve' + getQueryParams(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateName, approved })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message, "success");
          fetchTemplates();
        } else {
          showToast("Action failed: " + data.error, "error");
        }
      } catch (err) {
        showToast("Error approving template", "error");
      }
    }

    // Select Sidecar File
    function selectSidecar(filePath) {
      selectedPath = filePath;
      renderSidecarList();
      fetchAndShowSidecarDetail(filePath);
    }

    // Fetch and Render Sidecar Detail & 1-Hop Ego Graph Viewer
    async function fetchAndShowSidecarDetail(filePath) {
      const container = document.getElementById('detail-pane');
      try {
        const res = await fetch(\`/api/sidecar?path=\${encodeURIComponent(filePath)}\` + (getQueryParams() ? '&' + getQueryParams().substring(1) : ''));
        const data = await res.json();

        if (data.error) {
          container.innerHTML = \`<p class="p-6 text-xs text-rose-400 font-semibold">Error: \${data.error}</p>\`;
          return;
        }

        const s = data.sidecar;
        const fm = s.frontmatter;

        // Render tags and exports using Concept C
        const tagsHtml = fm.tags?.map(t => \`<span class="text-[10px] font-mono bg-slate-900 border border-slate-800 text-slate-400 px-2 py-0.5 rounded-md">#\${t}</span>\`).join(' ') || '<span class="text-xs text-slate-600 italic">None</span>';
        const exportsHtml = fm.exports?.map(e => \`<span class="text-[10px] font-mono bg-indigo-950/20 border border-indigo-900/30 text-indigo-400 px-2 py-0.5 rounded-md">\${e}</span>\`).join(' ') || '<span class="text-xs text-slate-600 italic">None</span>';

        // Render ADRs list
        const decisionsHtml = fm.decisions?.map(d => \`
          <div class="p-3 bg-slate-900/40 border border-slate-800/80 rounded-xl">
            <div class="flex items-center justify-between mb-1">
              <span class="text-[10px] font-mono text-indigo-400 font-semibold">\${d.id}</span>
              <span class="text-[9px] font-mono text-slate-500">\${d.date || 'No Date'}</span>
            </div>
            <p class="text-xs text-slate-200 font-medium leading-relaxed">\${d.summary}</p>
          </div>
        \`).join('') || '<p class="text-xs text-slate-500 italic">No Architectural Decision Records (ADRs).</p>';

        // Prepare lists of upstream and downstream for the graph and lists
        const upstreams = fm.depends_on || [];
        const downstreams = fm.used_by || [];

        const upstreamListHtml = upstreams.map(u => \`
          <li onclick="selectSidecar('\${u}')" class="text-xs font-mono text-indigo-400 hover:underline cursor-pointer mb-1.5 flex items-center space-x-1.5">
            <span>🔌</span> <span>\${u}</span>
          </li>
        \`).join('') || '<p class="text-xs text-slate-500 italic">No upstream dependents.</p>';

        const downstreamListHtml = downstreams.map(d => \`
          <li onclick="selectSidecar('\${d}')" class="text-xs font-mono text-indigo-400 hover:underline cursor-pointer mb-1.5 flex items-center space-x-1.5">
            <span>⚙️</span> <span>\${d}</span>
          </li>
        \`).join('') || '<p class="text-xs text-slate-500 italic">No downstream dependents.</p>';

        // Render Detail Layout with Embedded 1-Hop Ego Graph Viewer
        container.innerHTML = \`
          <div class="p-6 space-y-6">

            <!-- Metadata & Title Section -->
            <div class="border-b border-slate-800/80 pb-5">
              <div class="flex items-start justify-between">
                <div>
                  <h2 class="text-lg font-semibold text-white tracking-tight">\${fm.title || 'Untitled'}</h2>
                  <p class="text-xs font-mono text-slate-500 mt-1">\${s.filePath}</p>
                </div>
                <div class="flex flex-col items-end space-y-1">
                  <span class="text-[11px] font-semibold font-mono text-slate-300">Status: \${fm.status}</span>
                  <span class="text-[10px] font-mono text-slate-500">Flag: \${fm.status_flag}</span>
                </div>
              </div>
              <p class="text-xs text-slate-400 mt-3.5 leading-relaxed">\${fm.description || 'No description'}</p>
            </div>

            <!-- Interactive 1-Hop Ego Graph Viewer -->
            <div class="border border-slate-800 bg-slate-950/40 rounded-2xl p-4">
              <h3 class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center space-x-1.5">
                <span>📊</span> <span>1-Hop Ego Dependency Graph</span>
              </h3>
              <div id="ego-graph-container" class="w-full flex justify-center bg-slate-950 rounded-xl overflow-hidden border border-slate-900/60">
                <!-- SVG graph renders dynamically below -->
                \${renderEgoGraphSvg(s.filePath, upstreams, downstreams)}
              </div>
              <p class="text-[9px] text-slate-500 mt-2 text-center font-medium italic">Interactive graph: Click on any upstream or downstream node to focus.</p>
            </div>

            <!-- Upstream & Downstream Lists -->
            <div class="grid grid-cols-2 gap-6 border-t border-slate-800/60 pt-5">
              <div>
                <h4 class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2.5">Depends On (Upstream)</h4>
                <ul>\${upstreamListHtml}</ul>
              </div>
              <div>
                <h4 class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2.5">Used By (Downstream)</h4>
                <ul>\${downstreamListHtml}</ul>
              </div>
            </div>

            <!-- Tags & Exports contract -->
            <div class="grid grid-cols-2 gap-6 border-t border-slate-800/60 pt-5">
              <div>
                <h4 class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2.5">Tags</h4>
                <div class="flex flex-wrap gap-1.5">\${tagsHtml}</div>
              </div>
              <div>
                <h4 class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2.5">Exports</h4>
                <div class="flex flex-wrap gap-1.5">\${exportsHtml}</div>
              </div>
            </div>

            <!-- ADR Ledger section -->
            <div class="border-t border-slate-800/60 pt-5">
              <h4 class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">Architectural Decisions (ADR)</h4>
              <div class="space-y-3">\${decisionsHtml}</div>
            </div>

            <!-- Raw body content display -->
            <div class="border-t border-slate-800/60 pt-5">
              <h4 class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">Sidecar Code & Spec Body</h4>
              <pre class="bg-slate-950 border border-slate-800 p-4 rounded-xl text-[11px] font-mono text-slate-300 leading-relaxed overflow-x-auto max-h-[300px] custom-scroll"><code>\${escapeHtml(s.body || '')}</code></pre>
            </div>

          </div>
        \`;
      } catch (err) {
        container.innerHTML = \`<p class="p-6 text-xs text-rose-400 font-semibold">Error: \${err.message || err}</p>\`;
      }
    }

    // Generate Beautiful SVG graph centered on active sidecar node
    function renderEgoGraphSvg(centerNode, upstreams, downstreams) {
      const width = 500;
      const height = 220;

      const cleanLabel = (pathStr) => {
        const parts = pathStr.split('/');
        return parts[parts.length - 1];
      };

      const centerLabel = cleanLabel(centerNode);

      // Node Radius settings
      const centerRad = 35;
      const neighborRad = 26;

      const centerPos = { x: width / 2, y: height / 2 };

      // Spacing out upstream neighbors
      const upPos = upstreams.map((item, idx) => {
        const total = upstreams.length;
        const x = 70;
        const spacing = height / (total + 1);
        const y = spacing * (idx + 1);
        return { item, x, y };
      });

      // Spacing out downstream neighbors
      const downPos = downstreams.map((item, idx) => {
        const total = downstreams.length;
        const x = width - 70;
        const spacing = height / (total + 1);
        const y = spacing * (idx + 1);
        return { item, x, y };
      });

      let svg = \`<svg width="100%" height="\${height}" viewBox="0 0 \${width} \${height}" class="bg-slate-950 text-white font-sans">\`;

      // Draw arrows markers definition
      svg += \`
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="28" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="oklch(0.5 0.2 240)" />
          </marker>
        </defs>
      \`;

      // Draw connection links from upstream to center
      upPos.forEach(p => {
        svg += \`<line x1="\${p.x}" y1="\${p.y}" x2="\${centerPos.x}" y2="\${centerPos.y}" stroke="oklch(0.3 0.05 240)" stroke-width="1.5" marker-end="url(#arrow)" />\`;
      });

      // Draw connection links from center to downstream
      downPos.forEach(p => {
        svg += \`<line x1="\${centerPos.x}" y1="\${centerPos.y}" x2="\${p.x}" y2="\${p.y}" stroke="oklch(0.3 0.05 240)" stroke-width="1.5" marker-end="url(#arrow)" />\`;
      });

      // Render Upstream Nodes
      upPos.forEach(p => {
        const lbl = cleanLabel(p.item);
        svg += \`
          <g onclick="selectSidecar('\${p.item}')" class="cursor-pointer group">
            <circle cx="\${p.x}" cy="\${p.y}" r="\${neighborRad}" fill="oklch(0.2 0.04 240)" stroke="oklch(0.4 0.05 240)" stroke-width="1.5" class="transition-all group-hover:fill-slate-800 group-hover:stroke-indigo-400" />
            <text x="\${p.x}" y="\${p.y + 4}" font-size="9" font-family="monospace" fill="oklch(0.8 0.02 240)" text-anchor="middle" class="pointer-events-none font-semibold">\${lbl.substring(0, 8)}</text>
            <title>\${p.item}</title>
          </g>
        \`;
      });

      // Render Downstream Nodes
      downPos.forEach(p => {
        const lbl = cleanLabel(p.item);
        svg += \`
          <g onclick="selectSidecar('\${p.item}')" class="cursor-pointer group">
            <circle cx="\${p.x}" cy="\${p.y}" r="\${neighborRad}" fill="oklch(0.2 0.04 240)" stroke="oklch(0.4 0.05 240)" stroke-width="1.5" class="transition-all group-hover:fill-slate-800 group-hover:stroke-indigo-400" />
            <text x="\${p.x}" y="\${p.y + 4}" font-size="9" font-family="monospace" fill="oklch(0.8 0.02 240)" text-anchor="middle" class="pointer-events-none font-semibold">\${lbl.substring(0, 8)}</text>
            <title>\${p.item}</title>
          </g>
        \`;
      });

      // Render Center Node
      svg += \`
        <g class="pointer-events-none">
          <circle cx="\${centerPos.x}" cy="\${centerPos.y}" r="\${centerRad}" fill="oklch(0.25 0.12 250)" stroke="oklch(0.5 0.2 240)" stroke-width="2.5" />
          <text x="\${centerPos.x}" y="\${centerPos.y + 4}" font-size="10" font-family="monospace" fill="white" font-weight="bold" text-anchor="middle">\${centerLabel.substring(0, 10)}</text>
          <title>\${centerNode}</title>
        </g>
      \`;

      if (upstreams.length === 0 && downstreams.length === 0) {
        svg += \`<text x="\${width / 2}" y="\${height - 15}" font-size="10" fill="oklch(0.5 0.02 240)" text-anchor="middle" class="italic">No connected neighbors in 1-hop ego scope.</text>\`;
      }

      svg += \`</svg>\`;
      return svg;
    }

    // Helper: Escapes HTML strings safely
    function escapeHtml(text) {
      if (!text) return '';
      return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    // Search Input event handling
    document.getElementById('search-input').addEventListener('input', renderSidecarList);

    // Initial setup triggers
    initWorkspace();
    connectSse();
  </script>
</body>
</html>`;
  }
}

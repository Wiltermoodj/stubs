import { OkfFrontmatter } from '../parser/okf';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as yaml from 'js-yaml';
import { GraphEngine } from '../graph/engine';

export function extractExports(code: string): string[] {
  const exports: string[] = [];
  const regex =
    /^\s*export\s+(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([a-zA-Z0-9_$]+)/gm;
  let match;
  while ((match = regex.exec(code)) !== null) {
    if (match[1]) {
      exports.push(match[1]);
    }
  }
  const namedExportsRegex = /^\s*export\s*\{([^}]+)\}/gm;
  while ((match = namedExportsRegex.exec(code)) !== null) {
    const names = match[1]
      .split(',')
      .map((n) => {
        const parts = n.trim().split(/\s+as\s+/);
        return parts[parts.length - 1].trim();
      })
      .filter(Boolean);
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
                frontmatter: parsed.frontmatter as OkfFrontmatter,
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

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(this.getDashboardHtml());
        return;
      }

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
        const sidecars = await engine.getAllSidecars();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ sidecars, projectName: isRemote ? repo : this.config.project_name }),
        );
        return;
      }

      // GET /api/graph/topology (or /api/v1/graph/topology)
      if (
        (pathname === '/api/graph/topology' || pathname === '/api/v1/graph/topology') &&
        req.method === 'GET'
      ) {
        const { engine } = await this.resolveGraphEngine(parsedUrl);
        const topology = await engine.getTopologyEngine();
        const nodes = topology.getAllNodes();
        const edges = topology.getAllEdges();
        const centralities = Array.from(topology.getNodeCentralities().values());
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ nodes, edges, centralities }));
        return;
      }

      // GET /api/graph/blast (or /api/v1/graph/blast)
      if (
        (pathname === '/api/graph/blast' || pathname === '/api/v1/graph/blast') &&
        req.method === 'GET'
      ) {
        const { engine } = await this.resolveGraphEngine(parsedUrl);
        const target = parsedUrl.searchParams.get('target') || '';
        const depth = parseInt(parsedUrl.searchParams.get('depth') || '3', 10);
        const direction = (parsedUrl.searchParams.get('direction') as any) || 'downstream';
        const topology = await engine.getTopologyEngine();
        const result = topology.getBlastRadius(target, { depth, direction });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      // GET /api/graph/path (or /api/v1/graph/path)
      if (
        (pathname === '/api/graph/path' || pathname === '/api/v1/graph/path') &&
        req.method === 'GET'
      ) {
        const { engine } = await this.resolveGraphEngine(parsedUrl);
        const source = parsedUrl.searchParams.get('source') || '';
        const target = parsedUrl.searchParams.get('target') || '';
        const topology = await engine.getTopologyEngine();
        const result = topology.findShortestPath(source, target);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result || { found: false, source, target }));
        return;
      }

      // GET /api/graph/hotspots (or /api/v1/graph/hotspots)
      if (
        (pathname === '/api/graph/hotspots' || pathname === '/api/v1/graph/hotspots') &&
        req.method === 'GET'
      ) {
        const { engine } = await this.resolveGraphEngine(parsedUrl);
        const topology = await engine.getTopologyEngine();
        const smells = topology.detectSmells();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(smells));
        return;
      }

      // GET Planning Hub state and aggregated task metrics
      if (
        (pathname === '/api/planning' || pathname === '/api/v1/planning') &&
        req.method === 'GET'
      ) {
        const { engine } = await this.resolveGraphEngine(parsedUrl);
        const planningHub = await engine.getPlanningHub();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(planningHub));
        return;
      }

      // GET 5-Phase Lifecycle Matrix and status summary
      if ((pathname === '/api/phases' || pathname === '/api/v1/phases') && req.method === 'GET') {
        const { engine } = await this.resolveGraphEngine(parsedUrl);
        const phaseStatus = await engine.getPhaseStatus();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(phaseStatus));
        return;
      }

      // GET Unified Project File Tree with planned blueprints
      if ((pathname === '/api/tree' || pathname === '/api/v1/tree') && req.method === 'GET') {
        const { engine } = await this.resolveGraphEngine(parsedUrl);
        const includePlanned = parsedUrl.searchParams.get('planned') !== 'false';
        const plannedOnly = parsedUrl.searchParams.get('plannedOnly') === 'true';
        const rootDir = parsedUrl.searchParams.get('dir') || '.';
        const treeData = await engine.getProjectFileTree({ includePlanned, plannedOnly, rootDir });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(treeData));
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

        const notes = (parsed.frontmatter as OkfFrontmatter).user_notes || [];
        notes.push(newNote);
        (parsed.frontmatter as OkfFrontmatter).user_notes = notes;

        const newContent = stringifyOkfSpec(parsed.frontmatter as OkfFrontmatter, parsed.body);
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
            frontmatter: parsed.frontmatter as OkfFrontmatter,
            body: parsed.body,
            fileHash,
          });
        } else {
          await fs.promises.writeFile(resolvedPath, newContent, 'utf8');
          const relativePath = path.relative(process.cwd(), resolvedPath).replace(/\\/g, '/');
          await engine.upsertSidecar({
            filePath: relativePath,
            frontmatter: parsed.frontmatter as OkfFrontmatter,
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

        const notes = (parsed.frontmatter as OkfFrontmatter).user_notes || [];
        const note = notes.find((n) => n.id === id);
        if (!note) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Directive ${id} not found in file` }));
          return;
        }

        note.status = 'resolved';

        const newContent = stringifyOkfSpec(parsed.frontmatter as OkfFrontmatter, parsed.body);
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
            frontmatter: parsed.frontmatter as OkfFrontmatter,
            body: parsed.body,
            fileHash,
          });
        } else {
          await fs.promises.writeFile(resolvedPath, newContent, 'utf8');
          const relativePath = path.relative(process.cwd(), resolvedPath).replace(/\\/g, '/');
          await engine.upsertSidecar({
            filePath: relativePath,
            frontmatter: parsed.frontmatter as OkfFrontmatter,
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
              tplObj!.content,
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
            tplObj!.name = newName;
            tplObj!.isDraft = false;
            tplObj!.version = 'v1.0';

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
        const tags = tagsParam ? (tagsParam as string).split(',').filter(Boolean) : undefined;
        const boundsParam = parsedUrl.searchParams.get('bounds');
        const bounds = boundsParam ? (boundsParam as string).split(',').filter(Boolean) : undefined;

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

        const sidecar = await engine.getSidecar(filePath as string);
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

          const tsFiles = tree
            .filter(
              (entry) =>
                entry.type === 'blob' &&
                entry.path.endsWith('.ts') &&
                !entry.path.endsWith('.d.ts') &&
                !entry.path.startsWith('node_modules/') &&
                !entry.path.startsWith('.git/') &&
                !entry.path.startsWith('.stubs/') &&
                !entry.path.startsWith('dist/') &&
                !entry.path.startsWith('build/'),
            )
            .map((e) => e.path);

          const mdFiles = new Set(
            tree
              .filter((entry) => entry.type === 'blob' && entry.path.endsWith('.ts.md'))
              .map((e) => e.path),
          );

          unbootstrapped = tsFiles.filter((tsFile) => !mdFiles.has(`${tsFile}.md`));
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
            const tpl = cached.find((t) => t.name === templateName);
            if (tpl) {
              templateContent = tpl!.content;
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
        const isSidecar = filename.includes('.') && !filename.endsWith('.md');
        const title = filename
          .replace(/\.[a-zA-Z0-9_-]+$/, '')
          .split(/[-_]/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');

        const templateData = {
          project_name: this.config.project_name || 'stubs',
          version: '1.0.0',
          title: title,
          target_code_file: isSidecar ? `./${filename}` : undefined,
          exports: exportsList,
        };

        const templateEngine = new TemplateEngine(this.config.paths.templates_dir);
        const rendered = templateEngine.renderString(templateContent, templateData);

        const fm: any = {
          title: `${title} Spec`,
          type: isSidecar ? 'sidecar-spec' : 'concept-doc',
          description: `Generated specification for ${title}.`,
          tags: [],
          status: 'skeleton',
          version: 1,
          status_flag: 'clean',
          exports: exportsList,
        };

        if (isSidecar) {
          fm.target_code_file = `./${filename}`;
        }

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
                frontmatter: parsed.frontmatter as OkfFrontmatter,
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
                frontmatter: parsed.frontmatter as OkfFrontmatter,
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

      // ---------------------------------------------------------
      // Fallback: Web Dashboard or 404
      // ---------------------------------------------------------
      if (!pathname.startsWith('/api')) {
        const path = await import('path');
        const pwaIndex = path.resolve(process.cwd(), 'dist', 'web', 'index.html');
        let htmlContent = '';
        if (fs.existsSync(pwaIndex)) {
          htmlContent = fs.readFileSync(pwaIndex, 'utf8');
        } else {
          htmlContent = this.getDashboardHtml();
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(htmlContent);
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

        const sidecars = await this.graphEngine.getAllSidecars();
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

    if (this.debounceTimer && typeof (this.debounceTimer as any).unref === 'function') {
      (this.debounceTimer as any).unref();
    }
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

    const unbootstrapped = tsFiles.filter((tsFile) => {
      const expectedMd = `${tsFile}.md`;
      return !mdFiles.has(expectedMd);
    });

    return { unbootstrapped };
  }

  /**
   * Fallback HTML for the stubs web dashboard portal when dist/web/index.html is not found.
   */
  /**
   * Fallback HTML for the stubs web dashboard portal when dist/web/index.html is not found.
   */
  private getDashboardHtml(): string {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Stubs Spec Manager (PWA)</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; }
    h1 { color: #38bdf8; font-size: 1.5rem; }
    code { background: #1e293b; padding: 0.2rem 0.4rem; border-radius: 4px; color: #fbbf24; }
  </style>
</head>
<body>
  <h1>Stubs Spec Manager (PWA)</h1>
  <p>Dashboard portal active. Please run <code>npm run build:web</code> to compile the complete PWA client bundle.</p>
</body>
</html>`;
  }
}

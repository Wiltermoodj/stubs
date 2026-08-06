import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { GraphEngine } from '../graph/engine';
import { loadConfig, StubsConfig } from '../config/schema';

export class PortalServer {
  private port: number;
  private graphEngine: GraphEngine;
  private config: StubsConfig;
  private server: http.Server | null = null;
  private watcher: fs.FSWatcher | null = null;
  private clients: http.ServerResponse[] = [];
  private debounceTimer: NodeJS.Timeout | null = null;

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

    this.server = http.createServer((req, res) => {
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
   * Handle incoming HTTP requests.
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // 1. Dashboard UI Root
      if (pathname === '/' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(this.getDashboardHtml());
        return;
      }

      // 2. SSE Event Stream
      if (pathname === '/api/events' && req.method === 'GET') {
        this.registerSseClient(req, res);
        return;
      }

      // 3. API endpoints
      if (pathname === '/api/graph' && req.method === 'GET') {
        const files = await this.graphEngine.getFilesIndexed();
        const sidecars = [];
        for (const file of files) {
          const sidecar = await this.graphEngine.getSidecar(file);
          if (sidecar) {
            sidecars.push(sidecar);
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sidecars, projectName: this.config.project_name }));
        return;
      }

      if (pathname === '/api/directives' && req.method === 'GET') {
        const directives = await this.graphEngine.getPendingDirectives();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ directives }));
        return;
      }

      if (pathname === '/api/search' && req.method === 'GET') {
        const q = parsedUrl.searchParams.get('q') || '';
        const tagsParam = parsedUrl.searchParams.get('tags');
        const tags = tagsParam ? tagsParam.split(',').filter(Boolean) : undefined;
        const boundsParam = parsedUrl.searchParams.get('bounds');
        const bounds = boundsParam ? boundsParam.split(',').filter(Boolean) : undefined;

        const results = await this.graphEngine.search(q, { tags, bounds });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results }));
        return;
      }

      if (pathname === '/api/sidecar' && req.method === 'GET') {
        const filePath = parsedUrl.searchParams.get('path');
        if (!filePath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing path parameter' }));
          return;
        }

        const sidecar = await this.graphEngine.getSidecar(filePath);
        if (!sidecar) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Sidecar specification not found' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sidecar }));
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

        this.broadcast('update', {
          sidecars,
          directives,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        console.error('[Watcher] Re-indexing failed:', err.message || err);
      }
    }, 150);
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
    body {
      background-color: #0f172a;
      color: #e2e8f0;
    }
    .custom-scroll::-webkit-scrollbar {
      width: 6px;
    }
    .custom-scroll::-webkit-scrollbar-track {
      background: #1e293b;
    }
    .custom-scroll::-webkit-scrollbar-thumb {
      background: #475569;
      border-radius: 3px;
    }
  </style>
</head>
<body class="font-sans min-h-screen flex flex-col">

  <!-- Header -->
  <header class="border-b border-slate-800 bg-slate-900/50 backdrop-blur px-6 py-4 flex items-center justify-between shadow-sm">
    <div class="flex items-center space-x-3">
      <span class="text-2xl">🧩</span>
      <div>
        <h1 class="text-xl font-bold tracking-tight text-white flex items-center space-x-2">
          <span>stubs Web Portal</span>
          <span class="text-xs bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded-full font-mono">v1.3.0</span>
        </h1>
        <p class="text-xs text-slate-400">Project: <span id="project-name" class="font-mono text-slate-300">stubs-project</span></p>
      </div>
    </div>
    <div class="flex items-center space-x-4">
      <div id="connection-badge" class="flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium border border-red-500/20 bg-red-500/10 text-red-400 transition-colors duration-300">
        <span class="h-2 w-2 rounded-full bg-red-500 animate-pulse" id="connection-dot"></span>
        <span id="connection-text">Disconnected</span>
      </div>
      <div class="text-right text-xs text-slate-400">
        <p>Last Updated</p>
        <p id="last-updated" class="font-mono text-slate-300">Never</p>
      </div>
    </div>
  </header>

  <!-- Main Workspace -->
  <main class="flex-1 flex overflow-hidden">

    <!-- Left Sidebar: List & Search -->
    <div class="w-2/5 border-r border-slate-800 flex flex-col bg-slate-900/20">

      <!-- Search Input -->
      <div class="p-4 border-b border-slate-800/80 bg-slate-900/10">
        <div class="relative">
          <input
            type="text"
            id="search-input"
            placeholder="Search sidecars by text, tags, or bounds..."
            class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
          />
          <div class="absolute right-3 top-2.5 text-xs text-slate-500 font-mono pointer-events-none" id="search-count">0 files</div>
        </div>
      </div>

      <!-- Scrollable content -->
      <div class="flex-1 overflow-y-auto custom-scroll p-4 space-y-6">

        <!-- Sidecar Files List -->
        <div>
          <h2 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Specification Sidecars</h2>
          <div id="sidecars-list" class="space-y-2">
            <!-- Dynamic entries -->
            <p class="text-sm text-slate-500 italic p-2">No files indexed yet.</p>
          </div>
        </div>

        <!-- Pending Directives -->
        <div class="border-t border-slate-800/60 pt-5">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Pending Human Directives</h2>
            <span id="directives-count" class="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full font-mono">0</span>
          </div>
          <div id="directives-list" class="space-y-3">
            <!-- Dynamic directives -->
            <p class="text-sm text-slate-500 italic p-2">No pending directives.</p>
          </div>
        </div>

      </div>

    </div>

    <!-- Right Content: Detailed Sidecar View -->
    <div class="w-3/5 flex flex-col bg-slate-950/20 overflow-y-auto custom-scroll" id="detail-view">
      <div class="flex-1 flex flex-col items-center justify-center text-slate-500 p-8">
        <span class="text-4xl mb-4">🔍</span>
        <h3 class="text-lg font-medium text-slate-300">No Specification Selected</h3>
        <p class="text-sm max-w-sm text-center mt-1 text-slate-400">Select a sidecar file from the list to explore its detailed metadata, ADRs, exports, and implementation details.</p>
      </div>
    </div>

  </main>

  <script>
    let sidecars = [];
    let directives = [];
    let selectedPath = null;

    // Connect to SSE Bridge
    function connectSse() {
      const sse = new EventSource('/api/events');
      const badge = document.getElementById('connection-badge');
      const dot = document.getElementById('connection-dot');
      const text = document.getElementById('connection-text');

      sse.onopen = () => {
        badge.className = "flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 transition-colors duration-300";
        dot.className = "h-2 w-2 rounded-full bg-emerald-500 animate-pulse";
        text.textContent = "Connected";
      };

      sse.onerror = () => {
        badge.className = "flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium border border-red-500/20 bg-red-500/10 text-red-400 transition-colors duration-300";
        dot.className = "h-2 w-2 rounded-full bg-red-500 animate-pulse";
        text.textContent = "Disconnected";
      };

      sse.addEventListener('update', (e) => {
        const data = JSON.parse(e.data);
        sidecars = data.sidecars;
        directives = data.directives;
        document.getElementById('last-updated').textContent = new Date(data.timestamp).toLocaleTimeString();
        render();
        if (selectedPath) {
          fetchAndShowSidecarDetail(selectedPath);
        }
      });
    }

    // Fetch initial data
    async function initData() {
      try {
        const [graphRes, dirRes] = await Promise.all([
          fetch('/api/graph'),
          fetch('/api/directives')
        ]);
        const graphData = await graphRes.json();
        const dirData = await dirRes.json();

        sidecars = graphData.sidecars;
        directives = dirData.directives;
        document.getElementById('project-name').textContent = graphData.projectName || 'stubs-project';
        document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();

        render();
      } catch (err) {
        console.error('Failed to load initial data:', err);
      }
    }

    // Render Sidebars & Lists
    function render() {
      const searchVal = document.getElementById('search-input').value.toLowerCase();

      // Filter Sidecars
      const filtered = sidecars.filter(s => {
        const titleMatch = s.frontmatter.title?.toLowerCase().includes(searchVal);
        const pathMatch = s.filePath.toLowerCase().includes(searchVal);
        const descMatch = s.frontmatter.description?.toLowerCase().includes(searchVal);
        const tagsMatch = s.frontmatter.tags?.some(t => t.toLowerCase().includes(searchVal));
        return titleMatch || pathMatch || descMatch || tagsMatch;
      });

      document.getElementById('search-count').textContent = \`\${filtered.length} files\`;

      // Render Sidecar List
      const listEl = document.getElementById('sidecars-list');
      if (filtered.length === 0) {
        listEl.innerHTML = '<p class="text-sm text-slate-500 italic p-2">No matching specifications found.</p>';
      } else {
        listEl.innerHTML = filtered.map(s => {
          const isSelected = s.filePath === selectedPath;
          const statusBg = s.frontmatter.status === 'materialized' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20';
          const flagBg = s.frontmatter.status_flag === 'clean' ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20';

          return \`
            <div
              onclick="selectSidecar('\${s.filePath}')"
              class="p-3.5 rounded-lg border \${isSelected ? 'bg-slate-800/70 border-indigo-500/80' : 'bg-slate-900/40 border-slate-800/80 hover:bg-slate-800/30 hover:border-slate-700/60'} cursor-pointer transition-all duration-150"
            >
              <div class="flex items-start justify-between">
                <h4 class="text-sm font-semibold text-white truncate max-w-[200px]">\${s.frontmatter.title || 'Untitled'}</h4>
                <span class="text-[10px] font-mono border px-1.5 py-0.5 rounded-full \${statusBg}">\${s.frontmatter.status}</span>
              </div>
              <p class="text-xs font-mono text-slate-400 mt-1 truncate">\${s.filePath}</p>
              <p class="text-xs text-slate-400 mt-2 line-clamp-2">\${s.frontmatter.description || ''}</p>
              <div class="flex items-center space-x-2 mt-3">
                <span class="text-[10px] font-mono border px-1.5 py-0.5 rounded-full \${flagBg}">\${s.frontmatter.status_flag}</span>
                \${s.frontmatter.tags?.slice(0, 2).map(t => \`<span class="text-[10px] font-mono bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded-full">#\${t}</span>\`).join('') || ''}
              </div>
            </div>
          \`;
        }).join('');
      }

      // Render Directives
      const dirEl = document.getElementById('directives-list');
      document.getElementById('directives-count').textContent = directives.length;
      if (directives.length === 0) {
        dirEl.innerHTML = '<p class="text-sm text-slate-500 italic p-2">No pending directives.</p>';
      } else {
        dirEl.innerHTML = directives.map(d => \`
          <div class="p-3 bg-slate-900/65 border border-slate-800/80 rounded-lg">
            <div class="flex items-center justify-between mb-1.5">
              <span class="text-xs font-mono text-amber-400 font-semibold">\${d.id}</span>
              <span class="text-[10px] font-mono text-slate-500">\${new Date(d.timestamp).toLocaleString()}</span>
            </div>
            <p class="text-xs text-slate-300">\${d.text}</p>
            <p class="text-[10px] font-mono text-slate-400 mt-2">Source: <span class="text-indigo-400 cursor-pointer hover:underline" onclick="selectSidecar('\${d.filePath}')">\${d.filePath}</span></p>
          </div>
        \`).join('');
      }
    }

    // Select a Sidecar & Display detail
    function selectSidecar(filePath) {
      selectedPath = filePath;
      render();
      fetchAndShowSidecarDetail(filePath);
    }

    // Fetch detail from REST API
    async function fetchAndShowSidecarDetail(filePath) {
      const detailView = document.getElementById('detail-view');
      try {
        const res = await fetch(\`/api/sidecar?path=\${encodeURIComponent(filePath)}\`);
        const data = await res.json();

        if (data.error) {
          detailView.innerHTML = \`
            <div class="p-6 text-red-400 font-semibold">Error: \${data.error}</div>
          \`;
          return;
        }

        const s = data.sidecar;

        const tags = s.frontmatter.tags?.map(t => \`
          <span class="text-xs font-mono bg-slate-900 border border-slate-800 text-slate-300 px-2.5 py-1 rounded-md">#\${t}</span>
        \`).join('') || '<span class="text-xs text-slate-500 italic">None</span>';

        const exportsList = s.frontmatter.exports?.map(e => \`
          <span class="text-xs font-mono bg-emerald-950/20 border border-emerald-800/30 text-emerald-400 px-2.5 py-1 rounded-md">\${e}</span>
        \`).join('') || '<span class="text-xs text-slate-500 italic">None</span>';

        const adrs = s.frontmatter.decisions?.map(d => \`
          <div class="p-3 bg-slate-900/40 border border-slate-800 rounded-lg">
            <div class="flex items-center space-x-2 mb-1">
              <span class="text-xs font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-1.5 py-0.5 rounded">\${d.id}</span>
              <span class="text-xs text-slate-400 font-mono">\${d.date || 'No Date'}</span>
            </div>
            <p class="text-xs text-slate-200 mt-1.5 font-medium">\${d.summary}</p>
          </div>
        \`).join('') || '<p class="text-xs text-slate-500 italic">No Architectural Decision Records documented.</p>';

        const deps = s.frontmatter.depends_on?.map(d => \`
          <li class="text-xs font-mono text-indigo-400 cursor-pointer hover:underline mb-1.5 flex items-center space-x-1.5" onclick="selectSidecar('\${d}')">
            <span>🔌</span> <span>\${d}</span>
          </li>
        \`).join('') || '<p class="text-xs text-slate-500 italic">No depends_on constraints.</p>';

        const users = s.frontmatter.used_by?.map(u => \`
          <li class="text-xs font-mono text-indigo-400 cursor-pointer hover:underline mb-1.5 flex items-center space-x-1.5" onclick="selectSidecar('\${u}')">
            <span>⚙️</span> <span>\${u}</span>
          </li>
        \`).join('') || '<p class="text-xs text-slate-500 italic">No used_by downstream dependents.</p>';

        detailView.innerHTML = \`
          <div class="p-6 space-y-6">

            <!-- Sidecar Title & Subinfo -->
            <div class="border-b border-slate-800/80 pb-5">
              <div class="flex items-start justify-between">
                <div>
                  <h2 class="text-xl font-bold text-white tracking-tight">\${s.frontmatter.title || 'Untitled'}</h2>
                  <p class="text-xs font-mono text-slate-400 mt-1.5">\${s.filePath}</p>
                </div>
                <div class="flex flex-col items-end space-y-1.5">
                  <span class="text-xs font-mono border px-2.5 py-1 rounded-full bg-slate-800 text-indigo-400 border-slate-700 font-semibold">Status: \${s.frontmatter.status}</span>
                  <span class="text-[10px] font-mono text-slate-500">v\${s.frontmatter.version || 1}</span>
                </div>
              </div>
              <p class="text-sm text-slate-300 mt-4 leading-relaxed">\${s.frontmatter.description || 'No description provided.'}</p>
            </div>

            <!-- Tags & Exports -->
            <div class="grid grid-cols-2 gap-4">
              <div>
                <h4 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">Metadata Tags</h4>
                <div class="flex flex-wrap gap-1.5">\${tags}</div>
              </div>
              <div>
                <h4 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">Exports Contract</h4>
                <div class="flex flex-wrap gap-1.5">\${exportsList}</div>
              </div>
            </div>

            <!-- ADR Ledger -->
            <div>
              <h4 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">Architectural Decisions (ADR)</h4>
              <div class="space-y-2">\${adrs}</div>
            </div>

            <!-- Graph Topology -->
            <div class="grid grid-cols-2 gap-4 border-t border-slate-800/60 pt-5">
              <div>
                <h4 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">Depends On (Upstream)</h4>
                <ul>\${deps}</ul>
              </div>
              <div>
                <h4 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">Used By (Downstream)</h4>
                <ul>\${users}</ul>
              </div>
            </div>

            <!-- Implementation / Sidecar Body -->
            <div class="border-t border-slate-800/60 pt-5">
              <h4 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Sidecar Specifications & Implementation</h4>
              <pre class="bg-slate-950 border border-slate-800/80 p-4 rounded-lg overflow-x-auto text-xs text-slate-300 font-mono leading-relaxed max-h-[400px] custom-scroll"><code>\${escapeHtml(s.body || '')}</code></pre>
            </div>

          </div>
        \`;
      } catch (err) {
        detailView.innerHTML = \`
          <div class="p-6 text-red-400 font-semibold">Failed to fetch sidecar: \${err.message || err}</div>
        \`;
      }
    }

    function escapeHtml(text) {
      return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    // Handle search typing
    document.getElementById('search-input').addEventListener('input', render);

    // Initial setup
    initData();
    connectSse();
  </script>
</body>
</html>`;
  }
}

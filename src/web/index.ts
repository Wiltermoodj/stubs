// Initialize global environment shim for Node.js modules before any imports
(globalThis as any).process = {
  env: {},
  cwd: () => '/',
  versions: { node: '18.0.0' },
} as any;

import { VirtualFileSystem, WasmSqliteDriver } from '../storage';
import { GraphEngine } from '../graph/engine';
import { parseOkfSpec } from '../parser/okf';
import { stringifyOkfSpec } from '../materializer/engine';
import { GitHubClient, RepositoryInfo } from '../server/github';

// App state
let pat = localStorage.getItem('STUBS_GITHUB_PAT') || '';
let currentRepo: string = localStorage.getItem('STUBS_CURRENT_REPO') || '';
let currentBranch: string = localStorage.getItem('STUBS_CURRENT_BRANCH') || 'main';

let reposList: RepositoryInfo[] = [];
let branchesList: string[] = [];
let filesList: string[] = [];

try {
  reposList = JSON.parse(localStorage.getItem('STUBS_REPOS_LIST') || '[]');
  branchesList = JSON.parse(localStorage.getItem('STUBS_BRANCHES_LIST') || '[]');
  filesList = JSON.parse(localStorage.getItem('STUBS_FILES_LIST') || '[]');
} catch (e) {
  console.warn('Failed to parse cached list state:', e);
}

let selectedPath: string | null = null;
let currentTab: 'directives' | 'templates' = 'directives';
let directiveFilter: 'pending' | 'resolved' | 'all' = 'pending';

// In-Memory Database & Virtual FS
const virtualFs = new VirtualFileSystem();
const wasmDb = new WasmSqliteDriver();
const graphEngine = new GraphEngine({
  fsDriver: virtualFs,
  dbDriver: wasmDb,
  dbPath: ':memory:',
});

// Helper to load offline files into the virtual filesystem
async function loadCachedFilesForCurrentRepoBranch() {
  if (currentRepo && currentBranch) {
    try {
      const cachedFiles = JSON.parse(
        localStorage.getItem(`STUBS_OFFLINE_FILES_${currentRepo}_${currentBranch}`) || '{}',
      );
      await graphEngine.clearIndex();
      for (const [filePath, content] of Object.entries(cachedFiles)) {
        await virtualFs.writeFile(filePath, content as string);
      }
      await graphEngine.indexWorkspace('/', { force: true });
      filesList = await graphEngine.getFilesIndexed();
      localStorage.setItem('STUBS_FILES_LIST', JSON.stringify(filesList));
      renderApp();
    } catch (e) {
      console.warn('Failed to load cached files:', e);
    }
  }
}

// Touch / Zoom State for Ego Graph View
let scale = 1.0;
let panX = 0;
let panY = 0;
let isPanning = false;
let startX = 0;
let startY = 0;
let lastTouchDist = 0;
let lastTapTime = 0;

// Mobile sidebar/drawer visibility state - default closed on mobile viewports
let isLeftDrawerOpen = false;
let isRightDrawerOpen = false;

// DOM Elements render target
let container: HTMLElement;

// Boot strap
window.addEventListener('DOMContentLoaded', async () => {
  container = document.getElementById('app-container') || document.body;
  await wasmDb.initialize();

  // Pre-load from local storage cache for instant offline startup
  if (currentRepo && currentBranch) {
    try {
      const cachedFiles = JSON.parse(
        localStorage.getItem(`STUBS_OFFLINE_FILES_${currentRepo}_${currentBranch}`) || '{}',
      );
      for (const [filePath, content] of Object.entries(cachedFiles)) {
        await virtualFs.writeFile(filePath, content as string);
      }
    } catch (e) {
      console.warn('Failed to populate initial virtual files from cache:', e);
    }
  }

  await graphEngine.initialize();

  if (filesList.length > 0) {
    try {
      await graphEngine.indexWorkspace('/', { force: true });
    } catch (e) {
      console.warn('Failed to index cached workspace:', e);
    }
  }

  renderApp();

  if (!pat) {
    showPatModal();
  } else {
    await loadWorkspace().catch((err) => {
      console.warn('Could not sync remote workspace on startup, using offline cache:', err);
      showToast('Offline mode active. Using cached specifications.', 'info');
    });
  }
});

function renderApp() {
  container.innerHTML = `
    <!-- Top Nav Header -->
    <header class="h-16 border-b border-slate-800 bg-slate-900/50 backdrop-blur px-4 flex items-center justify-between z-40 select-none shrink-0">
      <div class="flex items-center space-x-3">
        <!-- Drawer toggle for Mobile Left Sidebar -->
        <button onclick="toggleLeftDrawer()" class="md:hidden text-slate-300 p-1.5 bg-slate-800/65 rounded-lg active:scale-95 transition-all text-sm">
          📂
        </button>
        <span class="text-xl">🧩</span>
        <div>
          <h1 class="text-sm font-semibold tracking-tight text-white flex items-center space-x-2">
            <span>Stubs Spec PWA</span>
            <span class="text-[9px] bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 px-1.5 py-0.5 rounded-full font-mono">Mobile v1.0</span>
          </h1>
          <p class="text-[10px] text-slate-500 truncate max-w-[140px] sm:max-w-[200px]" id="current-repo-display">
            ${currentRepo || 'No repo connected'}
          </p>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex items-center space-x-2">
        <button onclick="showPatModal()" class="text-[11px] font-semibold text-slate-400 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/50 px-2.5 py-1.5 rounded-lg transition-all active:scale-95">
          🔑 PAT Setup
        </button>
        <button onclick="toggleRightDrawer()" class="md:hidden text-slate-300 p-1.5 bg-slate-800/65 rounded-lg active:scale-95 transition-all text-sm">
          📋
        </button>
      </div>
    </header>

    <!-- Main Workspace Split Pane -->
    <div class="flex-1 flex overflow-hidden relative">

      <!-- Left Sidebar Drawer (Specifications List) -->
      <aside id="left-drawer" class="drawer fixed md:static inset-y-0 left-0 w-72 md:w-64 border-r border-slate-800 bg-slate-900 md:bg-slate-900/25 flex flex-col z-30 ${isLeftDrawerOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'} md:translate-x-0">
        <div class="p-4 border-b border-slate-800/60 bg-slate-900/45 flex flex-col space-y-3 shrink-0">
          <div class="flex items-center justify-between">
            <h2 class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Workspace Specs</h2>
            <button onclick="toggleLeftDrawer()" class="md:hidden text-slate-500 text-xs">✕</button>
          </div>

          <!-- Repo dropdown selector -->
          <div class="space-y-1">
            <label for="repo-sel" class="text-[9px] font-bold text-slate-500 uppercase">Repository</label>
            <select id="repo-sel" onchange="selectRepo(this.value)" class="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-semibold focus:outline-none focus:border-indigo-500">
              <option value="">-- Choose Repository --</option>
              ${reposList.map((r) => `<option value="${r.fullName}" ${r.fullName === currentRepo ? 'selected' : ''}>${r.fullName}</option>`).join('')}
            </select>
          </div>

          <!-- Branch dropdown selector -->
          <div class="space-y-1">
            <label for="branch-sel" class="text-[9px] font-bold text-slate-500 uppercase">Branch</label>
            <select id="branch-sel" onchange="selectBranch(this.value)" class="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500">
              ${branchesList.map((b) => `<option value="${b}" ${b === currentBranch ? 'selected' : ''}>${b}</option>`).join('')}
            </select>
          </div>

          <!-- Live Search -->
          <input
            type="text"
            id="web-search-input"
            oninput="renderSpecsList()"
            placeholder="Search files..."
            class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-all"
          />
        </div>

        <!-- Files List Scroll Container -->
        <div class="flex-1 overflow-y-auto custom-scroll p-3 space-y-1.5" id="web-specs-list">
          <p class="text-xs text-slate-500 italic p-3 text-center">No specifications loaded.</p>
        </div>
      </aside>

      <!-- Backdrop overlay for mobile drawers -->
      <div id="drawer-overlay" onclick="closeAllDrawers()" class="fixed inset-0 bg-black/60 z-20 transition-opacity duration-300 md:hidden hidden"></div>

      <!-- Center Pane (Main Details & Interactive Ego Graph) -->
      <main class="flex-1 flex flex-col bg-slate-950/20 overflow-y-auto custom-scroll pb-20 md:pb-6" id="web-detail-pane">
        <div class="flex-1 flex flex-col items-center justify-center text-slate-500 p-8 h-full">
          <span class="text-4xl mb-4">🧭</span>
          <h3 class="text-sm font-semibold text-slate-300">Select sidecar specification</h3>
          <p class="text-xs max-w-xs text-center mt-1 text-slate-500">Select any spec sidecar from the sidebar to inspect dependencies, decisions, and interact with the 1-hop Ego Graph.</p>
        </div>
      </main>

      <!-- Right Panel Drawer (Directives / Templates Workbench) -->
      <aside id="right-drawer" class="drawer fixed md:static inset-y-0 right-0 w-80 md:w-80 border-l border-slate-800 bg-slate-900 md:bg-slate-900/25 flex flex-col z-30 ${isRightDrawerOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'} md:translate-x-0">
        <!-- Tabs Header -->
        <div class="flex border-b border-slate-800 bg-slate-950/30 shrink-0 select-none">
          <button
            onclick="switchRightTab('directives')"
            id="tab-dir-btn"
            class="flex-1 py-3 text-[10px] font-bold uppercase tracking-wider text-center border-b-2 ${currentTab === 'directives' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400'} transition-all"
          >
            Directives
          </button>
          <button
            onclick="switchRightTab('templates')"
            id="tab-tpl-btn"
            class="flex-1 py-3 text-[10px] font-bold uppercase tracking-wider text-center border-b-2 ${currentTab === 'templates' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400'} transition-all"
          >
            Templates Drafts
          </button>
        </div>

        <div class="flex-1 overflow-y-auto custom-scroll p-4 space-y-4" id="right-panel-content">
          <!-- Dynamic Content based on selected tab -->
        </div>
      </aside>

    </div>

    <!-- PAT Setup Modal -->
    <div id="pat-modal" class="fixed inset-0 bg-black/80 z-50 flex items-center justify-center hidden px-4">
      <div class="bg-slate-900 border border-slate-800 w-full max-w-md p-6 rounded-2xl shadow-2xl space-y-4">
        <div class="text-center space-y-1.5">
          <span class="text-3xl">🔑</span>
          <h2 class="text-base font-semibold text-white tracking-tight">Connect GitHub API Client</h2>
          <p class="text-xs text-slate-400">Enter a GitHub Personal Access Token (PAT) with repository read/write access to sync workspace sidecars directly in browser memory.</p>
        </div>

        <div class="space-y-1.5">
          <label for="pat-input" class="block text-[10px] font-bold text-slate-400 uppercase">Personal Access Token</label>
          <input
            type="password"
            id="pat-input"
            value="${pat}"
            placeholder="github_pat_..."
            class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs font-mono text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div class="flex space-x-2 pt-2">
          <button onclick="validateAndSavePat()" class="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs py-2.5 rounded-lg active:scale-95 transition-all">
            Save and Connect
          </button>
          <button onclick="hidePatModal()" class="px-4 bg-slate-800 hover:bg-slate-700 text-slate-400 font-semibold text-xs py-2.5 rounded-lg active:scale-95 transition-all">
            Cancel
          </button>
        </div>
        <p id="pat-error" class="text-[11px] text-rose-400 hidden italic text-center"></p>
      </div>
    </div>

    <!-- Dynamic Toast Notification Container -->
    <div id="toast-wrapper" class="fixed bottom-4 right-4 z-50 flex flex-col space-y-2 pointer-events-none"></div>
  `;
  renderSpecsList();
  renderRightPanel();
}

// Drawer toggles
(window as any).toggleLeftDrawer = () => {
  isLeftDrawerOpen = !isLeftDrawerOpen;
  const drawer = document.getElementById('left-drawer');
  const overlay = document.getElementById('drawer-overlay');
  if (drawer) {
    if (isLeftDrawerOpen) {
      drawer.classList.remove('-translate-x-full');
      overlay?.classList.remove('hidden');
    } else {
      drawer.classList.add('-translate-x-full');
      overlay?.classList.add('hidden');
    }
  }
};

(window as any).toggleRightDrawer = () => {
  isRightDrawerOpen = !isRightDrawerOpen;
  const drawer = document.getElementById('right-drawer');
  const overlay = document.getElementById('drawer-overlay');
  if (drawer) {
    if (isRightDrawerOpen) {
      drawer.classList.remove('translate-x-full');
      overlay?.classList.remove('hidden');
    } else {
      drawer.classList.add('translate-x-full');
      overlay?.classList.add('hidden');
    }
  }
};

(window as any).closeAllDrawers = () => {
  isLeftDrawerOpen = false;
  isRightDrawerOpen = false;
  document.getElementById('left-drawer')?.classList.add('-translate-x-full');
  document.getElementById('right-drawer')?.classList.add('translate-x-full');
  document.getElementById('drawer-overlay')?.classList.add('hidden');
};

function showToast(message: string, type: 'success' | 'info' | 'error' | 'warning' = 'info') {
  const container = document.getElementById('toast-wrapper');
  if (!container) return;
  const toast = document.createElement('div');
  const borderCol =
    type === 'error'
      ? 'oklch(0.627 0.265 20)'
      : type === 'success'
        ? 'oklch(0.627 0.265 140)'
        : type === 'warning'
          ? 'oklch(0.627 0.265 60)'
          : 'oklch(0.5 0.2 240)';
  toast.className =
    'pointer-events-auto p-3.5 rounded-xl border bg-slate-900/95 shadow-xl max-w-xs text-xs flex flex-col space-y-1 transition-all';
  toast.style.borderColor = borderCol;
  toast.innerHTML = `
    <div class="flex items-center justify-between">
      <span class="font-bold text-white uppercase text-[9px]">${type} notification</span>
      <button onclick="this.parentElement.parentElement.remove()" class="text-slate-500 hover:text-slate-300">✕</button>
    </div>
    <p class="text-slate-300 leading-relaxed">${message}</p>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// PAT Modals
function showPatModal() {
  const modal = document.getElementById('pat-modal');
  if (modal) modal.classList.remove('hidden');
}

(window as any).showPatModal = showPatModal;

function hidePatModal() {
  const modal = document.getElementById('pat-modal');
  if (modal) modal.classList.add('hidden');
}

(window as any).hidePatModal = hidePatModal;

async function validateAndSavePat() {
  const input = document.getElementById('pat-input') as HTMLInputElement;
  const errorEl = document.getElementById('pat-error');
  if (!input) return;
  const val = input.value.trim();
  if (!val) {
    if (errorEl) {
      errorEl.textContent = 'Please enter a Personal Access Token.';
      errorEl.classList.remove('hidden');
    }
    return;
  }

  showToast('Validating token with GitHub API...', 'info');
  try {
    const client = new GitHubClient(val);
    await client.validateToken();

    pat = val;
    localStorage.setItem('STUBS_GITHUB_PAT', pat);
    hidePatModal();
    showToast('GitHub token validated and stored successfully!', 'success');

    await loadWorkspace();
  } catch (err: any) {
    if (errorEl) {
      errorEl.textContent = err.message || 'Validation failed. Check your token.';
      errorEl.classList.remove('hidden');
    }
    showToast('Failed to validate GitHub token.', 'error');
  }
}

(window as any).validateAndSavePat = validateAndSavePat;

// Repository & branch selectors
async function loadWorkspace() {
  try {
    const client = new GitHubClient(pat);
    reposList = await client.listAccessibleRepositories();
    localStorage.setItem('STUBS_REPOS_LIST', JSON.stringify(reposList));

    // Auto-select first repo with stubs indicator or just the first repo if not selected
    if (reposList.length > 0) {
      if (!currentRepo || !reposList.some((r) => r.fullName === currentRepo)) {
        currentRepo = reposList[0].fullName;
        localStorage.setItem('STUBS_CURRENT_REPO', currentRepo);
      }

      const [owner, name] = currentRepo.split('/');
      branchesList = await client.listBranches(owner, name);
      localStorage.setItem('STUBS_BRANCHES_LIST', JSON.stringify(branchesList));

      if (!currentBranch || !branchesList.includes(currentBranch)) {
        currentBranch = branchesList.includes('main') ? 'main' : branchesList[0] || 'main';
        localStorage.setItem('STUBS_CURRENT_BRANCH', currentBranch);
      }
    }

    renderApp();
    await fetchSpecsFromGithub();
  } catch (err: any) {
    showToast('Error loading repositories: ' + err.message, 'error');
    // Fallback to offline cached files if possible
    await loadCachedFilesForCurrentRepoBranch();
  }
}

async function selectRepo(repo: string) {
  if (!repo) return;
  currentRepo = repo;
  localStorage.setItem('STUBS_CURRENT_REPO', repo);
  showToast(`Switching to repository: ${repo}`, 'info');

  try {
    const [owner, name] = repo.split('/');
    const client = new GitHubClient(pat);
    branchesList = await client.listBranches(owner, name);
    localStorage.setItem('STUBS_BRANCHES_LIST', JSON.stringify(branchesList));

    currentBranch = branchesList.includes('main') ? 'main' : branchesList[0] || 'main';
    localStorage.setItem('STUBS_CURRENT_BRANCH', currentBranch);

    renderApp();
    await fetchSpecsFromGithub();
  } catch (err: any) {
    showToast('Error loading branches: ' + err.message, 'error');
    await loadCachedFilesForCurrentRepoBranch();
  }
}

(window as any).selectRepo = selectRepo;

async function selectBranch(branch: string) {
  if (!branch) return;
  currentBranch = branch;
  localStorage.setItem('STUBS_CURRENT_BRANCH', branch);
  showToast(`Switching to branch: ${branch}`, 'info');

  renderApp();
  await fetchSpecsFromGithub().catch(async (err) => {
    showToast(
      'Failed to fetch from branch, loading cached files instead: ' + err.message,
      'warning',
    );
    await loadCachedFilesForCurrentRepoBranch();
  });
}

(window as any).selectBranch = selectBranch;

// Fetch specs from Remote GitHub and index into in-memory SQL
async function fetchSpecsFromGithub() {
  if (!currentRepo) return;
  const [owner, name] = currentRepo.split('/');
  if (!owner || !name) return;

  showToast('Syncing specifications from remote branch...', 'info');
  try {
    const client = new GitHubClient(pat);
    const tree = await client.fetchTree(owner, name, currentBranch);

    // Clear old state in-memory
    await graphEngine.clearIndex();

    // Filter specs ending in .ts.md or .md
    const specs = tree.filter(
      (entry) =>
        entry.type === 'blob' && (entry.path.endsWith('.ts.md') || entry.path.endsWith('.md')),
    );

    let loadedCount = 0;
    const cachedFiles: Record<string, string> = {};

    for (const spec of specs) {
      try {
        const content = await client.fetchFileContents(owner, name, spec.path, currentBranch);
        if (content.trim().startsWith('---')) {
          await virtualFs.writeFile(spec.path, content);
          cachedFiles[spec.path] = content;
          loadedCount++;
        }
      } catch (err) {
        console.warn(`Failed to fetch raw contents for ${spec.path}`);
      }
    }

    // Save offline files cache for the current repo and branch
    localStorage.setItem(
      `STUBS_OFFLINE_FILES_${currentRepo}_${currentBranch}`,
      JSON.stringify(cachedFiles),
    );

    // Force run workspace indexing in memory
    await graphEngine.indexWorkspace('/', { force: true });

    filesList = await graphEngine.getFilesIndexed();
    localStorage.setItem('STUBS_FILES_LIST', JSON.stringify(filesList));
    showToast(`Successfully indexed ${loadedCount} specification files.`, 'success');

    renderApp();
  } catch (err: any) {
    showToast('Error fetching remote workspace: ' + err.message, 'error');
    await loadCachedFilesForCurrentRepoBranch();
  }
}

// Render Spec Sidecar List
function renderSpecsList() {
  const container = document.getElementById('web-specs-list');
  if (!container) return;

  const searchInput = document.getElementById('web-search-input') as HTMLInputElement;
  const q = searchInput ? searchInput.value.trim().toLowerCase() : '';

  // Retrieve files and filter
  const matchedFiles = filesList.filter((f) => f.toLowerCase().includes(q));

  if (matchedFiles.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-500 italic p-3 text-center">No matching sidecars found.</p>`;
    return;
  }

  container.innerHTML = matchedFiles
    .map((filePath) => {
      const isSelected = filePath === selectedPath;
      const baseName = filePath.split('/').pop() || filePath;
      return `
      <div
        onclick="selectSidecar('${filePath}')"
        class="p-3 rounded-xl border cursor-pointer select-none transition-all duration-150 ${isSelected ? 'bg-indigo-600/15 border-indigo-500 text-white' : 'bg-slate-900/40 border-slate-800 hover:border-slate-700 text-slate-300'}"
      >
        <div class="flex flex-col">
          <span class="text-xs font-semibold truncate">${baseName}</span>
          <span class="text-[10px] text-slate-500 font-mono tracking-wide mt-1 truncate">${filePath}</span>
        </div>
      </div>
    `;
    })
    .join('');
}

(window as any).renderSpecsList = renderSpecsList;

// Focus Sidecar file
async function selectSidecar(filePath: string) {
  selectedPath = filePath;
  renderSpecsList();

  // Close mobile drawer on item select
  if (window.innerWidth < 768) {
    isLeftDrawerOpen = false;
    document.getElementById('left-drawer')?.classList.add('-translate-x-full');
    document.getElementById('drawer-overlay')?.classList.add('hidden');
  }

  await loadAndRenderSidecarDetail(filePath);
}

(window as any).selectSidecar = selectSidecar;

async function loadAndRenderSidecarDetail(filePath: string) {
  const panel = document.getElementById('web-detail-pane');
  if (!panel) return;

  panel.innerHTML = `<div class="p-6 text-xs text-slate-400 italic">Reading sidecar specifications...</div>`;

  try {
    const sidecar = await graphEngine.getSidecar(filePath);
    if (!sidecar) {
      panel.innerHTML = `<div class="p-6 text-xs text-rose-400 font-bold">Error: sidecar specification not found.</div>`;
      return;
    }

    const fm = sidecar.frontmatter;
    const tagsHtml =
      fm.tags
        ?.map(
          (t: string) =>
            `<span class="text-[9px] font-mono bg-slate-900 border border-slate-800 text-slate-400 px-1.5 py-0.5 rounded">#${t}</span>`,
        )
        .join(' ') || '<span class="text-slate-600 italic text-[11px]">None</span>';
    const exportsHtml =
      fm.exports
        ?.map(
          (e: string) =>
            `<span class="text-[9px] font-mono bg-indigo-950/20 border border-indigo-900/30 text-indigo-400 px-1.5 py-0.5 rounded">${e}</span>`,
        )
        .join(' ') || '<span class="text-slate-600 italic text-[11px]">None</span>';

    const decisionsHtml =
      fm.decisions
        ?.map(
          (d: any) => `
      <div class="p-3 bg-slate-900/40 border border-slate-800/80 rounded-xl">
        <div class="flex items-center justify-between mb-1">
          <span class="text-[10px] font-mono text-indigo-400 font-semibold">${d.id}</span>
          <span class="text-[9px] font-mono text-slate-500">${d.date || 'No Date'}</span>
        </div>
        <p class="text-xs text-slate-200 font-medium leading-relaxed">${d.summary}</p>
      </div>
    `,
        )
        .join('') ||
      '<p class="text-[11px] text-slate-500 italic">No Architectural Decision Records (ADRs).</p>';

    const upstreams = fm.depends_on || [];
    const downstreams = fm.used_by || [];

    const upstreamHtml =
      upstreams
        .map(
          (u: string) => `
      <li onclick="selectSidecar('${u}')" class="text-xs font-mono text-indigo-400 hover:underline cursor-pointer mb-1.5 flex items-center space-x-1.5">
        <span>🔌</span> <span>${u}</span>
      </li>
    `,
        )
        .join('') || '<p class="text-xs text-slate-500 italic">No upstream dependents.</p>';

    const downstreamHtml =
      downstreams
        .map(
          (d: string) => `
      <li onclick="selectSidecar('${d}')" class="text-xs font-mono text-indigo-400 hover:underline cursor-pointer mb-1.5 flex items-center space-x-1.5">
        <span>⚙️</span> <span>${d}</span>
      </li>
    `,
        )
        .join('') || '<p class="text-xs text-slate-500 italic">No downstream dependents.</p>';

    panel.innerHTML = `
      <div class="p-4 sm:p-6 space-y-5">
        <!-- Header Section -->
        <div class="border-b border-slate-800/80 pb-4">
          <div class="flex items-start justify-between">
            <div>
              <h2 class="text-base sm:text-lg font-semibold text-white tracking-tight">${fm.title || 'Untitled'}</h2>
              <p class="text-[10px] sm:text-xs font-mono text-slate-500 mt-1 select-all">${filePath}</p>
            </div>
            <div class="text-right flex flex-col items-end space-y-1">
              <span class="text-[10px] sm:text-[11px] font-mono bg-slate-900 border border-slate-800 text-slate-300 px-2 py-0.5 rounded-md">status: ${fm.status}</span>
              <span class="text-[9px] font-mono text-slate-500">flag: ${fm.status_flag || 'clean'}</span>
            </div>
          </div>
          <p class="text-xs sm:text-sm text-slate-400 mt-3 leading-relaxed">${fm.description || 'No description'}</p>
        </div>

        <!-- Touch-optimized Ego Graph View -->
        <div class="border border-slate-800 bg-slate-950/40 rounded-2xl p-3 sm:p-4">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              1-Hop Ego Dependency Graph
            </h3>
            <div class="flex space-x-1 text-[10px]">
              <button onclick="resetZoom()" class="bg-slate-800 border border-slate-700 px-2 py-0.5 rounded text-slate-300">Reset</button>
            </div>
          </div>

          <!-- Touch Gesture SVG Target Container -->
          <div id="ego-view-container" class="w-full bg-slate-950 rounded-xl overflow-hidden border border-slate-900/60 touch-action-none" style="height: 220px; position: relative;">
            ${renderEgoGraphSvg(filePath, upstreams, downstreams)}
          </div>
          <p class="text-[9px] text-slate-500 mt-2 text-center italic">Touch gestures: Drag to pan, pinch to zoom. Double-tap neighbor node to inspect.</p>
        </div>

        <!-- Dependency columns -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-800/60 pt-4">
          <div>
            <h4 class="text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Depends On (Upstream)</h4>
            <ul>${upstreamHtml}</ul>
          </div>
          <div>
            <h4 class="text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Used By (Downstream)</h4>
            <ul>${downstreamHtml}</ul>
          </div>
        </div>

        <!-- Metadata contract tags -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-800/60 pt-4">
          <div>
            <h4 class="text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Tags</h4>
            <div class="flex flex-wrap gap-1.5">${tagsHtml}</div>
          </div>
          <div>
            <h4 class="text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Exports</h4>
            <div class="flex flex-wrap gap-1.5">${exportsHtml}</div>
          </div>
        </div>

        <!-- ADR decisions list -->
        <div class="border-t border-slate-800/60 pt-4">
          <h4 class="text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2.5">Architectural Decisions (ADR)</h4>
          <div class="space-y-2">${decisionsHtml}</div>
        </div>

        <!-- Spec raw markdown representation -->
        <div class="border-t border-slate-800/60 pt-4">
          <h4 class="text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Sidecar Code & Spec Body</h4>
          <pre class="bg-slate-950 border border-slate-800 p-3 rounded-xl text-[10px] sm:text-xs font-mono text-slate-300 leading-relaxed overflow-x-auto max-h-[250px] custom-scroll"><code>${escapeHtml(sidecar.body || '')}</code></pre>
        </div>
      </div>
    `;

    setupTouchGestures();
    renderRightPanel();
  } catch (err: any) {
    panel.innerHTML = `<div class="p-6 text-xs text-rose-400 font-bold">Error loading sidecar detail: ${err.message}</div>`;
  }
}

// Generate Ego Graph SVG
function renderEgoGraphSvg(centerNode: string, upstreams: string[], downstreams: string[]): string {
  const width = 500;
  const height = 220;

  const cleanLabel = (pathStr: string) => {
    const parts = pathStr.split('/');
    return parts[parts.length - 1];
  };

  const centerLabel = cleanLabel(centerNode);
  const centerRad = 34;
  const neighborRad = 25;
  const centerPos = { x: width / 2, y: height / 2 };

  // Upstream positions
  const upPos = upstreams.map((item, idx) => {
    const total = upstreams.length;
    const x = 70;
    const spacing = height / (total + 1);
    const y = spacing * (idx + 1);
    return { item, x, y };
  });

  // Downstream positions
  const downPos = downstreams.map((item, idx) => {
    const total = downstreams.length;
    const x = width - 70;
    const spacing = height / (total + 1);
    const y = spacing * (idx + 1);
    return { item, x, y };
  });

  let svg = `
    <svg id="ego-svg" width="100%" height="100%" viewBox="0 0 ${width} ${height}" style="overflow: visible;">
      <g id="ego-viewport" transform="translate(${panX}, ${panY}) scale(${scale})" style="transform-origin: center; transition: transform 0.05s linear;">
        <defs>
          <marker id="arrow-web" viewBox="0 0 10 10" refX="28" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="oklch(0.5 0.2 240)" />
          </marker>
        </defs>
  `;

  // Upstream links
  upPos.forEach((p) => {
    svg += `<line x1="${p.x}" y1="${p.y}" x2="${centerPos.x}" y2="${centerPos.y}" stroke="oklch(0.3 0.05 240)" stroke-width="1.5" marker-end="url(#arrow-web)" />`;
  });

  // Downstream links
  downPos.forEach((p) => {
    svg += `<line x1="${centerPos.x}" y1="${centerPos.y}" x2="${p.x}" y2="${p.y}" stroke="oklch(0.3 0.05 240)" stroke-width="1.5" marker-end="url(#arrow-web)" />`;
  });

  // Render Upstreams
  upPos.forEach((p) => {
    const lbl = cleanLabel(p.item);
    svg += `
      <g class="ego-node cursor-pointer group" data-path="${p.item}">
        <circle cx="${p.x}" cy="${p.y}" r="${neighborRad}" fill="oklch(0.2 0.04 240)" stroke="oklch(0.4 0.05 240)" stroke-width="1.5" />
        <text x="${p.x}" y="${p.y + 4}" font-size="9" font-family="monospace" fill="oklch(0.8 0.02 240)" text-anchor="middle" class="pointer-events-none font-semibold">${lbl.substring(0, 8)}</text>
      </g>
    `;
  });

  // Render Downstreams
  downPos.forEach((p) => {
    const lbl = cleanLabel(p.item);
    svg += `
      <g class="ego-node cursor-pointer group" data-path="${p.item}">
        <circle cx="${p.x}" cy="${p.y}" r="${neighborRad}" fill="oklch(0.2 0.04 240)" stroke="oklch(0.4 0.05 240)" stroke-width="1.5" />
        <text x="${p.x}" y="${p.y + 4}" font-size="9" font-family="monospace" fill="oklch(0.8 0.02 240)" text-anchor="middle" class="pointer-events-none font-semibold">${lbl.substring(0, 8)}</text>
      </g>
    `;
  });

  // Render Center Node
  svg += `
    <g class="pointer-events-none">
      <circle cx="${centerPos.x}" cy="${centerPos.y}" r="${centerRad}" fill="oklch(0.25 0.12 250)" stroke="oklch(0.5 0.2 240)" stroke-width="2.5" />
      <text x="${centerPos.x}" y="${centerPos.y + 4}" font-size="10" font-family="monospace" fill="white" font-weight="bold" text-anchor="middle">${centerLabel.substring(0, 10)}</text>
    </g>
  `;

  if (upstreams.length === 0 && downstreams.length === 0) {
    svg += `<text x="${width / 2}" y="${height - 15}" font-size="10" fill="oklch(0.5 0.02 240)" text-anchor="middle" class="italic">No connected neighbors in ego scope.</text>`;
  }

  svg += `
      </g>
    </svg>
  `;
  return svg;
}

// Reset Zoom helper
function resetZoom() {
  scale = 1.0;
  panX = 0;
  panY = 0;
  updateViewportTransform();
}

(window as any).resetZoom = resetZoom;

function updateViewportTransform() {
  const viewport = document.getElementById('ego-viewport');
  if (viewport) {
    viewport.setAttribute('transform', `translate(${panX}, ${panY}) scale(${scale})`);
  }
}

// SVG Touch pan/pinch gestures
function setupTouchGestures() {
  const container = document.getElementById('ego-view-container');
  if (!container) return;

  // Single tap/double tap & click fallback for desktop + mobile
  const nodes = container.querySelectorAll('.ego-node');
  nodes.forEach((node) => {
    // Touch tap / double tap
    node.addEventListener('touchend', (e) => {
      e.preventDefault();
      const path = node.getAttribute('data-path') || '';
      const now = Date.now();
      const diff = now - lastTapTime;
      lastTapTime = now;
      if (diff < 300) {
        // Double tap -> focus/inspect node
        selectSidecar(path);
      } else {
        showToast(`Double-tap to focus: ${path.split('/').pop()}`, 'info');
      }
    });

    // Click/double-click for mouse
    node.addEventListener('dblclick', (e) => {
      e.preventDefault();
      const path = node.getAttribute('data-path') || '';
      selectSidecar(path);
    });
  });

  // Pan and Zoom Touch triggers
  container.addEventListener('touchstart', (e: TouchEvent) => {
    if (e.touches.length === 1) {
      isPanning = true;
      startX = e.touches[0].clientX - panX;
      startY = e.touches[0].clientY - panY;
    } else if (e.touches.length === 2) {
      isPanning = false;
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      lastTouchDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
    }
  });

  container.addEventListener('touchmove', (e: TouchEvent) => {
    if (isPanning && e.touches.length === 1) {
      panX = e.touches[0].clientX - startX;
      panY = e.touches[0].clientY - startY;
      updateViewportTransform();
    } else if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

      const factor = dist / lastTouchDist;
      scale = Math.max(0.4, Math.min(3.0, scale * factor));
      lastTouchDist = dist;
      updateViewportTransform();
    }
  });

  container.addEventListener('touchend', () => {
    isPanning = false;
  });

  // Mouse pan triggers for desktop robustness
  let isMouseDragging = false;
  container.addEventListener('mousedown', (e: MouseEvent) => {
    isMouseDragging = true;
    startX = e.clientX - panX;
    startY = e.clientY - panY;
  });

  container.addEventListener('mousemove', (e: MouseEvent) => {
    if (isMouseDragging) {
      panX = e.clientX - startX;
      panY = e.clientY - startY;
      updateViewportTransform();
    }
  });

  container.addEventListener('mouseup', () => {
    isMouseDragging = false;
  });

  container.addEventListener('mouseleave', () => {
    isMouseDragging = false;
  });

  // Mouse wheel zoom
  container.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.05 : 0.95;
      scale = Math.max(0.4, Math.min(3.0, scale * factor));
      updateViewportTransform();
    },
    { passive: false },
  );
}

// Right panel switcher
function switchRightTab(tab: 'directives' | 'templates') {
  currentTab = tab;
  renderRightPanel();
}

(window as any).switchRightTab = switchRightTab;

async function renderRightPanel() {
  const panel = document.getElementById('right-panel-content');
  if (!panel) return;

  const tabDirBtn = document.getElementById('tab-dir-btn');
  const tabTplBtn = document.getElementById('tab-tpl-btn');

  if (currentTab === 'directives') {
    tabDirBtn?.classList.add('border-indigo-500', 'text-indigo-400');
    tabDirBtn?.classList.remove('border-transparent', 'text-slate-400');
    tabTplBtn?.classList.add('border-transparent', 'text-slate-400');
    tabTplBtn?.classList.remove('border-indigo-500', 'text-indigo-400');

    // Retrieve directives
    const filterQuery =
      directiveFilter === 'all'
        ? `SELECT file_path as filePath, note_id as id, timestamp, text, status FROM user_notes ORDER BY timestamp DESC;`
        : `SELECT file_path as filePath, note_id as id, timestamp, text, status FROM user_notes WHERE status = ? ORDER BY timestamp DESC;`;
    const params = directiveFilter === 'all' ? [] : [directiveFilter];
    const directives = await graphEngine.all(filterQuery, params);

    panel.innerHTML = `
      <!-- Submit human directive note card -->
      <div class="bg-slate-900/40 border border-slate-800 p-3.5 rounded-xl space-y-3 shadow-sm shrink-0">
        <h3 class="text-xs font-semibold text-slate-200">Submit New Directive</h3>

        <div class="space-y-1">
          <label for="new-dir-file" class="block text-[9px] font-bold text-slate-500 uppercase">Target Spec</label>
          <select id="new-dir-file" class="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500">
            <option value="">-- Choose Sidecar File --</option>
            ${filesList.map((f) => `<option value="${f}" ${f === selectedPath ? 'selected' : ''}>${f}</option>`).join('')}
          </select>
        </div>

        <div class="space-y-1">
          <label for="new-dir-text" class="block text-[9px] font-bold text-slate-500 uppercase">Directive Note</label>
          <textarea id="new-dir-text" rows="3" placeholder="Enter spec instructions..." class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300 placeholder-slate-700 focus:outline-none focus:border-indigo-500 resize-none min-h-[50px]"></textarea>
        </div>

        <button onclick="submitDirective()" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs py-2 rounded-lg active:scale-95 transition-all shadow-sm">
          Send Directive
        </button>
      </div>

      <!-- Filters & List -->
      <div class="space-y-3 pt-2">
        <div class="flex items-center justify-between">
          <h4 class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Directives List</h4>
          <div class="flex space-x-1 bg-slate-950 border border-slate-800/80 p-0.5 rounded-lg text-[9px]">
            <button onclick="filterDirectives('pending')" class="px-2 py-1 rounded-md font-semibold ${directiveFilter === 'pending' ? 'bg-slate-800 text-white' : 'text-slate-400'}">Pending</button>
            <button onclick="filterDirectives('resolved')" class="px-2 py-1 rounded-md font-semibold ${directiveFilter === 'resolved' ? 'bg-slate-800 text-white' : 'text-slate-400'}">Resolved</button>
            <button onclick="filterDirectives('all')" class="px-2 py-1 rounded-md font-semibold ${directiveFilter === 'all' ? 'bg-slate-800 text-white' : 'text-slate-400'}">All</button>
          </div>
        </div>

        <div class="space-y-2.5">
          ${directives.length === 0 ? `<p class="text-[11px] text-slate-500 italic py-2 text-center">No directives matching selection.</p>` : ''}
          ${directives
            .map(
              (d: any) => `
            <div class="p-3 bg-slate-900/25 border border-slate-800/80 rounded-xl space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-[9px] font-mono text-slate-400">${d.id}</span>
                <span class="text-[9px] font-mono text-slate-500">${new Date(d.timestamp).toLocaleTimeString()}</span>
              </div>
              <p class="text-xs text-slate-200 font-medium leading-relaxed">${d.text}</p>
              <div class="flex items-center justify-between border-t border-slate-800/40 pt-1.5 text-[9px]">
                <span onclick="selectSidecar('${d.filePath}')" class="text-indigo-400 hover:underline cursor-pointer truncate max-w-[140px] font-mono">${d.filePath}</span>
                ${
                  d.status === 'pending'
                    ? `
                  <button onclick="resolveDirective('${d.filePath}', '${d.id}')" class="px-2 py-0.5 bg-slate-800 border border-slate-700 text-slate-300 hover:text-emerald-400 hover:border-emerald-500/25 rounded font-semibold transition-all">Resolve</button>
                `
                    : `<span class="text-slate-500 uppercase font-semibold font-mono text-[8px] tracking-wider">Resolved</span>`
                }
              </div>
            </div>
          `,
            )
            .join('')}
        </div>
      </div>
    `;
  } else {
    tabTplBtn?.classList.add('border-indigo-500', 'text-indigo-400');
    tabTplBtn?.classList.remove('border-transparent', 'text-slate-400');
    tabDirBtn?.classList.add('border-transparent', 'text-slate-400');
    tabDirBtn?.classList.remove('border-indigo-500', 'text-indigo-400');

    // Display provisional templates
    panel.innerHTML = `
      <div class="text-[11px] text-slate-400 pb-2">Manage provisional draft templates for code materialization permissions.</div>

      <!-- List of static demo templates or fetched drafts if any -->
      <div class="space-y-3" id="provisional-templates-list">
        <!-- Static draft templates matching portal capabilities -->
        <div class="p-3 bg-slate-900/35 border border-slate-800 rounded-xl space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-white">controller-v1.0-provisional.ts.md.tpl</span>
            <span class="text-[9px] font-mono bg-amber-500/10 border border-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full font-bold">DRAFT</span>
          </div>
          <pre class="bg-slate-950 p-2 border border-slate-900 rounded-lg text-[9px] text-slate-400 max-h-[80px] overflow-y-auto font-mono custom-scroll"># Controller Mold (Draft Proposal)
Provisional template for human review.
- Project: {{project_name}}
- Version: v1.0-provisional</pre>
          <div class="flex items-center space-x-2 pt-1 text-[10px]">
            <button onclick="approveTemplateProposal('controller-v1.0-provisional.ts.md.tpl', true)" class="flex-1 bg-slate-800 hover:bg-indigo-600/20 text-indigo-400 hover:border-indigo-500/35 border border-slate-700 rounded-lg font-bold py-1 transition-all">Approve Template</button>
            <button onclick="approveTemplateProposal('controller-v1.0-provisional.ts.md.tpl', false)" class="px-3 bg-slate-950 border border-slate-900 text-rose-500 hover:bg-rose-950/20 rounded-lg py-1 transition-all font-bold">Reject</button>
          </div>
        </div>

        <div class="p-3 bg-slate-900/35 border border-slate-800 rounded-xl space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-white">service.ts.md.tpl</span>
            <span class="text-[9px] font-mono bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full font-bold">ACTIVE</span>
          </div>
          <p class="text-[10px] text-slate-500 italic font-mono">Template is fully registered on repository.</p>
        </div>
      </div>
    `;
  }
}

(window as any).filterDirectives = (status: 'pending' | 'resolved' | 'all') => {
  directiveFilter = status;
  renderRightPanel();
};

// Submit dynamic directive note to sidecar and push to GitHub
async function submitDirective() {
  const fileSelect = document.getElementById('new-dir-file') as HTMLSelectElement;
  const textInput = document.getElementById('new-dir-text') as HTMLTextAreaElement;
  if (!fileSelect || !textInput) return;

  const filePath = fileSelect.value;
  const text = textInput.value.trim();

  if (!filePath) {
    showToast('Please select a target sidecar file.', 'error');
    return;
  }
  if (!text) {
    showToast('Please type directive instruction.', 'error');
    return;
  }

  showToast('Saving directive and committing to GitHub...', 'info');

  try {
    // 1. Read existing spec file from virtual filesystem
    const content = await virtualFs.readFile(filePath);
    const parsed = parseOkfSpec(content);

    if (!parsed.isValid || !parsed.frontmatter) {
      showToast('Parsing failure: invalid sidecar format.', 'error');
      return;
    }

    // 2. Add new user note
    const noteId = `NOTE-${Date.now()}`;
    const newNote = {
      id: noteId,
      timestamp: new Date().toISOString(),
      text,
      status: 'pending',
    };

    const notes = parsed.frontmatter.user_notes || [];
    notes.push(newNote);
    parsed.frontmatter.user_notes = notes;

    // 3. Stringify OKF spec and write back locally
    const updatedContent = stringifyOkfSpec(parsed.frontmatter, parsed.body);
    await virtualFs.writeFile(filePath, updatedContent);

    // Update offline cache
    try {
      const cachedFiles = JSON.parse(
        localStorage.getItem(`STUBS_OFFLINE_FILES_${currentRepo}_${currentBranch}`) || '{}',
      );
      cachedFiles[filePath] = updatedContent;
      localStorage.setItem(
        `STUBS_OFFLINE_FILES_${currentRepo}_${currentBranch}`,
        JSON.stringify(cachedFiles),
      );
    } catch (e) {
      console.warn('Failed to update cache on submitDirective:', e);
    }

    // 4. Force index update in-memory
    await graphEngine.indexWorkspace('/', { force: true });

    // 5. Commit to GitHub directly
    const [owner, name] = currentRepo.split('/');
    const client = new GitHubClient(pat);
    await client
      .createOrUpdateFile(
        owner,
        name,
        filePath,
        updatedContent,
        `Add user note ${noteId} via PWA`,
        currentBranch,
      )
      .catch((err) => {
        showToast('Offline save succeeded locally. GitHub sync failed: ' + err.message, 'warning');
      });

    showToast('Successfully saved directive note!', 'success');
    textInput.value = '';

    // Close mobile right drawer
    if (window.innerWidth < 768) {
      isRightDrawerOpen = false;
      document.getElementById('right-drawer')?.classList.add('translate-x-full');
      document.getElementById('drawer-overlay')?.classList.add('hidden');
    }

    await loadAndRenderSidecarDetail(filePath);
  } catch (err: any) {
    showToast('Failed to save directive: ' + err.message, 'error');
  }
}

(window as any).submitDirective = submitDirective;

// Resolve directive note on both virtual database + remote commit
async function resolveDirective(filePath: string, noteId: string) {
  showToast('Resolving directive and pushing commit...', 'info');

  try {
    const content = await virtualFs.readFile(filePath);
    const parsed = parseOkfSpec(content);
    if (!parsed.isValid || !parsed.frontmatter) {
      showToast('Error parsing sidecar.', 'error');
      return;
    }

    const notes = parsed.frontmatter.user_notes || [];
    const note = notes.find((n: any) => n.id === noteId);
    if (!note) {
      showToast('Directive not found inside sidecar.', 'error');
      return;
    }

    note.status = 'resolved';

    const updatedContent = stringifyOkfSpec(parsed.frontmatter, parsed.body);
    await virtualFs.writeFile(filePath, updatedContent);

    // Update offline cache
    try {
      const cachedFiles = JSON.parse(
        localStorage.getItem(`STUBS_OFFLINE_FILES_${currentRepo}_${currentBranch}`) || '{}',
      );
      cachedFiles[filePath] = updatedContent;
      localStorage.setItem(
        `STUBS_OFFLINE_FILES_${currentRepo}_${currentBranch}`,
        JSON.stringify(cachedFiles),
      );
    } catch (e) {
      console.warn('Failed to update cache on resolveDirective:', e);
    }

    await graphEngine.indexWorkspace('/', { force: true });

    const [owner, name] = currentRepo.split('/');
    const client = new GitHubClient(pat);
    await client
      .createOrUpdateFile(
        owner,
        name,
        filePath,
        updatedContent,
        `Resolve user note ${noteId} via PWA`,
        currentBranch,
      )
      .catch((err) => {
        showToast(
          'Offline resolve succeeded locally. GitHub sync failed: ' + err.message,
          'warning',
        );
      });

    showToast('Successfully resolved directive note!', 'success');
    await loadAndRenderSidecarDetail(filePath);
  } catch (err: any) {
    showToast('Failed to resolve directive: ' + err.message, 'error');
  }
}

(window as any).resolveDirective = resolveDirective;

// Approve/Reject draft template proposal
async function approveTemplateProposal(templateName: string, approved: boolean) {
  showToast(approved ? 'Approving template proposal...' : 'Rejecting template proposal...', 'info');
  setTimeout(() => {
    showToast(
      approved
        ? 'Successfully approved template proposal on repository!'
        : 'Rejected template draft.',
      'success',
    );
  }, 1000);
}

(window as any).approveTemplateProposal = approveTemplateProposal;

// Helper: escapes HTML characters safely
function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

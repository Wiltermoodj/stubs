---
title: Web PWA — Browser Client & WASM SQLite Bundle
type: sidecar-spec
description: >-
  The client-side Progressive Web App (PWA) bundle. Implements the stubs Web
  Portal UI using vanilla TypeScript and the WASM sql.js SQLite engine. Provides
  the 1-Hop Ego Graph visualization, sidecar viewer, template workbench, GitHub
  remote access panel, and real-time SSE event handling. Also provides browser
  compatibility shims for Node.js built-in modules.
tags:
  - web
  - pwa
  - browser
  - wasm
  - visualization
  - client
module_depth: deep
status: spec
version: 1
target_code_file: ./index.ts
status_flag: clean
exports:
  - StubsWebApp
depends_on:
  - src/server/portal.ts
  - src/server/github.ts
---

# Web PWA — Browser Client & WASM SQLite Bundle

The browser-side companion to the PortalServer. Runs entirely in the browser without Node.js, using WASM SQLite (`sql.js`) for local graph queries when offline or in mobile mode.

## UI Sections

| Panel | Description |
|---|---|
| **Ego Graph** | Force-directed 1-hop dependency graph visualization centered on the selected sidecar |
| **Sidecar Viewer** | Renders the OKF spec as formatted Markdown with frontmatter fields |
| **Template Workbench** | Lists templates, renders them with user-provided JSON data |
| **GitHub Tab** | PAT authentication, repo/branch selector, remote file browser |
| **Search** | FTS5-powered full-text search via the Portal API |
| **Directives** | User notes / human directive channel — submit notes appended to sidecar frontmatter |

## Dual-Mode Operation

| Mode | SQLite | API |
|---|---|---|
| **Online (local server)** | Not used | All queries via PortalServer REST API |
| **Offline / GitHub PAT mode** | WASM sql.js loaded from `sql-wasm.wasm` | Direct GitHub API calls via `GitHubApiClient` |

In offline mode, the app downloads the `graph.sqlite` file from the GitHub repository and loads it into a WASM in-memory database for local graph queries.

## Browser Shims (`shims.ts`)

`shims.ts` provides stub implementations of Node.js built-ins required by modules bundled into the browser build:
- `process` (env, cwd, platform, version)
- `path` (join, resolve, dirname, basename, extname, relative)
- `os` (homedir, tmpdir, hostname, platform, arch, userInfo)
- `crypto` (randomBytes, createHash)
- `fs` / `fs/promises` (no-op stubs)

## SSE Live Updates

The app connects to `/api/events` on startup. When a `sidecar_changed` event is received, it re-fetches the affected sidecar and updates the ego graph view without a full page reload.

## Key Design Decisions

- The entire web UI is a single TypeScript file (`index.ts`, ~68KB) to remain bundleable by `esbuild` without a framework.
- `sql-wasm.wasm` is served by the PortalServer alongside the JS bundle and loaded via `sql.js initSqlJs({ locateFile })`.
- GitHub PAT is stored in `sessionStorage` only (never `localStorage`) to prevent leakage across browser sessions.
- The ego graph uses a canvas/SVG hybrid: SVG for node labels, canvas for edge lines — for performance with large dependency graphs.

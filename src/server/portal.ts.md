---
title: Portal Server — HTTP & SSE Web Portal
type: sidecar-spec
description: >-
  Express HTTP server that serves the stubs Web Portal UI bundle, provides REST
  API endpoints for graph queries, sidecar operations, and template management,
  and broadcasts real-time filesystem events to connected clients via Server-Sent
  Events (SSE). Integrates with the GitHub API for remote repository access.
  The largest single module in the codebase (~3,000 LOC).
tags:
  - server
  - portal
  - express
  - sse
  - api
  - web-portal
module_depth: deep
context_object: PortalServer
status: spec
version: 1
target_code_file: ./portal.ts
status_flag: clean
exports:
  - PortalServer
depends_on:
  - src/config/schema.ts
  - src/graph/engine.ts
  - src/parser/okf.ts
  - src/materializer/engine.ts
  - src/sanding/engine.ts
  - src/templates/engine.ts
  - src/server/github.ts
  - src/storage/credentials.ts
used_by:
  - src/cli/router.ts
---

# Portal Server — HTTP & SSE Web Portal

The PortalServer is the local runtime API gateway and file event bridge. It serves the PWA bundle and exposes every stubs engine operation as an HTTP endpoint for use by the Web UI and third-party tooling.

## Server Architecture

```
PortalServer
├── Express HTTP server (port configurable, default 3000)
├── Static file serving (dist/web/ bundle)
├── REST API routes (/api/*)
│   ├── /api/graph        → GraphEngine queries
│   ├── /api/sidecars     → CRUD sidecar operations
│   ├── /api/materialize  → MaterializerEngine
│   ├── /api/sand         → SandingEngine
│   ├── /api/grill        → GrillEngine
│   ├── /api/templates    → TemplateEngine
│   └── /api/github       → GitHubApiClient
└── SSE endpoint (/api/events)
    └── Filesystem watcher → broadcasts sidecar change events
```

## SSE Event Bridge

The server watches the `specs_dir` (default: `src/`) for `*.ts.md` file changes using `fs.watch()` or `chokidar` (if available). Events are broadcast to all connected SSE clients with JSON payloads:

```json
{ "type": "sidecar_changed", "filePath": "src/graph/engine.ts.md" }
{ "type": "sidecar_deleted", "filePath": "src/parser/okf.ts.md" }
```

## Key API Endpoints

| Method | Path                    | Action                        |
| ------ | ----------------------- | ----------------------------- |
| `GET`  | `/api/graph/ego/:path`  | 1-hop ego graph for a sidecar |
| `GET`  | `/api/graph/search?q=`  | FTS5 search                   |
| `GET`  | `/api/sidecars`         | List all indexed sidecars     |
| `GET`  | `/api/sidecars/:path`   | Get sidecar record            |
| `POST` | `/api/materialize`      | Materialize sidecar to code   |
| `POST` | `/api/sand`             | Run sanding sync              |
| `POST` | `/api/grill`            | Run grill engine              |
| `GET`  | `/api/templates`        | List templates                |
| `POST` | `/api/templates/render` | Render a template             |
| `GET`  | `/api/github/repos`     | List GitHub repos             |
| `GET`  | `/api/events`           | SSE event stream              |

## Key Design Decisions

- `PortalServer` bundles the full Web Portal HTML+JS+CSS inline into the portal.ts source (embedded string), making it a zero-dependency server that works without a build step for the web assets.
- All API errors return `{ error: string }` JSON responses with appropriate HTTP status codes — never crashes the server on bad input.
- SSE connections are tracked in a `Set<Response>` and cleaned up on client disconnect to prevent memory leaks.
- `start()` returns the `http.Server` instance so tests can close it without needing `process.kill`.

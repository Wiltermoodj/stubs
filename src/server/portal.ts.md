---
title: Portal Server — HTTP & SSE Web Portal
type: sidecar-spec
description: >-
  HTTP server that serves the stubs Web Portal UI dashboard, provides REST
  API endpoints for graph queries, planning hub state, 5-phase lifecycle matrix,
  file tree blueprints, and broadcasts real-time filesystem events via Server-Sent
  Events (SSE).
tags:
  - server
  - portal
  - sse
  - api
  - web-portal
  - planning
  - lifecycle
module_depth: deep
context_object: PortalServer
status: spec
version: 2
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

The PortalServer is the local runtime API gateway and file event bridge. It serves the dashboard and exposes stubs engine operations as HTTP endpoints.

## Server Architecture

```
PortalServer
├── Static file serving & HTML dashboard
├── REST API routes (/api/* & /api/v1/*)
│   ├── /api/v1/graph        → GraphEngine queries
│   ├── /api/v1/planning     → Planning Hub initiatives, concepts & tasks
│   ├── /api/v1/phases       → 5-Phase Lifecycle status matrix
│   ├── /api/v1/tree         → Unified physical & planned file tree
│   ├── /api/v1/directives   → User notes & human directives
│   ├── /api/v1/templates    → Template molds & drafts
│   └── /api/v1/bootstrap    → Codebase bootstrapping
└── SSE endpoint (/api/events)
    └── Filesystem watcher → broadcasts sidecar change events
```

## Key API Endpoints

| Method | Path                         | Action                                              |
| ------ | ---------------------------- | --------------------------------------------------- |
| `GET`  | `/api/v1/planning`           | Aggregated Planning Hub initiatives, tasks, metrics |
| `GET`  | `/api/v1/phases`             | Repository 5-Phase Lifecycle status matrix          |
| `GET`  | `/api/v1/tree`               | Unified visual file tree with planned items         |
| `GET`  | `/api/v1/graph`              | Indexed sidecars and project metadata               |
| `GET`  | `/api/v1/directives`         | List pending and historical directive notes         |
| `POST` | `/api/v1/directives`         | Submit new directive note to frontmatter            |
| `POST` | `/api/v1/directives/resolve` | Resolve an existing directive note                  |
| `GET`  | `/api/v1/templates`          | List registered templates and drafts                |
| `GET`  | `/api/events`                | Server-Sent Events stream                           |

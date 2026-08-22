---
title: Storage Abstraction Layer
type: sidecar-spec
description: >-
  Defines the FileStorageDriver and DatabaseDriver abstract interfaces and
  provides concrete implementations: NodeFileSystem (Node.js fs), BetterSqliteDriver
  (native sqlite3), and WasmSqliteDriver (sql.js WASM for browser/mobile).
  Enables the dual-runtime architecture that lets the same engine code run in
  Node.js CLI and browser PWA contexts.
tags:
  - storage
  - database
  - sqlite
  - filesystem
  - abstraction
  - wasm
module_depth: deep
status: spec
version: 1
target_code_file: ./index.ts
status_flag: clean
exports:
  - FileStorageDriver
  - FileSystemDriver
  - DatabaseDriver
  - PreparedStatement
  - NodeFileSystem
  - BetterSqliteDriver
  - WasmSqliteDriver
  - VirtualFileSystem
used_by:
  - src/graph/engine.ts
---

# Storage Abstraction Layer

The storage layer is the only place where runtime-environment differences (Node.js vs browser WASM) are handled. All engines above this layer use the abstract interfaces and are oblivious to the underlying runtime.

## Interface Hierarchy

```
FileStorageDriver
  readFile(path) → string
  writeFile(path, content)
  exists(path) → boolean
  readDir(path) → string[]

FileSystemDriver extends FileStorageDriver
  glob(pattern) → string[]          ← Node.js specific

DatabaseDriver
  initialize()
  exec(sql)
  run(sql, params?) → {lastID, changes}
  get<T>(sql, params?) → T | undefined
  all<T>(sql, params?) → T[]
  prepare(sql) → PreparedStatement
  close()
```

## Implementations

### `NodeFileSystem`
- Full Node.js `fs/promises` implementation.
- `glob()` recursively walks directories, excluding `node_modules`, `.git`, `.stubs`, `dist`, `build`.
- `writeFile()` auto-creates parent directories with `fs.mkdir({ recursive: true })`.

### `BetterSqliteDriver`
- Wraps native `sqlite3` npm package.
- Used when `require('sqlite3')` succeeds (normal Node.js environment).
- All methods are async wrappers over the synchronous sqlite3 callback API.

### `WasmSqliteDriver`
- Wraps `sql.js` WASM SQLite.
- Persists database to the filesystem via `FileStorageDriver` after each write operation.
- Used as fallback when native `sqlite3` is unavailable (browser, certain CI environments).
- Loads the WASM binary from the `dist/` directory alongside the CLI bundle.

### `VirtualFileSystem`
- In-memory filesystem for tests.
- Stores files in a `Map<string, string>`.

## Key Design Decisions

- `GraphEngine` probes `require('sqlite3')` at construction time and selects the driver automatically — callers never specify which driver to use.
- `WasmSqliteDriver` serializes the database to disk (via `FileStorageDriver.writeFile`) after every write, making persistence explicit and testable.
- `glob()` is only on `FileSystemDriver` (not `FileStorageDriver`) since WASM/browser environments cannot glob the host filesystem.

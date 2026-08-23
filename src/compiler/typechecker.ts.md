---
title: Compiler — In-Memory TypeScript Typechecker
type: sidecar-spec
description: >-
  Runs an in-memory TypeScript compilation pass on a virtual overlay file
  without emitting any output. Loads tsconfig.json options and workspace source
  files for accurate cross-file type resolution. Returns structured diagnostics
  for display in the CLI. Used by MaterializerEngine before writing code.
tags:
  - compiler
  - typescript
  - typecheck
  - in-memory
module_depth: deep
status: spec
version: 1
target_code_file: ./typechecker.ts
status_flag: clean
exports:
  - TypeCheckResult
  - typeCheckVirtualFile
used_by:
  - src/materializer/engine.ts
  - src/sanding/engine.ts
---

# Compiler — In-Memory TypeScript Typechecker

Zero-emission TypeScript type-checker that validates extracted implementation code against the full workspace type graph before any file is written.

## Interface

```typescript
interface TypeCheckResult {
  success: boolean;
  diagnostics: string[];
}

function typeCheckVirtualFile(
  targetFilePath: string,
  virtualContent: string,
  tsconfigPath?: string,
): TypeCheckResult;
```

## How It Works

1. **Config Loading:** Reads `tsconfig.json` via the TypeScript compiler API. Results are cached by `mtime` — a cache hit skips re-parsing on repeated calls within the same session.
2. **Virtual Overlay:** Overrides `ts.CompilerHost` methods (`readFile`, `fileExists`, `getSourceFile`) to return `virtualContent` when the target file path is requested, while delegating all other files to the real filesystem.
3. **Root Names:** Combines `tsconfig.json` file list with the target file path as compilation roots.
4. **Diagnostics:** Calls `ts.getPreEmitDiagnostics()`. Formats each diagnostic with `filename (line,col): message`.
5. **`noEmit = true`** is always forced — the checker never writes to disk.

## Key Design Decisions

- `tsconfig.json` `rootDir` and `rootDirs` are deleted from compiler options before use, since the virtual file may not be under the real source root.
- Falls back to a hard-coded set of safe compiler options (`ES2022`, `CommonJS`, `strict`) when `tsconfig.json` is missing — never refuses to type-check.
- On compilation crash, returns `success: false` with the crash message in `diagnostics` — never throws to the caller.
- Config cache keyed by `mtime` prevents stale compiler option reads across sessions without the overhead of re-parsing every invocation.

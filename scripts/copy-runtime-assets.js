#!/usr/bin/env node
/**
 * Copy the runtime assets the bundled CLI needs at execution time.
 *
 * `npm run build` produces a single esbuild bundle at
 * `.agents/skills/stubs/dist/cli.cjs`. Bundling inlines module *code*, but any
 * dependency that reads a real file off disk at runtime breaks, because the
 * path it derives points into the dist directory rather than node_modules.
 * Two dependencies do exactly that:
 *
 *   - sql.js  -> loads `sql-wasm.wasm`
 *   - typescript -> loads `lib.*.d.ts` (the standard library) via the compiler
 *     host's getDefaultLibLocation(). Without these, every `stubs materialize`
 *     run outside this repository failed with "Cannot find global type
 *     'String'" — a missing-toolchain fault reported as a user spec error.
 *
 * Both are therefore staged next to the bundle. The resolvers in
 * src/storage/index.ts (locateFile) and src/compiler/typechecker.ts
 * (resolveDefaultLibLocation) probe these locations first.
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, '.agents/skills/stubs/dist');
const tsLibSrc = path.join(repoRoot, 'node_modules/typescript/lib');
const tsLibDest = path.join(distDir, 'typescript-lib');

fs.mkdirSync(distDir, { recursive: true });

// sql.js WebAssembly binary
fs.copyFileSync(
  path.join(repoRoot, 'node_modules/sql.js/dist/sql-wasm.wasm'),
  path.join(distDir, 'sql-wasm.wasm'),
);

// TypeScript standard library declaration files. Only `lib*.d.ts` is copied —
// the rest of node_modules/typescript/lib is compiler source the bundle
// already contains, and shipping it would multiply the artifact size.
//
// The bundle's compiler host resolves lib files from its own directory
// (`getDefaultLibLocation` => bundle dir). Stage copies in both `dist/`
// (what the bundle looks for first) and `dist/typescript-lib/` (kept for
// any tooling that expects the subdir).
fs.mkdirSync(tsLibDest, { recursive: true });
const libFiles = fs
  .readdirSync(tsLibSrc)
  .filter((name) => name.startsWith('lib') && name.endsWith('.d.ts'));

if (libFiles.length === 0) {
  console.error(`No lib*.d.ts found in ${tsLibSrc}; typechecking would be broken at runtime.`);
  process.exit(1);
}

for (const name of libFiles) {
  const srcPath = path.join(tsLibSrc, name);
  fs.copyFileSync(srcPath, path.join(distDir, name));
  fs.copyFileSync(srcPath, path.join(tsLibDest, name));
}

// lib.d.ts is the existence discriminator used by resolveDefaultLibLocation().
if (!fs.existsSync(path.join(tsLibDest, 'lib.d.ts'))) {
  console.error('lib.d.ts missing after copy; resolveDefaultLibLocation() would reject this dir.');
  process.exit(1);
}

console.log(`Runtime assets staged: sql-wasm.wasm + ${libFiles.length} TypeScript lib files.`);

// Template molds. These are data, not code, so esbuild cannot inline them.
// `stubs init` copies them into a new workspace via seedWorkspaceTemplates();
// without staging them here a shipped CLI initializes a workspace whose
// templates_dir is empty.
const moldSrc = path.join(repoRoot, '.stubs/templates');
const moldDest = path.join(distDir, 'templates');
fs.mkdirSync(moldDest, { recursive: true });
const molds = fs.existsSync(moldSrc)
  ? fs.readdirSync(moldSrc).filter((name) => name.endsWith('.tpl'))
  : [];

if (molds.length === 0) {
  console.error(`No *.tpl molds found in ${moldSrc}; \`stubs init\` would seed nothing.`);
  process.exit(1);
}

for (const name of molds) {
  fs.copyFileSync(path.join(moldSrc, name), path.join(moldDest, name));
}

console.log(`Template molds staged: ${molds.length}.`);

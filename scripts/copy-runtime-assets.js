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

// Search candidate locations for sql-wasm.wasm
const sqlCandidates = [
  path.join(repoRoot, 'node_modules/sql.js/dist/sql-wasm.wasm'),
  path.join(repoRoot, '../sql.js/dist/sql-wasm.wasm'),
  path.join(repoRoot, '../../node_modules/sql.js/dist/sql-wasm.wasm'),
];
try {
  const resolvedSql = require.resolve('sql.js/dist/sql-wasm.wasm', { paths: [repoRoot, process.cwd()] });
  sqlCandidates.unshift(resolvedSql);
} catch {}
try {
  const sqlPkg = require.resolve('sql.js/package.json', { paths: [repoRoot, process.cwd()] });
  sqlCandidates.unshift(path.join(path.dirname(sqlPkg), 'dist/sql-wasm.wasm'));
} catch {}

const sqlWasmSrc = sqlCandidates.find((p) => fs.existsSync(p));

// Search candidate locations for typescript lib files
const tsCandidates = [
  path.join(repoRoot, 'node_modules/typescript/lib'),
  path.join(repoRoot, '../typescript/lib'),
  path.join(repoRoot, '../../node_modules/typescript/lib'),
];
try {
  const tsPkg = require.resolve('typescript/package.json', { paths: [repoRoot, process.cwd()] });
  tsCandidates.unshift(path.join(path.dirname(tsPkg), 'lib'));
} catch {}

const tsLibSrc = tsCandidates.find((p) => fs.existsSync(p));

const tsLibDest = path.join(distDir, 'typescript-lib');

fs.mkdirSync(distDir, { recursive: true });

// sql.js WebAssembly binary
if (sqlWasmSrc && fs.existsSync(sqlWasmSrc)) {
  fs.copyFileSync(sqlWasmSrc, path.join(distDir, 'sql-wasm.wasm'));
} else {
  console.error(`sql-wasm.wasm not found in candidates: ${sqlCandidates.join(', ')}`);
  process.exit(1);
}

// TypeScript standard library declaration files.
fs.mkdirSync(tsLibDest, { recursive: true });
const libFiles = tsLibSrc && fs.existsSync(tsLibSrc)
  ? fs.readdirSync(tsLibSrc).filter((name) => name.startsWith('lib') && name.endsWith('.d.ts'))
  : [];

if (libFiles.length === 0) {
  console.error(`No lib*.d.ts found in candidate typescript directories.`);
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

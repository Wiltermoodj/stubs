#!/usr/bin/env node
// Minimal helper: run one or more Jest test files in isolation by spawning
// a fresh Node child process for each file with its own temp HOME/.stubs dir.
// This avoids parallel-worker collisions on shared SQLite files and fixture dirs.
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node scripts/jest-isolated.js <test-file> [more files...]');
  process.exit(2);
}

const root = path.resolve(__dirname, '..');

async function runIsolated(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    console.error(`Missing test file: ${abs}`);
    return 1;
  }

  const tmpHome = fs.mkdtempSync(path.join('/tmp', 'stubs-jest-'));
  const tmpStubs = path.join(tmpHome, '.stubs');
  fs.mkdirSync(tmpStubs, { recursive: true });

  await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, 'node_modules/jest/bin/jest.js'), abs], {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        HOME: tmpHome,
        PATH: process.env.PATH,
      },
    });
    child.on('close', (code) => resolve(code ?? 0));
  });
}

(async () => {
  let failed = false;
  for (const file of files) {
    const code = await runIsolated(file);
    if (code !== 0) failed = true;
  }
  process.exit(failed ? 1 : 0);
})();

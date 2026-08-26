#!/usr/bin/env node
const path = require('path');
const fs = require('fs');

const candidates = [
  path.resolve(__dirname, '../dist/cli.cjs'),
  path.resolve(__dirname, '../.agents/skills/stubs/dist/cli.cjs'),
];

let cliPath = candidates.find((p) => fs.existsSync(p));

if (!cliPath) {
  // If not built yet and running in local development repo, build on first run
  const pkgJsonPath = path.resolve(__dirname, '../package.json');
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const { execSync } = require('child_process');
      execSync('npm run build', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
      cliPath = candidates.find((p) => fs.existsSync(p));
    } catch (err) {
      console.error('Failed to build stubs bundle:', err);
      process.exit(1);
    }
  }
}

if (!cliPath || !fs.existsSync(cliPath)) {
  console.error(
    'Error: Could not locate stubs executable bundle in dist/ or .agents/skills/stubs/dist/',
  );
  process.exit(1);
}

require(cliPath);

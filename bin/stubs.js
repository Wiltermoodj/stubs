#!/usr/bin/env node
const path = require('path');
const fs = require('fs');

const cliPath = path.resolve(__dirname, '../.agents/skills/stubs/dist/cli.cjs');
if (!fs.existsSync(cliPath)) {
  // If not built yet, build on first run
  const { execSync } = require('child_process');
  execSync('npm run build', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
}

require(cliPath);

#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const bundlePath = path.resolve(process.cwd(), 'dist/web/app.js');

if (!fs.existsSync(bundlePath)) {
  console.error(`Missing web bundle: ${bundlePath}. Run build:web first.`);
  process.exit(1);
}

const contents = fs.readFileSync(bundlePath, 'utf8');

if (contents.includes('(void 0)(')) {
  console.error(
    'Web shim check failed: bundle contains undefined-aliased import pattern "(void 0)(".',
  );
  process.exit(1);
}

console.log('Web shim check passed: no undefined-aliased imports found.');

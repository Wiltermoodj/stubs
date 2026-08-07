const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

async function buildWeb() {
  const distDir = path.resolve(__dirname, '../dist/web');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  console.log('[Build] Starting esbuild bundle for web application...');

  try {
    // 1. Run esbuild compilation for the browser bundle
    await esbuild.build({
      entryPoints: ['src/web/index.ts'],
      bundle: true,
      minify: true,
      sourcemap: true,
      platform: 'browser',
      target: ['es2022'],
      outfile: 'dist/web/app.js',
      alias: {
        'fs': './src/web/shims.ts',
        'fs/promises': './src/web/shims.ts',
        'path': './src/web/shims.ts',
        'os': './src/web/shims.ts',
        'crypto': './src/web/shims.ts',
        'sqlite3': './src/web/shims.ts'
      },
      define: {
        'process.env.NODE_ENV': '"production"',
        'global': 'window'
      }
    });
    console.log('[Build] esbuild bundle complete: dist/web/app.js');

    // 2. Copy index.html, manifest.json, sw.js to dist/web/
    fs.copyFileSync('src/web/index.html', 'dist/web/index.html');
    fs.copyFileSync('public/manifest.json', 'dist/web/manifest.json');
    fs.copyFileSync('public/sw.js', 'dist/web/sw.js');
    console.log('[Build] Copied index.html, manifest.json, sw.js to dist/web/');

    // 3. Locate and copy all sql-wasm.wasm files
    const wasmFiles = ['sql-wasm.wasm', 'sql-wasm-browser.wasm'];
    for (const file of wasmFiles) {
      const sourcePath = path.resolve(__dirname, `../node_modules/sql.js/dist/${file}`);
      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, `dist/web/${file}`);
        console.log(`[Build] Copied ${file} to dist/web/`);
      } else {
        console.warn(`[Build] Warning: ${file} not found under node_modules/sql.js/dist/`);
      }
    }

    console.log('[Build] Web build completed successfully!');
  } catch (err) {
    console.error('[Build] Web build failed:', err);
    process.exit(1);
  }
}

buildWeb();

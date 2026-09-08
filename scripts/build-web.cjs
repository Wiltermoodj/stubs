const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

async function buildWeb() {
  const repoRoot = path.resolve(__dirname, '..');
  const distDir = path.resolve(repoRoot, 'dist/web');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  console.log('[Build] Starting esbuild bundle for web application...');

  try {
    const shimsPath = path.resolve(repoRoot, 'src/web/shims.ts');

    await esbuild.build({
      entryPoints: [path.resolve(repoRoot, 'src/web/index.ts')],
      bundle: true,
      minify: true,
      sourcemap: true,
      platform: 'browser',
      target: ['es2022'],
      outfile: path.resolve(distDir, 'app.js'),
      alias: {
        fs: shimsPath,
        'fs/promises': shimsPath,
        path: shimsPath,
        os: shimsPath,
        crypto: shimsPath,
        sqlite3: shimsPath,
      },
      define: {
        'process.env.NODE_ENV': '"production"',
        global: 'window',
      },
    });
    console.log('[Build] esbuild bundle complete: dist/web/app.js');

    const copyWithFallbacks = (candidates, destName) => {
      const destPath = path.resolve(distDir, destName);
      for (const cand of candidates) {
        if (cand && fs.existsSync(cand)) {
          fs.copyFileSync(cand, destPath);
          return cand;
        }
      }
      return null;
    };

    copyWithFallbacks(
      [
        path.resolve(repoRoot, 'src/web/index.html'),
        path.resolve(repoRoot, 'public/index.html'),
        path.resolve(distDir, 'index.html'),
      ],
      'index.html',
    );

    copyWithFallbacks(
      [
        path.resolve(repoRoot, 'public/manifest.json'),
        path.resolve(repoRoot, 'src/web/manifest.json'),
        path.resolve(distDir, 'manifest.json'),
      ],
      'manifest.json',
    );

    copyWithFallbacks(
      [
        path.resolve(repoRoot, 'public/sw.js'),
        path.resolve(repoRoot, 'src/web/sw.js'),
        path.resolve(distDir, 'sw.js'),
      ],
      'sw.js',
    );

    const wasmFiles = ['sql-wasm.wasm', 'sql-wasm-browser.wasm'];
    for (const file of wasmFiles) {
      const candidates = [
        path.resolve(repoRoot, `node_modules/sql.js/dist/${file}`),
        path.resolve(repoRoot, `../node_modules/sql.js/dist/${file}`),
        path.resolve(repoRoot, `../../node_modules/sql.js/dist/${file}`),
        path.resolve(repoRoot, `dist/${file}`),
        path.resolve(repoRoot, `.agents/skills/stubs/dist/${file}`),
      ];
      try {
        const resolved = require.resolve(`sql.js/dist/${file}`, {
          paths: [repoRoot, process.cwd()],
        });
        candidates.unshift(resolved);
      } catch {}

      const found = candidates.find((p) => p && fs.existsSync(p));
      if (found) {
        fs.copyFileSync(found, path.resolve(distDir, file));
        console.log(`[Build] Copied ${file} to dist/web/ from ${found}`);
      } else {
        console.warn(`[Build] Warning: ${file} not found in candidate paths.`);
      }
    }

    console.log('[Build] Web build completed successfully!');
  } catch (err) {
    console.error('[Build] Web build failed:', err);
    process.exit(1);
  }
}

buildWeb();

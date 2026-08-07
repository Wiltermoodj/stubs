import * as fs from 'fs';
import * as path from 'path';

describe('Web Build Verification & PWA Manifest Assets', () => {
  const distWebDir = path.resolve(__dirname, '../dist/web');

  it('should verify that all expected bundled static assets exist in the dist/web folder', () => {
    const requiredFiles = [
      'index.html',
      'app.js',
      'sw.js',
      'manifest.json',
      'sql-wasm.wasm',
      'sql-wasm-browser.wasm',
    ];

    for (const filename of requiredFiles) {
      const filePath = path.join(distWebDir, filename);
      expect(fs.existsSync(filePath)).toBe(true);
    }
  });

  it('should validate PWA properties in dist/web/manifest.json', () => {
    const manifestPath = path.join(distWebDir, 'manifest.json');
    const content = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(content);

    expect(manifest.name).toBe('Stubs Spec Manager');
    expect(manifest.short_name).toBe('Stubs');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('./index.html');
    expect(manifest.background_color).toBe('#1e1e2e');
    expect(manifest.theme_color).toBe('#1e1e2e');
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

    const sizes = manifest.icons.map((i: any) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });
});

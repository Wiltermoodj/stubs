import * as fs from 'fs';
import * as path from 'path';
import { GraphEngine } from '../src/graph/engine';
import { Level2SearchPlugin } from '../src/graph/plugins/level2';
import { Level3SearchPlugin } from '../src/graph/plugins/level3';
import { OkfFrontmatter } from '../src/parser/okf';

describe('Pluggable Search Engines (Level 2 & Level 3)', () => {
  const dbPath = path.resolve(__dirname, 'temp_test_plugins.sqlite');
  let engine: GraphEngine;

  beforeEach(async () => {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    engine = new GraphEngine(dbPath);
    await engine.initialize();
  });

  afterEach(async () => {
    if (engine) {
      await engine.close();
    }
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  describe('Level 2 Search Plugin', () => {
    it('should fall back to mock embedding when API key is missing', async () => {
      // Ensure API key is missing
      const oldKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      try {
        const plugin = new Level2SearchPlugin(engine);
        const vector = await plugin.generateEmbedding('hello world');
        expect(vector.length).toBe(1536);
        // Normalized vector should have magnitude of 1 (approx)
        const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
        expect(magnitude).toBeCloseTo(1, 5);
      } finally {
        process.env.OPENAI_API_KEY = oldKey;
      }
    });

    it('should generate and store level-2 embeddings on indexSidecar', async () => {
      const plugin = new Level2SearchPlugin(engine);
      await plugin.indexSidecar('src/auth/jwt.ts.md', 'some content for jwt spec');

      const rows = await engine.all(
        'SELECT * FROM sidecar_embeddings WHERE file_path = ? AND engine = ?;',
        ['src/auth/jwt.ts.md', 'level-2'],
      );
      expect(rows.length).toBe(1);
      expect(rows[0].file_path).toBe('src/auth/jwt.ts.md');
      const emb = JSON.parse(rows[0].embedding);
      expect(emb.length).toBe(1536);
    });

    it('should rank results correctly using Level 2 cosine similarity search', async () => {
      const plugin = new Level2SearchPlugin(engine);

      // Create physical sidecars first so we can join sidecar_embeddings with sidecars
      const specA: OkfFrontmatter = {
        title: 'Spec A',
        type: 'sidecar-spec',
        description: 'Spec A',
        tags: ['test'],
        status: 'spec',
        version: 1,
        target_code_file: './a.ts',
        status_flag: 'clean',
      };
      const specB: OkfFrontmatter = {
        title: 'Spec B',
        type: 'sidecar-spec',
        description: 'Spec B',
        tags: ['test'],
        status: 'spec',
        version: 1,
        target_code_file: './b.ts',
        status_flag: 'clean',
      };

      await engine.upsertSidecar({ filePath: 'src/a.ts.md', frontmatter: specA, body: '' });
      await engine.upsertSidecar({ filePath: 'src/b.ts.md', frontmatter: specB, body: '' });

      // Embed files
      await plugin.indexSidecar('src/a.ts.md', 'authentication and security tokens JWT');
      await plugin.indexSidecar('src/b.ts.md', 'database queries user profiles session');

      // Search for query highly similar to JWT Spec
      const results = await plugin.search('JWT security authentication token', {});
      expect(results.length).toBe(2);
      expect(results[0].filePath).toBe('src/a.ts.md');
      expect(results[0].rank).toBeGreaterThan(results[1].rank || 0);
    });
  });

  describe('Level 3 Search Plugin', () => {
    it('should fall back to mock embedding when transformers package is missing', async () => {
      const plugin = new Level3SearchPlugin(engine);
      const vector = await plugin.generateEmbedding('hello world offline');
      expect(vector.length).toBe(384);
      const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
      expect(magnitude).toBeCloseTo(1, 5);
    });

    it('should generate and store level-3 embeddings on indexSidecar', async () => {
      const plugin = new Level3SearchPlugin(engine);
      await plugin.indexSidecar('src/db/conn.ts.md', 'sqlite database connection pooling');

      const rows = await engine.all(
        'SELECT * FROM sidecar_embeddings WHERE file_path = ? AND engine = ?;',
        ['src/db/conn.ts.md', 'level-3'],
      );
      expect(rows.length).toBe(1);
      const emb = JSON.parse(rows[0].embedding);
      expect(emb.length).toBe(384);
    });

    it('should rank results correctly using Level 3 cosine similarity search', async () => {
      const plugin = new Level3SearchPlugin(engine);

      const specA: OkfFrontmatter = {
        title: 'Spec A',
        type: 'sidecar-spec',
        description: 'Spec A',
        tags: ['test'],
        status: 'spec',
        version: 1,
        target_code_file: './a.ts',
        status_flag: 'clean',
      };
      const specB: OkfFrontmatter = {
        title: 'Spec B',
        type: 'sidecar-spec',
        description: 'Spec B',
        tags: ['test'],
        status: 'spec',
        version: 1,
        target_code_file: './b.ts',
        status_flag: 'clean',
      };

      await engine.upsertSidecar({ filePath: 'src/a.ts.md', frontmatter: specA, body: '' });
      await engine.upsertSidecar({ filePath: 'src/b.ts.md', frontmatter: specB, body: '' });

      await plugin.indexSidecar('src/a.ts.md', 'database queries sqlite connection');
      await plugin.indexSidecar('src/b.ts.md', 'cryptographic key pairs and security certificate');

      const results = await plugin.search('sqlite database', {});
      expect(results.length).toBe(2);
      expect(results[0].filePath).toBe('src/a.ts.md');
      expect(results[0].rank).toBeGreaterThan(results[1].rank || 0);
    });
  });

  describe('GraphEngine Pluggable Routing', () => {
    const configDir = path.resolve('.stubs');
    const configPath = path.join(configDir, 'config.json');
    let originalConfig: string | null = null;

    beforeAll(() => {
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      if (fs.existsSync(configPath)) {
        originalConfig = fs.readFileSync(configPath, 'utf8');
      }
    });

    afterAll(() => {
      if (originalConfig !== null) {
        fs.writeFileSync(configPath, originalConfig, 'utf8');
      } else if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
    });

    it('should route search to Level 2 plugin when configured', async () => {
      const testConfig = {
        project_name: 'test-plugins',
        autonomy_level: 'strict_gate',
        paths: {
          specs_dir: 'src',
          templates_dir: '.stubs/templates',
          db_path: dbPath,
        },
        search: {
          engine: 'plugin-level-2',
          vector_plugin: null,
        },
        grill: {
          default_depth: 'standard_drill',
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(testConfig), 'utf8');

      // Create sidecar
      const spec: OkfFrontmatter = {
        title: 'User API Spec',
        type: 'sidecar-spec',
        description: 'User API',
        tags: ['api'],
        status: 'spec',
        version: 1,
        target_code_file: './user.ts',
        status_flag: 'clean',
      };

      // Since the engine is level-2, upsertSidecar will automatically index level-2 embedding!
      await engine.upsertSidecar({
        filePath: 'src/api/user.ts.md',
        frontmatter: spec,
        body: 'User API profile endpoint',
      });

      // Search using the engine, it should route to Level 2
      const results = await engine.search('User profile');
      expect(results.length).toBe(1);
      expect(results[0].filePath).toBe('src/api/user.ts.md');
      // For level 2 similarity search, rank represents cosine similarity which should be positive/close to 1
      expect(results[0].rank).toBeGreaterThan(0);
    });

    it('should route search to Level 3 plugin when configured', async () => {
      const testConfig = {
        project_name: 'test-plugins',
        autonomy_level: 'strict_gate',
        paths: {
          specs_dir: 'src',
          templates_dir: '.stubs/templates',
          db_path: dbPath,
        },
        search: {
          engine: 'plugin-level-3',
          vector_plugin: null,
        },
        grill: {
          default_depth: 'standard_drill',
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(testConfig), 'utf8');

      // Create sidecar
      const spec: OkfFrontmatter = {
        title: 'Billing API Spec',
        type: 'sidecar-spec',
        description: 'Billing API',
        tags: ['billing'],
        status: 'spec',
        version: 1,
        target_code_file: './billing.ts',
        status_flag: 'clean',
      };

      // Since the engine is level-3, upsertSidecar will automatically index level-3 embedding!
      await engine.upsertSidecar({
        filePath: 'src/api/billing.ts.md',
        frontmatter: spec,
        body: 'Billing invoice payment gateways',
      });

      // Search using the engine, it should route to Level 3
      const results = await engine.search('invoice gateways');
      expect(results.length).toBe(1);
      expect(results[0].filePath).toBe('src/api/billing.ts.md');
      expect(results[0].rank).toBeGreaterThan(0);
    });
  });
});

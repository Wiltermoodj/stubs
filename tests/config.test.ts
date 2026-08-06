import { loadConfig, DEFAULT_CONFIG } from '../src/config/schema';
import * as fs from 'fs';
import * as path from 'path';

describe('Config Loader & Schema', () => {
  it('should load default config when file does not exist', () => {
    const config = loadConfig('non-existent-config.json');
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('should load and validate custom configuration file', () => {
    const tempConfigPath = path.resolve(__dirname, 'temp_config.json');
    const customConfig = {
      project_name: 'custom-stubs',
      autonomy_level: 'guided_execution',
      paths: {
        specs_dir: 'custom-src',
        templates_dir: 'custom-templates',
        db_path: 'custom-db.sqlite',
      },
      search: {
        engine: 'plugin-level-2',
        vector_plugin: 'my-vector-plugin',
      },
      grill: {
        default_depth: 'deep_interrogation',
      },
    };

    fs.writeFileSync(tempConfigPath, JSON.stringify(customConfig), 'utf8');

    try {
      const config = loadConfig(tempConfigPath);
      expect(config.project_name).toBe('custom-stubs');
      expect(config.autonomy_level).toBe('guided_execution');
      expect(config.paths.specs_dir).toBe('custom-src');
      expect(config.paths.templates_dir).toBe('custom-templates');
      expect(config.paths.db_path).toBe('custom-db.sqlite');
      expect(config.search.engine).toBe('plugin-level-2');
      expect(config.search.vector_plugin).toBe('my-vector-plugin');
      expect(config.grill.default_depth).toBe('deep_interrogation');
    } finally {
      if (fs.existsSync(tempConfigPath)) {
        fs.unlinkSync(tempConfigPath);
      }
    }
  });

  it('should fallback to defaults when some config attributes are malformed', () => {
    const tempConfigPath = path.resolve(__dirname, 'temp_malformed_config.json');
    const malformedConfig = {
      project_name: 12345, // Invalid: should be string
      autonomy_level: 'invalid_level', // Invalid: should be strict_gate | guided_execution | autonomous
      paths: null, // Invalid
    };

    fs.writeFileSync(tempConfigPath, JSON.stringify(malformedConfig), 'utf8');

    try {
      const config = loadConfig(tempConfigPath);
      expect(config.project_name).toBe(DEFAULT_CONFIG.project_name);
      expect(config.autonomy_level).toBe('strict_gate');
      expect(config.paths).toEqual(DEFAULT_CONFIG.paths);
    } finally {
      if (fs.existsSync(tempConfigPath)) {
        fs.unlinkSync(tempConfigPath);
      }
    }
  });
});

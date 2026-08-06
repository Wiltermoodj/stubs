import * as fs from 'fs';
import * as path from 'path';

export interface StubsConfig {
  project_name: string;
  autonomy_level: 'strict_gate' | 'guided_execution' | 'autonomous';
  paths: {
    specs_dir: string;
    templates_dir: string;
    db_path: string;
  };
  search: {
    engine: 'sqlite-fts5' | 'plugin-level-2' | 'plugin-level-3';
    vector_plugin: string | null;
  };
  grill: {
    default_depth: 'light_probe' | 'standard_drill' | 'deep_interrogation';
  };
}

export const DEFAULT_CONFIG: StubsConfig = {
  project_name: 'stubs-project',
  autonomy_level: 'strict_gate',
  paths: {
    specs_dir: 'src',
    templates_dir: '.stubs/templates',
    db_path: '.stubs/graph.sqlite',
  },
  search: {
    engine: 'sqlite-fts5',
    vector_plugin: null,
  },
  grill: {
    default_depth: 'standard_drill',
  },
};

/**
 * Loads and validates stubs configuration.
 * Pulls parsing, validation, and default-fallback complexity downward.
 */
export function loadConfig(configPath?: string): StubsConfig {
  const resolvedPath = path.resolve(configPath || '.stubs/config.json');

  try {
    if (!fs.existsSync(resolvedPath)) {
      return { ...DEFAULT_CONFIG };
    }

    const content = fs.readFileSync(resolvedPath, 'utf8');
    const parsed = JSON.parse(content);

    // Validate and sanitize config
    return sanitizeConfig(parsed);
  } catch {
    // Return default config silently, defining errors out of existence for callers
    return { ...DEFAULT_CONFIG };
  }
}

function sanitizeConfig(raw: any): StubsConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_CONFIG };
  }

  const project_name =
    typeof raw.project_name === 'string' ? raw.project_name : DEFAULT_CONFIG.project_name;

  let autonomy_level: StubsConfig['autonomy_level'] = 'strict_gate';
  if (raw.autonomy_level === 'guided_execution' || raw.autonomy_level === 'autonomous') {
    autonomy_level = raw.autonomy_level;
  }

  const rawPaths = raw.paths || {};
  const paths = {
    specs_dir:
      typeof rawPaths.specs_dir === 'string' ? rawPaths.specs_dir : DEFAULT_CONFIG.paths.specs_dir,
    templates_dir:
      typeof rawPaths.templates_dir === 'string'
        ? rawPaths.templates_dir
        : DEFAULT_CONFIG.paths.templates_dir,
    db_path: typeof rawPaths.db_path === 'string' ? rawPaths.db_path : DEFAULT_CONFIG.paths.db_path,
  };

  const rawSearch = raw.search || {};
  let engine: StubsConfig['search']['engine'] = 'sqlite-fts5';
  if (rawSearch.engine === 'plugin-level-2' || rawSearch.engine === 'plugin-level-3') {
    engine = rawSearch.engine;
  }
  const search = {
    engine,
    vector_plugin: typeof rawSearch.vector_plugin === 'string' ? rawSearch.vector_plugin : null,
  };

  const rawGrill = raw.grill || {};
  let default_depth: StubsConfig['grill']['default_depth'] = 'standard_drill';
  if (rawGrill.default_depth === 'light_probe' || rawGrill.default_depth === 'deep_interrogation') {
    default_depth = rawGrill.default_depth;
  }
  const grill = { default_depth };

  return {
    project_name,
    autonomy_level,
    paths,
    search,
    grill,
  };
}

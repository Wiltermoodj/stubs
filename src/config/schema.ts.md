---
title: Config Schema — StubsConfig
type: sidecar-spec
description: >-
  Defines the StubsConfig interface, DEFAULT_CONFIG values, and the loadConfig()
  function that reads, validates, and sanitizes .stubs/config.json for all
  downstream engines. Pulls all config parsing complexity downward so callers
  receive a clean, type-safe config object or the safe default — never an error.
tags:
  - config
  - schema
  - foundation
module_depth: shallow
status: spec
version: 1
target_code_file: ./schema.ts
status_flag: clean
exports:
  - StubsConfig
  - DEFAULT_CONFIG
  - loadConfig
used_by:
  - src/graph/engine.ts
  - src/grill/engine.ts
  - src/materializer/engine.ts
  - src/sanding/engine.ts
  - src/autonomy/protocol.ts
  - src/cli/router.ts
---

# Config Schema — StubsConfig

Foundation module. Loaded by every engine at startup. Defines errors out of existence: a missing or malformed config file silently returns `DEFAULT_CONFIG` rather than throwing.

## Interface

```typescript
interface StubsConfig {
  project_name: string;
  autonomy_level: 'strict_gate' | 'guided_execution' | 'autonomous';
  paths: {
    specs_dir: string; // default: 'src'
    templates_dir: string; // default: '.stubs/templates'
    db_path: string; // default: '.stubs/graph.sqlite'
  };
  search: {
    engine: 'sqlite-fts5' | 'plugin-level-2' | 'plugin-level-3';
    vector_plugin: string | null;
  };
  grill: {
    default_depth: 'light_probe' | 'standard_drill' | 'deep_interrogation';
  };
  github_token?: string;
  remote?: {
    provider: 'github' | string;
    repo: string;
    default_branch: string;
  };
}
```

## Key Design Decisions

- `loadConfig(configPath?)` resolves to `.stubs/config.json` by default.
- `sanitizeConfig()` validates every field individually; invalid values fall back to defaults without throwing.
- `autonomy_level` defaults to `strict_gate` — the most conservative mode.
- Config is read synchronously (`fs.readFileSync`) since it is called once at startup before any async work begins.

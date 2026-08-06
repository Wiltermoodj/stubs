---
name: stubs-auditing
description: Perform static analysis, health checks, and graph validation across the workspace.
---

# Stubs Auditing Sub-Skill

## Execution Rules
1. Run `node .agents/skills/stubs/dist/cli.js audit --strict`.
2. Inspect for orphaned sidecars, broken `depends_on`/`used_by` graph links, shallow pass-through modules, and unhandled human directives.
3. Report health metrics and prompt user/agent to fix any `🛑 ERROR` or `⚠️ WARN` entries.

---
title: Template Engine — Handlebars/EJS Sidecar Renderer
type: sidecar-spec
description: >-
  Renders OKF sidecar template molds (.ts.md.tpl files) by translating
  Handlebars-style syntax ({{variable}}, {{#if}}, {{#each}}) into EJS-style
  tags and executing them via a compiled JavaScript function. Provides the
  TemplateEngine class for filesystem-based template management and the
  compileTemplate/translateHandlebarsToEjs pure functions for programmatic use.
tags:
  - templates
  - rendering
  - handlebars
  - ejs
  - scaffolding
module_depth: shallow
status: spec
version: 1
target_code_file: ./engine.ts
status_flag: clean
exports:
  - TemplateEngine
  - compileTemplate
  - translateHandlebarsToEjs
depends_on:
  - src/config/schema.ts
used_by:
  - src/cli/router.ts
---

# Template Engine — Handlebars/EJS Sidecar Renderer

Provides zero-dependency template rendering for OKF sidecar scaffolding. Templates use a Handlebars-compatible syntax that is transpiled to EJS then executed via `new Function()`.

## Template Syntax Support

| Handlebars       | EJS Equivalent                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `{{variable}}`   | `<%= variable %>`                                                                                            |
| `{{this}}`       | `<%= typeof item !== "undefined" ? item : "" %>`                                                             |
| `{{#if cond}}`   | `<% if (cond) { %>`                                                                                          |
| `{{else}}`       | `<% } else { %>`                                                                                             |
| `{{/if}}`        | `<% } %>`                                                                                                    |
| `{{#each list}}` | `<% if (typeof list !== "undefined" && Array.isArray(list)) { list.forEach(function(item) { with(item) { %>` |
| `{{/each}}`      | `<% } }); } %>`                                                                                              |

## Template File Convention

Templates are stored in `.stubs/templates/` with extension `.ts.md.tpl`. The `TemplateEngine` resolves template names by trying extensions in order: `.ts.md.tpl`, `.md.tpl`, `.tpl`, `.ts.md`, `.md`.

## Key Functions

### `translateHandlebarsToEjs(templateText: string): string`

Pure function. Translates template syntax via ordered regex replacements. `{{this}}` is translated first to prevent it matching the general `{{expr}}` pattern.

### `compileTemplate(templateText: string): (data: any) => string`

Compiles a template (after Handlebars→EJS translation) into an executable JavaScript function using `new Function('data', code)`. Expression evaluation is wrapped in `try/catch` to silently swallow undefined variable access.

## Key Design Decisions

- `new Function()` is used intentionally — templates are local developer-authored files, not user-provided untrusted input.
- `with(context || {})` and `with(item)` provide the ergonomic variable access in template expressions without requiring explicit context qualification.
- `listTemplates()` returns `[]` if the templates directory doesn't exist — callers never need to guard against a missing templates directory.
- `translateHandlebarsToEjs` ordering matters: `{{this}}` must precede `{{expr}}` to avoid `this` being treated as a general expression.

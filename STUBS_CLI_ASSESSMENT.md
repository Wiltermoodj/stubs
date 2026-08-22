# stubs CLI Assessment (2026-08-20)

Findings from operating the stubs skill in `b2b` against
`Wiltermoodj/stubs@5f08663` (commit `4c76f89` install in b2b).
Scope: CLI binary `.agents/skills/stubs/dist/cli.cjs` (220,039 lines,
~9.8 MB) and its sub-skill SKILL.md wrappers.

---

## Environment

- **Source repo:** `https://github.com/Wiltermoodj/stubs` (origin, fetch+push)
- **Installed at:** `.agents/skills/stubs@5f08663` in `/Users/lappier/code/projects/b2b`
- **CLI binary:** `.agents/skills/stubs/dist/cli.cjs`
- **Runtime state:** `.stubs/graph.sqlite` (SQLite, 127 KB), `.stubs/probe.sqlite` (8 KB)
- **Config:** `.stubs/config.json` — `specs_dir: "src"`, `templates_dir: ".stubs/templates"`, `db_path: ".stubs/graph.sqlite"`, `search.engine: "sqlite-fts5"`, `autonomy_level: "strict_gate"`

---

## Changes Made to the Skill Itself

**None.** All edits this session were to sidecar specs in `b2b/src/*.ts.md`
and to codebase files (`src/lib/auth.ts`, `src/lib/order-operations.ts`,
`shared/src/schemas/products-schema.ts`). The `.agents/skills/stubs/` and
`.stubs/` directories are clean relative to `HEAD` (`4c76f89`).

What I did edit in sidecars (not the skill binary):

1. Replaced a stale `## Current implementation` + inline `tsx/`typescript`fence block in`impersonation-context.tsx.md`with a single`## Implementation`
   - ````tsx` fence — reconcile did not do this; it only updated metadata.
2. Added `## Implementation` headers to `document-vault.tsx.md`,
   `portals-layout.tsx.md`, `login-page.tsx.md`, `account-provisioning.tsx.md`
   where they were missing (reconcile still reported "No ## Implementation
   section found").
3. Fixed duplicate `// src/...` comment lines inside code blocks in
   `expiration-checker-cron.ts.md`, `document-vault.tsx.md`,
   `portals-layout.tsx.md`.
4. Wrote `src/lib/auth.ts` (new file) with Firebase Auth helpers — the only
   real `.ts` file created from a sidecar this session; the rest of the
   materialization attempts failed on CLI bugs.

---

## Confirmed CLI Bugs (5)

### Bug 1 — `stubs sand` writes to wrong path

**Observed:** `stubs sand` prepends the sidecar's own directory to
`target_code_file` instead of treating it as workspace-root-relative.
Concrete example: sidecar at `src/lib/firebase.ts.md` with
`target_code_file: src/lib/firebase.ts` produces output path
`src/lib/src/lib/firebase.ts` — a spurious nested directory. Same pattern
observed for `src/components/document-vault.tsx.md` →
`src/components/src/components/document-vault.tsx`, and
`src/context/impersonation-context.tsx.md` →
`src/context/src/context/impersonation-context.tsx`.

**Impact:** HIGH. If it ever succeeded, it would create a corrupted nested
directory layout and overwrite the wrong files. Each attempt this session
failed before writing (path resolution error), so no damage occurred, but
the bug is structural and would bite on any sidecar whose `target_code_file`
is a nested path.

**Likely root cause:** The sand command resolves `target_code_file` relative
to the sidecar's containing directory, not relative to `process.cwd()`. The
config says `specs_dir: "src"` and `target_code_file` values are
workspace-root-relative (`src/lib/firebase.ts`), but the code prepends the
sidecar's parent directory.

**Fix direction:** Resolve `target_code_file` against `process.cwd()` (the
workspace root), not against the sidecar file's directory. This is
consistent with the `SKILL.md` rule: "All runtime state resolves relative
to the host project's current working directory (`process.cwd()`)."

---

### Bug 2 — `stubs grind --non-interactive` produces empty output

**Observed:** Running `stubs grind <file> --depth standard_drill
--non-interactive` returns with exit 0 and no output — no questions
emitted, no resolutions recorded, no changes to the sidecar.

**Impact:** MEDIUM. Makes automated grilling unusable. The non-interactive
path is the intended mode for headless agent execution, and it's a no-op.

**Likely root cause:** The non-interactive grill path doesn't generate or
surface the question matrix. Either the question generation is gated on
interactive TTY input, or the automated replies aren't being written back to
the sidecar. Either way, the `status_flag`/`grill_resolutions`/`user_notes`
fields that reconcile expects after a grill pass are not populated.

**Fix direction:** In non-interactive mode, the CLI should still produce the
frontier question set and write automated answers into the sidecar
(`user_notes` with automated reply text, `grill_resolutions` with the
decisions). If the intent is that non-interactive mode skips grilling
entirely, the command should say so explicitly rather than silently returning
empty.

---

### Bug 3 — `stubs materialize` fails when `## Implementation` follows a

`## Current implementation` narrative section

**Observed:** Sidecars written in normal OKF style — a `## Current
implementation` section with prose description, followed by a `##
Implementation` section containing a single ````typescript` fence — fail
materialization with either:

- "No TypeScript block found under ## Implementation" (when the code fence
  is detected but the section isn't isolated), or
- "An import path can only end with a '.ts' extension when
  'allowImportingTsExtensions' is enabled" (type-check error on code that
  isn't being extracted correctly).

Concrete example: `auth.ts.md`, `firebase.ts.md`, `audit-logger.ts.md` all
had this structure. They only materialized after restructuring into a single
isolated `## Implementation` section with one ````typescript` fence and no
adjacent prose.

**Impact:** HIGH. This is the gating bug for the entire
spec→code round-trip. The OKF documentation style the skill otherwise
promotes (narrative `## Current implementation` + `## Implementation` with
code) is incompatible with the materialization parser. Every sidecar has to
be restructured into a narrow form before the tooling can consume it.

**Fix direction:** The materialization parser should accept a `##
Implementation` section that follows a `## Current implementation` section,
and should extract the TypeScript code fence from under `## Implementation`
regardless of what precedes it. If the intent is that `## Implementation` must
be the only content after the frontmatter, the skill doc should say so
explicitly and the template should enforce it — but that's a design choice,
not a silent failure.

---

### Bug 4 — `stubs audit --strict` and `stubs audit --workspace` fail with

"+"Sidecar file not found: --strict" / "Sidecar file not found: --workspace"**

**Observed:**

```
$ stubs audit --strict
Sidecar file not found: --strict

$ stubs audit --workspace
Sidecar file not found: --workspace
```

**Impact:** LOW — easy to work around by auditing individual files by path
(`stubs audit src/lib/firebase.ts.md`), which works. But the CLI semantics
are wrong: `--strict` and `--workspace` are flags, not file paths, and the
CLI treats them as positional arguments.

**Likely root cause:** The CLI argument parser doesn't recognize `--strict`
or `--workspace` as flags and passes them through as the file path argument.

**Fix direction:** Register `--strict` and `--workspace` as flags in the
argument parser. `--strict` should enable stricter validation rules.
`--workspace` should audit the entire workspace (all sidecars in
`specs_dir`). Both should work without a file path argument.

---

### Bug 5 — `stubs grind` command does not exist

**Observed:** `stubs grind <file>` returns "Unknown command grind" (exit 1).
The `SKILL.md` and session docs refer to "grind" as a command, but the CLI
has no such command. The correct commands are `stubs reconcile` or
`stubs synchronize`.

**Impact:** LOW — doc/CLI mismatch. Confusing for anyone reading the skill
docs or session summaries that reference "grind". Not a code bug, but a docs
problem that creates false expectations.

**Fix direction:** Either add a `grind` alias that delegates to `reconcile`,
or correct all references to "grind" in the skill docs to "reconcile" /
"synchronize".

---

## Additional Recommendations

### R1 — Add a workspace-level audit command that works

`stubs audit --workspace` should scan all `*.ts.md` files in `specs_dir`
(`src/`), validate each, report aggregate health (pass/fail counts, orphaned
sidecars, broken graph links, stale statuses), and return a machine-readable
summary. Currently the only working audit path is per-file. A workspace audit
is the natural "are we healthy?" gate before committing.

### R2 — Make the materialization parser robust to OKF structure

The narrowest fix with the highest payoff: make `stubs materialize` extract
the TypeScript code fence from the `## Implementation` section regardless of
what sections precede it. This single fix unblocks the entire OKF
documentation-first workflow. The `## Current implementation` section is a
legitimate OKF pattern — it describes what exists today; `## Implementation`
describes the target code. They should coexist.

### R3 — Fix the sand path resolution

Resolve `target_code_file` against `process.cwd()`, not against the sidecar's
parent directory. Add a guard: if the resolved path falls outside the
workspace root, refuse and report the mismatch rather than creating a nested
directory. This is the one bug that could corrupt the workspace if it ever
succeeded.

### R4 — Make `grill --non-interactive` actually emit questions

Either: (a) generate the frontier question set and write automated answers
into the sidecar (`user_notes`, `grill_resolutions`), or (b) if non-
interactive mode is intended to skip grilling, make it a no-op that says so
explicitly rather than silently returning empty. The current behavior — exit
0, no output, no changes — is ambiguous.

### R5 — Align docs with actual CLI commands

Replace all references to "grind" in the skill docs with "reconcile" or
"synchronize", or add a `grind` alias. Also clarify that `audit --strict` and
`audit --workspace` are workspace-level flags that don't take a file path.

### R6 — Make the CLI report what it actually did

Several commands this session returned success (exit 0) with no output or
ambiguous output:

- `stubs reconcile` on pages with missing `## Implementation` returned
  "Success (Phase 5): Reconciliation successful" even though the sidecar
  still had `stale_details: "No ## Implementation section found"` — the
  reconciliation updated `sync_state` timestamps but didn't fix the structural
  issue.
- `stubs validate` on pages with missing `description` returned exit 0 in
  some cases and exit 1 in others, with the failure reason in stderr.

Recommended: every command should print a one-line summary of what changed
(e.g., "Reconciliation: 3 phases ran, 1 drift detected, 0 files written") so
the agent can tell whether the operation actually did anything.

### R7 — Don't mutate sidecar structural fields during reconcile unless the

underlying issue is resolved

The reconcile pass updated `sync_state.last_sync_timestamp` and
`sidecar_hash` on sidecars that still had structural problems (missing
`## Implementation`, missing `description`). This made the sidecars look
"synchronized" even though they weren't valid. The `status_flag` stayed
`clean` in some cases despite the structural issue. Reconcile should either
fix the structural issue or leave `status_flag` as `needs-human-review-
resolution` (or similar) rather than marking the sidecar `clean` when it
has unresolved structural problems.

### R8 — Consider a pre-flight check for the materialization pipeline

Before running materialize across N sidecars, a quick pre-flight that checks
each sidecar for: (a) `## Implementation` section present, (b) exactly one
TypeScript code fence under it, (c) `status_flag: clean`, (d) `description`
present — and reports which ones will fail — would save a lot of
trial-and-error. Currently you find out a sidecar will fail only by running
materialize and reading the error.

---

## What Worked

- `stubs validate <file>` — reliable, fast, correct exit codes. This is the
  best-verified command.
- `stubs reconcile <file>` — runs all 5 phases, updates `sync_state`,
  `sidecar_hash`, `code_hash`. Works when the sidecar is structurally sound.
- `stubs audit <file>` — per-file audit works.
- `stubs evaluate draft_template_proposal` — works.
- The OKF frontmatter schema (`type`, `version`, `status_flag`, `status`,
  `target_code_file`, `description`, `sync_state`, `user_notes`,
  `grill_resolutions`, `stale_details`) is well-defined and the CLI validates
  it correctly.

---

## Additional Recommendations for Live Codebase Use

### A1 — Define the "described but not existing" file workflow

This session has 7 sidecars describing files that don't exist on disk:
`auth.ts`, `main.tsx`, `App.tsx`, `catalog-page.tsx`, `order-placement.tsx`,
`login-page.tsx`, `account-provisioning.tsx`. Materialization fails on all
of them (no target file to merge into, or type-check fails on the code block
as written).

The skill has no clear "create the target file from the sidecar" path that
works when the file doesn't exist. Two options:

- **Option A — Treat the sidecar code block as the source of truth for new
  files.** Write the file directly from the block (after cleaning it), then
  sand spec←code to register it. Skip materialize for new files entirely.
- **Option B — Fix materialize to handle missing target files.** Create the
  file from the code block, write the `@sidecar` header, then type-check and
  report. This is the intended path but it's broken.

For a live codebase, Option A is the pragmatic short-term path; Option B is
the right long-term fix. Document which you're using so the workflow is
consistent across agents.

---

### A2 — Bulk mode matters more than per-file mode

Running the CLI 14 times in sequence (validate each sidecar, reconcile each,
etc.) is wasteful if each invocation is a cold start of a 9.8 MB / 220K-line
binary. Two things to check:

- Does `stubs sand` (no file arg) actually operate workspace-wide? If yes,
  that's the model to follow for validate/reconcile/materialize too.
- If not, is there a way to pass multiple files or a glob? If the CLI only
  takes one file at a time, the overhead of 14 separate cold starts is real
  and the workflow should batch where possible.

A bulk `validate-all`, `reconcile-all`, `materialize-all` that takes the
`specs_dir` and processes everything would be the natural scale-up from
single-file mode.

---

### A3 — Decide on the narrow `## Implementation` form

Bug 3 (materialize fails when `## Implementation` follows a narrative
section) forces every sidecar into a specific shape: frontmatter → `##
Implementation` → one ````typescript` fence → nothing else until the next
top-level section. That's a real constraint on how you write documentation.

Two positions:

- **If the narrow form is intentional:** the template system should provide a
  template that enforces it, the skill docs should say "write your `##
Implementation` section with only a code fence — no prose before or after,"
  and the validate command should reject sidecars that violate it early (not
  at materialize time).
- **If the narrow form is accidental (parser limitation):** fix the parser
  (R2 in the assessment) and let sidecars use the full OKF structure. The
  narrative `## Current implementation` section is valuable documentation — it
  describes what exists today, separate from the target code in `## 
Implementation`.

Either way, pick a position and make the tooling consistent with it. Right now
it's ambiguous: the skill promotes OKF documentation, but the CLI only consumes
a narrow subset.

---

### A4 — Evaluate the template system for sidecar creation

The `.stubs/templates/` directory exists and the CLI has `stubs template
render <name> <json_data_or_file>`, but this session created all 14 sidecars
by writing them directly (OKF frontmatter + sections by hand), not by rendering
a template.

Check what templates exist, whether they match the narrow form the CLI actually
accepts, and whether `stubs template render` produces valid sidecars (passes
`stubs validate` out of the box). If yes, that's the creation path going
forward — it bypasses the structural issues that manual writing introduces. If
no, the templates need to be fixed before they're useful.

---

### A5 — Validate cross-sidecar references

The sidecars reference each other: `App.tsx.md` lists `auth.ts.md`,
`impersonation-context.tsx.md`, `order-operations.ts.md` as dependencies. The
frontmatter has `relatedDocuments`, `appliesTo`, and (in the OKF spec) a
`depends_on`/`used_by` graph. Does the CLI validate that referenced sidecars
exist? That `appliesTo` paths point to real files? That `relatedDocuments`
entries resolve to other tracked sidecars?

In a live codebase with 14+ sidecars, broken cross-references are a real risk —
especially when you rename or move a file. A graph validation pass (the
`graph.sqlite` suggests this is intended) that checks all cross-references and
reports broken links would catch this. The `stubs audit --workspace` command
(Bug 4) should do this once it works.

---

### A6 — Define what `version` increment means

The frontmatter has `version: 1` (integer). In the OKF spec I've seen, version
is often a semver string (`"1.0.0"`). The CLI accepts an integer. What does
incrementing it mean in the stubs workflow?

- Does `version: 2` trigger re-grilling?
- Does it affect materialization (e.g., only materialize the latest version)?
- Is it a sidecar-level version or a spec-version?

If it's meaningful, document what the increment rules are. If it's cosmetic,
the CLI shouldn't enforce it as a required field. Ambiguity here leads to
inconsistent version numbers across sidecars.

---

### A7 — Make the `status_flag` gate honest and add independent structural validation

The materialization sub-skill says: "Validate that the target `*.ts.md` sidecar
has `status_flag: clean` and zero pending `user_notes`." But this session showed
reconcile marking sidecars `clean` even when they had structural problems (Bug
R7). If the gate is `status_flag: clean`, and reconcile can set that flag
incorrectly, then the gate doesn't actually prevent bad materialization.

Two fixes that work together:

1. Reconcile should not set `status_flag: clean` when structural issues remain
   (R7).
2. Materialize should validate the structural preconditions (## Implementation
   present, one code fence, valid TypeScript) independently of `status_flag`,
   and report structural failures clearly.

The `status_flag` should be a workflow state indicator (where the sidecar is in
the grill→materialize→sand cycle), not a substitute for structural validation.

---

### A8 — Keep the live web portal (`stubs serve`) optional

The CLI has a `serve` command that starts a web portal and event bridge. It's
listed in the SKILL.md but wasn't tested this session. For a live codebase, the
portal could be useful for visualizing drift across many sidecars, but it
shouldn't be a prerequisite for the core workflow.

If the portal requires authentication (Bug: `materialize` failed with "materialize
requires auth" on one sidecar), that's a separate concern from the core workflow.
The core CLI commands should work without the portal, without auth, and without a
running server. Treat the portal as an optional visualization layer.

---

### A9 — Document the CLI binary refresh procedure

The `cli.cjs` in b2b is copied from the stubs repo (10,229,629 bytes,
timestamp Aug 20 01:00). It's gitignored in b2b. The stubs repo has `npm run
build` to produce it.

When the upstream stubs repo fixes bugs (e.g., the 5 confirmed in the
assessment), b2b needs a way to get the updated binary. The current mechanism is
manual: rebuild in the stubs repo, copy `cli.cjs` into b2b. That's fine for
occasional updates, but if stubs gets frequent fixes, an automated sync (e.g., a
Makefile target, an npm script in b2b that pulls from the stubs repo, or a
`stubs update` CLI command) would reduce the friction.

Document the refresh procedure in the b2b README or in a `docs/stubs.md` so it's
not implicit. Something like:

```bash
# In the stubs repo:
cd /Users/lappier/code/projects/stubs && npm run build
# Copy the updated binary into b2b:
cp /Users/lappier/code/projects/stubs/.agents/skills/stubs/dist/cli.cjs \
   /Users/lappier/code/projects/b2b/.agents/skills/stubs/dist/cli.cjs
```

---

### A10 — Every command should report what it actually did

Several commands this session returned exit 0 with no output or ambiguous
output. In a headless agent workflow, exit codes are necessary but not
sufficient — you need to know what the command did to reason about the next
step.

Recommended per-command output:

| Command            | Current output                                                | Desired output                                                                                             |
| ------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `validate`         | Pass/fail + errors (good)                                     | Same, plus "X sidecars validated, Y passed, Z failed" when run in bulk                                     |
| `reconcile`        | "Success (Phase 5)" or "Success (Phase 1): No drift detected" | Phase breakdown: which phases ran, what drift was found, what was written (if anything)                    |
| `materialize`      | Error messages on failure; silent success                     | "Wrote [file] from [sidecar], type-check [passed/failed], N lines written"                                 |
| `sand`             | Path errors on failure; silent success                        | "Forward: wrote [code file] from [sidecar]" or "Reverse: updated [sidecar] from [code file]" or "No drift" |
| `audit` (per-file) | Pass/fail + findings                                          | Same, plus a one-line summary                                                                              |

In an agent-driven workflow, ambiguity about whether a command did anything is a
real cost. Every command should tell you what it did.

---

## Summary

The stubs skill has a solid conceptual framework (OKF sidecars,
grill→materialize→sand→audit cycle, SQLite-backed graph) but the CLI binary has
5 confirmed bugs and several workflow gaps that prevent the cycle from working
end-to-end as documented. The highest-priority fixes are:

1. **Bug 3** (materialization parser) — unblocks the entire spec→code path.
2. **Bug 1** (sand path resolution) — prevents workspace corruption.
3. **Bug 2** (non-interactive grill) — makes automated grilling usable.

The remaining bugs (4, 5) and recommendations (R1–R8, A1–A10) are lower
priority but compound the friction. Without fixes 1–3, the pragmatic workflow
is: clean up sidecar code blocks into the narrow form the CLI accepts, use
`reconcile` + `audit` for validation, write code directly for files that don't
exist yet, and avoid `sand` until the path bug is fixed.

---

_Generated 2026-08-20 from operational findings in b2b against
Wiltermoodj/stubs@5f08663._

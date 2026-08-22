#!/bin/bash
# This script seeds the stubs board with Phase 1 tasks for the contextloop smoke test.
# It uses the stubs board schema (which has body, assignee, status, worker_pid columns).

set -e

BOARD_DB="/Users/lappier/.hermes/kanban/boards/stubs/kanban.db"
REPO="/Users/lappier/code/projects/stubs"

# Helper: escape a string for SQLite
sqlite_escape() {
  printf '%s' "$1" | sed "s/'/''/g"
}

# Delete existing tasks (except t_gate_repair which is a standing gate)
sqlite3 "$BOARD_DB" "DELETE FROM tasks WHERE id NOT IN ('t_gate_repair');"

# Phase 1 task bodies (full content for each task)
# Each body includes role file content + objective + acceptance criteria + ownership

BODY_T_STUB01='
# Role: implementer

## Purpose
Make focused code changes within an explicit ownership boundary. Produce one artifact per task — a code change, a config change, a refactored module. Do not bundle unrelated changes into one task.

## Allowed tools
- file read
- file edit
- terminal

## Allowed skills
- file search (Hermes tool)
- skills/edit.md
- skills/build.md
- skills/test.md
- skills/debug.md

## Ownership rules
- Read files within the task'\''s ownership boundary (read-only).
- Write only to paths explicitly listed in the task body'\''s ## Ownership section.
- Write results to .kanban/results/t_stub01/worker-results.md (this directory is created by the orchestrator).
- Do not read or write files outside the task'\''s ownership boundary.

## Objective
Fix stubs materialize to extract the TypeScript code fence from the ## Implementation section regardless of what sections precede it (e.g., a ## Current implementation narrative section). This unblocks the entire OKF spec→code round-trip.

## Acceptance criteria
- [ ] A sidecar with ## Current implementation prose followed by ## Implementation + one typescript fence materializes successfully.
- [ ] The jwt.ts.md sidecar in src/ (which has this structure) should be tested for materialization.
- [ ] CI=true npm run build passes after the change.
- [ ] worker-results.md documents what was changed, where, and the verification.

## Ownership
- src/ write
- .agents/skills/stubs/dist/ write (rebuild cli.cjs)
- .stubs/ read-only
- .kanban/results/t_stub01/worker-results.md write-only

## Prior findings (if retried)
None — first attempt.

## What to change
The materialize parser in src/materializer/ should be modified to:
1. Find the ## Implementation section in the sidecar.
2. Extract the TypeScript code fence from under ## Implementation, regardless of what sections precede it.
3. If ## Current implementation precedes ## Implementation, treat them as separate sections and only extract from ## Implementation.

Do NOT modify STUBS_CLI_ASSESSMENT.md — it'\''s the input assessment.
'

BODY_T_STUB02='
# Role: implementer

## Purpose
Make focused code changes within an explicit ownership boundary. Produce one artifact per task — a code change, a config change, a refactored module. Do not bundle unrelated changes into one task.

## Allowed tools
- file read
- file edit
- terminal

## Allowed skills
- file search (Hermes tool)
- skills/edit.md
- skills/build.md
- skills/test.md
- skills/debug.md

## Ownership rules
- Read files within the task'\''s ownership boundary (read-only).
- Write only to paths explicitly listed in the task body'\''s ## Ownership section.
- Write results to .kanban/results/t_stub02/worker-results.md (this directory is created by the orchestrator).
- Do not read or write files outside the task'\''s ownership boundary.

## Objective
Fix stubs sand to resolve target_code_file against process.cwd() (workspace root), not against the sidecar'\''s parent directory. Add a guard: if the resolved path falls outside the workspace root, refuse and report the mismatch.

## Acceptance criteria
- [ ] stubs sand on a sidecar with target_code_file: src/lib/firebase.ts writes to src/lib/firebase.ts, not src/lib/src/lib/firebase.ts.
- [ ] A path outside the workspace root is rejected with a clear error message.
- [ ] CI=true npm run build passes after the change.
- [ ] worker-results.md documents what was changed, where, and the verification.

## Ownership
- src/ write
- .agents/skills/stubs/dist/ write (rebuild cli.cjs)
- .stubs/ read-only
- .kanban/results/t_stub02/worker-results.md write-only

## Prior findings (if retried)
None — first attempt.

## What to change
The sand command in src/sanding/ should be modified to:
1. Resolve target_code_file against process.cwd() (the workspace root).
2. Add a guard: if the resolved path falls outside the workspace root, refuse and report the mismatch.
3. The config says specs_dir: src and target_code_file values are workspace-root-relative.

Do NOT modify STUBS_CLI_ASSESSMENT.md — it'\''s the input assessment.
'

BODY_T_STUB03='
# Role: implementer

## Purpose
Make focused code changes within an explicit ownership boundary. Produce one artifact per task — a code change, a config change, a refactored module. Do not bundle unrelated changes into one task.

## Allowed tools
- file read
- file edit
- terminal

## Allowed skills
- file search (Hermes tool)
- skills/edit.md
- skills/build.md
- skills/test.md
- skills/debug.md

## Ownership rules
- Read files within the task'\''s ownership boundary (read-only).
- Write only to paths explicitly listed in the task body'\''s ## Ownership section.
- Write results to .kanban/results/t_stub03/worker-results.md (this directory is created by the orchestrator).
- Do not read or write files outside the task'\''s ownership boundary.

## Objective
Fix the non-interactive grill path (stubs grind --non-interactive or its equivalent reconcile/synchronize non-interactive path) to actually produce output: generate the frontier question set and write automated answers into the sidecar (user_notes, grill_resolutions), OR if non-interactive mode is intended to skip grilling, make it a no-op that says so explicitly rather than silently returning empty.

## Acceptance criteria
- [ ] Running the non-interactive grill path on a sidecar produces either questions+resolutions written to the sidecar, or an explicit "skipping grilling" message.
- [ ] Exit 0 with no output is no longer the behavior.
- [ ] CI=true npm run build passes after the change.
- [ ] worker-results.md documents what was changed, where, and the verification.

## Ownership
- src/ write
- .agents/skills/stubs/dist/ write (rebuild cli.cjs)
- .stubs/ read-only
- .kanban/results/t_stub03/worker-results.md write-only

## Prior findings (if retried)
None — first attempt.

## What to change
The grill/reconcile command in src/grill/ or src/cli/ should be modified to:
1. In non-interactive mode, either generate the frontier question set and write automated answers into the sidecar (user_notes with automated reply text, grill_resolutions with the decisions), or explicitly state that grilling is skipped.
2. The current behavior (exit 0, no output, no changes) is ambiguous and must be replaced with deterministic output.

Do NOT modify STUBS_CLI_ASSESSMENT.md — it'\''s the input assessment.
'

BODY_T_STUB04='
# Role: validator

## Purpose
Independently verify execution work against the task'\''s acceptance criteria. Read the task body (which contains the acceptance criteria), the execution worker'\''s results file, and the relevant source files. Report a verdict with evidence. Do not modify project files. Do not fix issues — report them.

## Allowed tools
- file read
- file search
- terminal

## Allowed skills
- file search (Hermes tool)
- skills/test.md
- skills/lint.md
- skills/review.md

## Ownership rules
- Read the task body (dispatch.md), the execution worker'\''s results file (worker-results.md), and source files within the task'\''s ownership boundary.
- Write results to .kanban/results/t_stub04/validator-results.md.
- Do not write to project source files, config files, or artifacts.
- Do not modify the execution worker'\''s results file.
- Read-only to everything except your own results file.

## Objective
Independently verify the three implementer fixes (B3 materialization parser, B1 sand path resolution, B2 non-interactive grill). Confirm each fix resolves its bug, the build still passes, and no regressions are introduced.

## Acceptance criteria
- [ ] B3: Demonstrate a sidecar with ## Current implementation + ## Implementation + code fence materializes successfully.
- [ ] B1: Demonstrate stubs sand writes to the correct path.
- [ ] B2: Demonstrate non-interactive grill produces output or explicit skip message.
- [ ] CI=true npm run build passes.
- [ ] CI=true npm test passes (if tests exist for the changed code; if not, note that).
- [ ] Findings cite specific file:line references.
- [ ] Verdict: pass or fail.

## Ownership
- src/ read-only
- .agents/skills/stubs/dist/ read-only
- .kanban/results/t_stub04/validator-results.md write-only

## What to check
Read these files:
- .kanban/results/t_stub01/worker-results.md (implementer B3 results)
- .kanban/results/t_stub02/worker-results.md (implementer B1 results)
- .kanban/results/t_stub03/worker-results.md (implementer B2 results)
- Source files in src/materializer/, src/sanding/, src/cli/, src/grill/ as relevant
- Run CI=true npm run build and CI=true npm test

Do NOT modify project files.
'

BODY_T_STUB05='
# Role: researcher

## Purpose
Discover information via web search, extraction, and file read. Produce findings — structured summaries of what was discovered, with sources. Do not modify project files. Do not produce code.

## Allowed tools
- web search
- web extract
- file read
- file search

## Allowed skills
- file search (Hermes tool)
- skills/web-research.md

## Ownership rules
- Read-only to project source files (within the scope specified in the task body).
- Write results to .kanban/results/t_stub05/worker-results.md.
- Do not write to project source files, config files, or artifacts.
- Do not modify the board directly — report findings in your results file; the orchestrator writes to the board.

## Objective
Research and document the fixes for B4 (audit --strict/--workspace flags) and B5 (grind command missing), and the R5 recommendation (align docs with actual CLI commands). Produce a findings file with concrete fix directions.

## Acceptance criteria
- [ ] Findings cover B4 fix direction (register --strict and --workspace as flags in the CLI argument parser).
- [ ] Findings cover B5 fix direction (add a grind alias that delegates to reconcile, or correct all references to grind in the skill docs).
- [ ] Findings cover R5 doc alignment (clarify that audit --strict and audit --workspace are workspace-level flags that don'\''t take a file path).
- [ ] At least one finding per bug/recommendation.
- [ ] Citations to relevant source files in src/cli/.
- [ ] worker-results.md documents the findings with sources.

## Ownership
- src/ read-only
- .stubs/ read-only
- .kanban/results/t_stub05/worker-results.md write-only

## Questions to answer
1. What is the current CLI argument parser in src/cli/router.ts? How are flags registered?
2. Where are the grind/reconcile/synchronize command definitions? Is there a grind command or is it missing?
3. What does the SKILL.md say about grind, audit --strict, audit --workspace? Are the docs aligned with the actual CLI?
4. What are the recommended fix directions for B4, B5, and R5?

Do NOT modify project files or STUBS_CLI_ASSESSMENT.md.
'

BODY_T_STUB06='
# Role: validator

## Purpose
Independently verify execution work against the task'\''s acceptance criteria. Read the task body (which contains the acceptance criteria), the execution worker'\''s results file, and the relevant source files. Report a verdict with evidence. Do not modify project files. Do not fix issues — report them.

## Allowed tools
- file read
- file search
- terminal

## Allowed skills
- file search (Hermes tool)
- skills/test.md
- skills/lint.md
- skills/review.md

## Ownership rules
- Read the task body (dispatch.md), the execution worker'\''s results file (worker-results.md), and source files within the task'\''s ownership boundary.
- Write results to .kanban/results/t_stub06/validator-results.md.
- Do not write to project source files, config files, or artifacts.
- Do not modify the execution worker'\''s results file.
- Read-only to everything except your own results file.

## Objective
Verify the B4/B5/R5 findings and assess whether they are actionable. Confirm the CLI behavior matches the documented bugs.

## Acceptance criteria
- [ ] Confirm stubs audit --strict and stubs audit --workspace fail with the reported error (Sidecar file not found: --strict / --workspace).
- [ ] Confirm stubs grind returns "Unknown command grind" (exit 1).
- [ ] Validate the fix directions from t_stub05 are correct and cite relevant source files.
- [ ] Findings cite specific file:line references.
- [ ] Verdict: pass or fail.

## Ownership
- src/ read-only
- .stubs/ read-only
- .kanban/results/t_stub06/validator-results.md write-only

## What to check
- Run stubs audit --strict and stubs audit --workspace; confirm the reported errors.
- Run stubs grind; confirm "Unknown command" error.
- Read the researcher'\''s findings in .kanban/results/t_stub05/worker-results.md.
- Read src/cli/router.ts and src/cli/auth.ts to understand the CLI argument parser.
- Read .agents/skills/stubs/SKILL.md to check doc alignment.

Do NOT modify project files.
'

BODY_T_STUB07='
# Role: reviewer

## Purpose
Assess the quality, design fit, risk, and maintainability of completed work. Review goes beyond acceptance criteria — the validator checks whether the criteria are met; the reviewer checks whether the work is good, sound, and fit for purpose. Review is for tasks where judgment matters: code quality, architecture fit, security posture, error handling adequacy, test coverage quality.

## Allowed tools
- file read
- file search
- terminal
- build

## Allowed skills
- file search (Hermes tool)
- .hermes/skills/contextloop/skills/review.md
- .hermes/skills/contextloop/skills/test.md

## Ownership rules
- Read the task body (dispatch.md), the execution worker'\''s results file (worker-results.md), the validator'\''s results file (validator-results.md), and the source files within the task'\''s ownership boundary.
- Write results to .kanban/results/t_stub07/reviewer-results.md.
- Do not write to project source files, config files, or artifacts.
- Do not modify the execution worker'\''s or validator'\''s results files.
- Read-only to everything except your own results file.

## Objective
Assess the quality, design fit, risk, and maintainability of the Phase 1 deliverables. Confirm the three bug fixes (B3, B1, B2) are correct, the CLI behavior is improved, and the assessment document'\''s recommendations are appropriately prioritized.

## Acceptance criteria
- [ ] Verdict: approve or request-changes.
- [ ] Assessment: min 20 chars.
- [ ] Findings with file:line refs and severity (low/medium/high/critical).
- [ ] Risks identified.
- [ ] reviewer-results.md documents the review.

## Ownership
- src/ read-only
- .agents/skills/stubs/dist/ read-only
- .kanban/results/t_stub07/reviewer-results.md write-only

## What to review
Read these files:
- .kanban/results/t_stub01/worker-results.md (implementer B3 results)
- .kanban/results/t_stub02/worker-results.md (implementer B1 results)
- .kanban/results/t_stub03/worker-results.md (implementer B2 results)
- .kanban/results/t_stub04/validator-results.md (validator B3/B1/B2 verification)
- .kanban/results/t_stub05/worker-results.md (researcher B4/B5/R5 findings)
- .kanban/results/t_stub06/validator-results.md (validator B4/B5/R5 verification)
- Source files in src/materializer/, src/sanding/, src/cli/, src/grill/ as relevant
- STUBS_CLI_ASSESSMENT.md (the input assessment)
- .agents/skills/stubs/SKILL.md (the skill documentation)

Do NOT modify project files.
'

# Seed the 7 tasks
sqlite3 "$BOARD_DB" <<SQL
INSERT OR REPLACE INTO tasks (id, title, body, assignee, status, priority, created_by, created_at, workspace_kind)
VALUES
  ('t_stub01', 'Implementer: Fix B3 materialization parser',
   '$(sqlite_escape "$BODY_T_STUB01")',
   'implementer', 'todo', 1, 'orchestrator', $(date +%s), 'scratch'),

  ('t_stub02', 'Implementer: Fix B1 sand path resolution',
   '$(sqlite_escape "$BODY_T_STUB02")',
   'implementer', 'todo', 1, 'orchestrator', $(date +%s), 'scratch'),

  ('t_stub03', 'Implementer: Fix B2 non-interactive grill',
   '$(sqlite_escape "$BODY_T_STUB03")',
   'implementer', 'todo', 1, 'orchestrator', $(date +%s), 'scratch'),

  ('t_stub04', 'Validator: Verify B3/B1/B2 fixes',
   '$(sqlite_escape "$BODY_T_STUB04")',
   'validator', 'todo', 2, 'orchestrator', $(date +%s), 'scratch'),

  ('t_stub05', 'Researcher: Document B4/B5 + R5',
   '$(sqlite_escape "$BODY_T_STUB05")',
   'researcher', 'todo', 2, 'orchestrator', $(date +%s), 'scratch'),

  ('t_stub06', 'Validator: Verify B4/B5/R5',
   '$(sqlite_escape "$BODY_T_STUB06")',
   'validator', 'todo', 2, 'orchestrator', $(date +%s), 'scratch'),

  ('t_stub07', 'Reviewer: Assess Phase 1 quality',
   '$(sqlite_escape "$BODY_T_STUB07")',
   'reviewer', 'todo', 3, 'orchestrator', $(date +%s), 'scratch');
SQL

echo "=== Seeded tasks ==="
sqlite3 "$BOARD_DB" "SELECT id, title, assignee, status, priority FROM tasks WHERE id LIKE 't_stub%' ORDER BY priority, id;"
echo "=== Done ==="

# STUBS — Phase 1: Fix & Validate CLI Bugs

## Objective

Fix the three highest-priority CLI bugs in the `stubs` project (B3 materialization parser, B1 sand path resolution, B2 non-interactive grill), verify each fix independently, and assess overall Phase 1 quality. The assessment document at `STUBS_CLI_ASSESSMENT.md` defines the bugs, impact levels, and fix directions.

## Tasks (pre-defined)

### t_stub01 — Implementer: Fix B3 materialization parser

- **Role:** implementer
- **Objective:** Fix `stubs materialize` to extract the TypeScript code fence from the `## Implementation` section regardless of what sections precede it (e.g., a `## Current implementation` narrative section). This unblocks the entire OKF spec→code round-trip.
- **Acceptance criteria:**
  - A sidecar with `## Current implementation` prose followed by `## Implementation` + one ````typescript` fence materializes successfully.
  - Existing sidecars in `src/` that previously failed (e.g., `jwt.ts.md`) should be tested.
  - `CI=true npm run build` passes after the change.
- **Ownership:** `src/` write; `.agents/skills/stubs/dist/cli.cjs` rebuild; `.stubs/` read-only.

### t_stub02 — Implementer: Fix B1 sand path resolution

- **Role:** implementer
- **Objective:** Fix `stubs sand` to resolve `target_code_file` against `process.cwd()` (workspace root), not against the sidecar's parent directory. Add a guard: if the resolved path falls outside the workspace root, refuse and report the mismatch.
- **Acceptance criteria:**
  - `stubs sand` on a sidecar with `target_code_file: src/lib/firebase.ts` writes to `src/lib/firebase.ts`, not `src/lib/src/lib/firebase.ts`.
  - Path outside workspace root is rejected with a clear error.
  - `CI=true npm run build` passes after the change.
- **Ownership:** `src/` write; `.agents/skills/stubs/dist/cli.cjs` rebuild.

### t_stub03 — Implementer: Fix B2 non-interactive grill

- **Role:** implementer
- **Objective:** Fix `stubs grind --non-interactive` (or its equivalent reconcile/synchronize non-interactive path) to actually produce output: generate the frontier question set and write automated answers into the sidecar (`user_notes`, `grill_resolutions`), OR if non-interactive mode is intended to skip grilling, make it a no-op that says so explicitly rather than silently returning empty.
- **Acceptance criteria:**
  - Running the non-interactive grill path on a sidecar produces either questions+resolutions written to the sidecar, or an explicit "skipping grilling" message.
  - Exit 0 with no output is no longer the behavior.
  - `CI=true npm run build` passes after the change.
- **Ownership:** `src/` write; `.agents/skills/stubs/dist/cli.cjs` rebuild.

### t_stub04 — Validator: Verify B3/B1/B2 fixes

- **Role:** validator
- **Objective:** Independently verify the three implementer fixes. Confirm each fix resolves its bug, the build still passes, and no regressions are introduced.
- **Acceptance criteria:**
  - B3: Demonstrate a sidecar with `## Current implementation` + `## Implementation` + code fence materializes successfully.
  - B1: Demonstrate `stubs sand` writes to the correct path.
  - B2: Demonstrate non-interactive grill produces output or explicit skip message.
  - `CI=true npm run build` passes.
  - `CI=true npm test` passes (if tests exist for the changed code).
  - Findings cite specific file:line references.
- **Ownership:** `src/` read-only; `.kanban/results/t_stub04/` write-only.

### t_stub05 — Researcher: Document B4/B5 + R5 doc alignment

- **Role:** researcher
- **Objective:** Research and document the fixes for B4 (audit `--strict`/`--workspace` flags) and B5 (grind command missing), and the R5 recommendation (align docs with actual CLI commands). Produce a findings file with concrete fix directions.
- **Acceptance criteria:**
  - Findings cover B4 fix direction (register `--strict` and `--workspace` as flags), B5 fix direction (add `grind` alias or correct docs), and R5 doc alignment.
  - At least one finding per bug/recommendation.
  - Citations to relevant source files in `src/cli/`.
- **Ownership:** `src/` read-only; `.kanban/results/t_stub05/` write-only.

### t_stub06 — Validator: Verify B4/B5/R5

- **Role:** validator
- **Objective:** Verify the B4/B5/R5 findings and assess whether they are actionable. Confirm the CLI behavior matches the documented bugs.
- **Acceptance criteria:**
  - Confirm `stubs audit --strict` and `stubs audit --workspace` fail with the reported error.
  - Confirm `stubs grind` returns "Unknown command".
  - Validate the fix directions are correct and cite relevant source files.
- **Ownership:** `src/` read-only; `.kanban/results/t_stub06/` write-only.

### t_stub07 — Reviewer: Assess Phase 1 quality

- **Role:** reviewer
- **Objective:** Assess the quality, design fit, risk, and maintainability of the Phase 1 deliverables. Confirm the three bug fixes are correct, the CLI behavior is improved, and the assessment document's recommendations are appropriately prioritized.
- **Acceptance criteria:**
  - Verdict: approve or request-changes.
  - Assessment: min 20 chars.
  - Findings with file:line refs and severity.
  - Risks identified.
- **Ownership:** `src/` read-only; `.kanban/results/t_stub07/` write-only.

## Completion criteria

- [ ] All 7 tasks are Done or archived.
- [ ] No InProgress tasks remain.
- [ ] No Blocked tasks remain (except triage).
- [ ] `CI=true npm run build` passes (the three implementer fixes don't break the build).
- [ ] Phase 1 completion marker written at `.hermes/skills/contextloop/phases/phase-1/cli-bug-fixes/completed.md`.

## Constraints

- Do NOT fix B4 or B5 in this phase unless an implementer task is explicitly dispatched for them. t_stub05 and t_stub06 are research/validation only.
- The CLI binary (`cli.cjs`) is rebuilt via `npm run build`. Workers must rebuild after source changes.
- `npm test` may have zero tests for the CLI code paths being changed — that's acceptable; the validator notes it.
- The `DESIGN_PHILOSOPHY.md` constraints apply to all code changes.
- Do NOT modify `STUBS_CLI_ASSESSMENT.md` — it's the input assessment, not a deliverable.

## Notes

- The CLI binary is 220K lines / 9.8 MB. Cold starts are expensive. Batch operations where possible.
- 14 sidecars exist in `src/` as `.ts.md` files. B3 affects materialization of any sidecar with the OKF narrative structure.
- The `src/jwt.ts.md` sidecar is a known B3 failure case (has `## Current implementation` + `## Implementation`).
- `npm run build` rebuilds `cli.cjs` and copies `sql-wasm.wasm`. Allow ~30s for rebuild.
- Existing `.kanban/kanban.db` has one task (`t_gate_repair`, phase-gate). This phase uses the contextloop board schema. The gate task is left untouched.

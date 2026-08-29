---
title: Grill Engine — Interactive Spec Interrogation
type: sidecar-spec
description: >-
  State machine engine that stress-tests OKF sidecar specifications through
  targeted question-and-answer interrogation sessions. Transitions through INIT
  → PARSING → GENERATING_QUESTIONS → GRILLING → SAVING → DONE states. Supports
  interactive (readline) and non-interactive (automated answer injection) modes.
  Writes Q&A results as user_notes entries into the sidecar frontmatter.
tags:
  - grill
  - interrogation
  - specification
  - state-machine
  - interactive
module_depth: deep
context_object: GrillEngineOptions
status: spec
version: 1
target_code_file: ./engine.ts
status_flag: needs-human-review-resolution
exports:
  - GrillState
  - GrillEngineOptions
  - GrillEngine
depends_on:
  - src/config/schema.ts
  - src/parser/okf.ts
  - src/graph/engine.ts
used_by:
  - src/cli/router.ts
stale_details: >-
  Conflict detected: Both sidecar and code files have been modified with
  structural AST differences.
---

# Grill Engine — Interactive Spec Interrogation

The Grill Engine acts as a design review enforcer. Given a sidecar spec, it generates targeted questions about the module's interface, constraints, error handling, and context objects — then records the answers as permanent `user_notes` ADR entries in the frontmatter.

## State Machine

```
INIT → PARSING → GENERATING_QUESTIONS → GRILLING → SAVING → DONE
                                                         ↘ ERROR
```

- **INIT:** Entry state; sets up options and resolves file path.
- **PARSING:** Reads and validates the OKF sidecar file.
- **GENERATING_QUESTIONS:** Calls `generateQuestions()` based on depth level.
- **GRILLING:** Prompts via readline (interactive) or auto-answers (non-interactive).
- **SAVING:** Writes updated frontmatter with Q&A recorded as `user_notes`.
- **DONE:** Terminal success state.
- **ERROR:** Terminal failure state; transitions here if file not found or OKF parse fails.

## Grill Depth Matrix

| Depth                | Questions | Focus                                                     |
| -------------------- | --------- | --------------------------------------------------------- |
| `light_probe`        | ~3        | Public interface, happy-path inputs/outputs               |
| `standard_drill`     | ~5–7      | Interface + constraints + error handling + context object |
| `deep_interrogation` | ~10+      | All of above + edge cases + performance + security        |

## Q&A Recording

Each question-answer pair is appended to `user_notes` with:

- `id`: `NOTE-GRILL-{timestamp}-{index}`
- `timestamp`: ISO string
- `text`: `Q: {question} | A: {answer}`
- `status`: `resolved`

The sidecar file status is set to `grilling` before the session begins and restored to the original status after saving.

## Key Design Decisions

- Status is set to `grilling` on the file immediately at the start of the session — even if the agent crashes, the file records that grilling was in-progress.
- Non-interactive mode (`options.nonInteractive = true`) accepts pre-provided `options.answers[]` or generates automated placeholder responses — enables agents to run grill without user input.
- `onStateChange` callback allows the CLI to display progress to the user without the engine knowing about output format.
- After grilling, the updated sidecar is re-indexed in GraphEngine.

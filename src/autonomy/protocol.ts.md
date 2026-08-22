---
title: Autonomy Protocol — 3-Tier Gate & 5-Phase Reconciliation
type: sidecar-spec
description: >-
  Implements the 3-Tier Autonomy Matrix that governs which actions an AI agent
  may execute autonomously, and runs the 5-Phase Retroactive Reconciliation
  Engine that detects drift, drafts proposals, performs 3-way merges, validates
  changes, and commits synchronized file updates. Used by the CLI audit/reconcile
  commands and integrates with the GraphEngine for hash synchronization.
tags:
  - autonomy
  - reconciliation
  - drift-detection
  - gating
  - protocol
module_depth: deep
context_object: AutonomyLevel
status: spec
version: 1
target_code_file: ./protocol.ts
status_flag: clean
exports:
  - AutonomyLevel
  - DriftReport
  - Proposal
  - ReconciliationResult
  - AutonomyProtocol
depends_on:
  - src/config/schema.ts
  - src/parser/okf.ts
  - src/graph/engine.ts
used_by:
  - src/cli/router.ts
  - src/materializer/engine.ts
---

# Autonomy Protocol — 3-Tier Gate & 5-Phase Reconciliation

The policy and reconciliation engine. It enforces action gates before code is written and runs the full reconciliation pipeline when `stubs audit`/`stubs reconcile` is called.

## 3-Tier Autonomy Matrix

| Level | `draft_template_proposal` | `scaffold_sidecar` | `materialize_code` |
|---|---|---|---|
| `strict_gate` | ✅ | ❌ | ❌ |
| `guided_execution` | ✅ | ✅ | ❌ |
| `autonomous` | ✅ | ✅ | ✅ |

`evaluateAction(actionType)` returns `{ allowed: boolean; reason: string }` — callers display the reason to users when blocked.

## 5-Phase Reconciliation Engine

```
Phase 1: Drift Detection
  → detectDrift(sidecarPath, sidecarContent, codePath, templateSource, templateContent)
  → DriftReport { templateChanged, sidecarChanged, codeChanged, hasDrift }

Phase 2: Draft Proposal (non-destructive)
  → draftProposal(...)
  → Proposal { proposedSidecarContent, proposedCodeContent, mergeStatus, conflicts }

Phase 3: Three-Way Merge
  → threeWayMerge(proposal, report)
  → mergedProposal (Proposal with resolved conflicts where possible)

Phase 4: Dry-Run Validation
  → dryRunValidation(mergedProposal)
  → { success: boolean; errors: string[] }
  [Exits here if validation fails, reports phase: 4]

Phase 5: Commit & Hash Synchronization
  → Write sidecar + code files
  → Compute SHA-256 hashes
  → Update sync_state in frontmatter
  → Re-index in GraphEngine
```

## DriftReport

```typescript
interface DriftReport {
  filePath: string;
  templateSource?: string;
  templateVersion?: string | number;
  templateChanged: boolean;
  sidecarChanged: boolean;
  codeChanged: boolean;
  hasDrift: boolean;
}
```

## Key Design Decisions

- `reconcile()` returns a `ReconciliationResult` with the phase number where execution stopped — callers can pinpoint exactly which phase failed.
- Phase 3 conflict detection is non-blocking by default: conflicts are reported in `proposal.conflicts` but only abort if `options.forceApply` is false. With `forceApply: true`, conflicting changes are applied anyway.
- Phase 4 validation is a structural/format check — it does not run the TypeScript compiler (that is the Materializer's responsibility).
- Phase 5 write is non-atomic at the protocol level (vs. MaterializerEngine's `writeAtomic`) — the assumption is that reconciliation is a supervised, human-reviewed operation.

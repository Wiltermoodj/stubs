---
name: stubs-grilling
description: Stress-test software designs and sidecar specs using frontier-based dependency tree rounds.
---

# Stubs Grilling Primitive

When refining or creating a `*.ts.md` specification sidecar, stress-test the design relentlessly before code materialization.

## Core Rules

1. **Design Tree Mapping:** Map the module's architecture as a tree of decisions (Interfaces, Context Objects, Error Handling, ADRs).
2. **Work the Frontier in Rounds:**
   - Identify all decisions whose prerequisites are already settled (the "Frontier").
   - Ask the entire frontier in ONE structured round.
   - For every question, provide a **recommended answer** (`➡️`).
   - Format each question cleanly: `❓ **Q[N]** - [Title]:` followed by body and recommendation.
3. **Facts vs. Decisions:**
   - **Facts (Agent's Job):** If a question depends on existing codebase state, run CLI tool checks or inspect files autonomously. NEVER ask the user something you can look up in the project.
   - **Decisions (User's Job):** Put design choices to the user and wait for round responses.
4. **Sidecar Output:** As decisions settle, write/update the YAML frontmatter and Markdown sections of the target `*.ts.md` sidecar.

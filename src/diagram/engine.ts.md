---
title: Diagram Engine — Living Mermaid Architecture & Sequence Exporter
type: sidecar-spec
description: >-
  Synthesizes living, GitHub-rendered Mermaid diagrams (flowchart TD, sequenceDiagram,
  and neighborhood slices) directly from the SQLite dependency graph and AST call
  edges. Provides automatic documentation synchronization for architectural context maps.
tags:
  - diagram
  - mermaid
  - architecture
  - visualization
  - sequence
module_depth: deep
context_object: DiagramEngine
status: spec
version: 1
target_code_file: ./engine.ts
status_flag: clean
exports:
  - DiagramEngine
  - DiagramOptions
  - DiagramResult
  - DiagramType
depends_on:
  - src/config/schema.ts
  - src/graph/engine.ts
  - src/lint/engine.ts
  - src/storage/index.ts
used_by:
  - src/cli/router.ts
---

# Diagram Engine — Living Mermaid Architecture & Sequence Exporter

The `DiagramEngine` extracts architectural topologies and call sequences from the graph database into standard Mermaid markdown diagrams.

## Key Methods

- `generateDiagram(target?, options)`: Universal entrypoint supporting `--type architecture`, `--type sequence`, `--type slice`.
- `generateArchitectureDiagram(options)`: Emits top-down `flowchart TD` grouped into Layer 0–6 or domain subgraphs.
- `generateSequenceDiagram(targetFile, options)`: Traces downstream call chains into a `sequenceDiagram`.
- `generateSliceDiagram(targetFile, options)`: Creates upstream/downstream neighborhood subgraphs.
- `syncDiagramToDocument(docPath, diagramContent)`: Preserves markdown structure while refreshing the diagram between `<!-- BEGIN STUBS DIAGRAM -->` markers.

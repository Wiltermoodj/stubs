# Agent Instructions

This document outlines the conventions and tooling rules AI agents must follow when operating in the `stubs` repository.

## Toolchain & Conventions
- **Package Manager:** `npm` (or `npx` for executing binaries).
- **Testing Framework:** `jest`.
- **Linter:** `eslint`.
- **Formatter:** `prettier`.
- **Design Principles:** All code changes must adhere strictly to the rules outlined in `DESIGN_PHILOSOPHY.md` (e.g., Deep Modules, Pulling Complexity Downward, Code Cohesion).

## CLI Commands
Agents should use the following commands to execute repository tasks:
- **Install Dependencies:** `npm install`
- **Build Project:** `npm run build`
- **Run Tests:** `npm test`
- **Lint Code:** `npm run lint`
- **Format Code:** `npm run format`
- **Start Local Server:** `npm start`

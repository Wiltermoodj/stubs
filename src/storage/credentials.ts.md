---
title: Storage — Credentials & Console Masking
type: sidecar-spec
description: >-
  Secures GitHub Personal Access Token (PAT) storage using AES-256-GCM
  encryption derived from a machine-unique PBKDF2 key. Credentials are
  persisted to ~/.stubs/credentials.json. Also provides applyGlobalConsoleMasking()
  which patches process.stdout and process.stderr to redact stored secrets from
  all console output at runtime.
tags:
  - storage
  - security
  - credentials
  - github
  - encryption
module_depth: deep
status: spec
version: 1
target_code_file: ./credentials.ts
status_flag: clean
exports:
  - getMachineUniqueKey
  - encrypt
  - decrypt
  - saveCredentials
  - loadCredentials
  - applyGlobalConsoleMasking
used_by:
  - src/cli/router.ts
  - src/server/github.ts
---

# Storage — Credentials & Console Masking

Security module. Handles PAT encryption/decryption and ensures tokens never appear in CLI output.

## Encryption Scheme

- **Algorithm:** AES-256-GCM with authentication tag
- **Key Derivation:** PBKDF2 (100,000 iterations, SHA-256)
- **Key Material:** Machine-unique string — `hostname-platform-arch-username`
- **IV:** 12-byte random per encryption
- **Salt:** 16-byte random per encryption

Encrypted payload is stored as a JSON object with fields: `encrypted`, `salt`, `iv`, `ciphertext`, `tag`.

## Console Masking

`applyGlobalConsoleMasking()` is called once at CLI startup (in `CliRouter.route()`). It patches `process.stdout.write` and `process.stderr.write` to find-and-replace any stored PAT value with `[REDACTED]` in all output.

## Credential File Location

`~/.stubs/credentials.json` — stored in the user home directory, outside any repository.

## Key Design Decisions

- `decrypt()` falls back to returning the plaintext unchanged if the payload is not in the encrypted JSON format — handles migration from older plaintext storage gracefully.
- Machine-unique key means credentials are not portable across machines (intentional — prevents credential leakage via repository sharing).
- `applyGlobalConsoleMasking()` is idempotent — safe to call multiple times.

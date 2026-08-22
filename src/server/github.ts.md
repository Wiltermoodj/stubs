---
title: GitHub API Integration — Remote Repository Bridge
type: sidecar-spec
description: >-
  Provides authenticated GitHub REST API access for remote repository operations:
  listing branches, reading and writing files, authenticating with PATs, and
  fetching repository metadata. Used by the PortalServer for the GitHub tab and
  by the install command to fetch skill bundles. Implements AES-256-GCM token
  encryption using a machine-unique key for in-memory token storage.
tags:
  - server
  - github
  - api
  - remote
  - authentication
module_depth: deep
status: spec
version: 1
target_code_file: ./github.ts
status_flag: clean
exports:
  - encryptToken
  - decryptToken
  - GitHubUser
  - GitHubRepo
  - GitHubBranch
  - GitHubFile
  - GitHubApiClient
depends_on:
  - src/config/schema.ts
  - src/storage/credentials.ts
used_by:
  - src/server/portal.ts
  - src/cli/router.ts
---

# GitHub API Integration — Remote Repository Bridge

Bridge between the stubs Web Portal and remote GitHub repositories. Enables mobile/browser users to read and write spec files on GitHub without local Node.js tooling.

## Token Encryption

Uses a simplified AES-256-GCM scheme with a machine-unique key derived from `hostname + username` (SHA-256 hashed to 32 bytes). This is a lighter-weight scheme than the `credentials.ts` PBKDF2 approach — intentional since this module handles in-session token storage, not persistent credential storage.

`decryptToken(encryptedData)` falls back to returning the input unchanged if it does not match the `iv:tag:ciphertext` format — handles plaintext PATs passed directly.

## GitHubApiClient

The main API client class. Constructed with a PAT and optional base repo/branch:

### Key Methods
| Method | GitHub API |
|---|---|
| `getAuthenticatedUser()` | `GET /user` |
| `listUserRepos()` | `GET /user/repos` |
| `listBranches(repo)` | `GET /repos/{repo}/branches` |
| `getFile(repo, path, branch?)` | `GET /repos/{repo}/contents/{path}` |
| `listDirectory(repo, path, branch?)` | `GET /repos/{repo}/contents/{path}` |
| `createOrUpdateFile(repo, path, content, message, sha?, branch?)` | `PUT /repos/{repo}/contents/{path}` |
| `deleteFile(repo, path, message, sha, branch?)` | `DELETE /repos/{repo}/contents/{path}` |

### Authentication
All requests use `Authorization: token {pat}` header. Rate limit information is available via `X-RateLimit-*` response headers.

## Key Design Decisions

- `GitHubApiClient` validates the PAT on construction via `getAuthenticatedUser()` — fails fast rather than surfacing 401 errors later.
- File content is Base64-encoded/decoded per the GitHub Contents API contract.
- `createOrUpdateFile` requires the existing file SHA for updates — callers must `getFile()` first to retrieve the SHA before modifying.
- All API errors return typed error objects rather than throwing — compatible with the "define errors out of existence" philosophy for Web Portal SSE responses.

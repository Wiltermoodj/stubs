import * as fs from 'fs';
import * as path from 'path';
import { SandingEngine } from '../src/sanding/engine';

describe('Bi-Directional Reconciler (SandingEngine)', () => {
  const tempDir = path.resolve('tests/temp-sanding-test');
  const sidecarFile = path.join(tempDir, 'auth-spec.ts.md');
  const codeFile = path.join(tempDir, 'auth-spec.ts');

  beforeAll(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    if (fs.existsSync(sidecarFile)) fs.unlinkSync(sidecarFile);
    if (fs.existsSync(codeFile)) fs.unlinkSync(codeFile);
  });

  it('should materialize code file if missing', async () => {
    const sidecarContent = `---
title: Auth Spec
type: sidecar-spec
description: JWT Spec
tags: []
status: spec
version: 1
target_code_file: ./auth-spec.ts
status_flag: clean
---
## Implementation
\`\`\`typescript
export function greet(): string {
  return "hello";
}
\`\`\`
`;
    fs.writeFileSync(sidecarFile, sidecarContent, 'utf8');

    const engine = new SandingEngine();
    const result = await engine.syncFile(sidecarFile);

    expect(result.status).toBe('synced');
    expect(result.direction).toBe('materialized');
    expect(fs.existsSync(codeFile)).toBe(true);

    const materialized = fs.readFileSync(codeFile, 'utf8');
    expect(materialized).toContain('export function greet');
    expect(materialized).toContain('// @sidecar');
  });

  it('should report no_change if both files match recorded sync hashes', async () => {
    // 1. Initial Materialize to get valid hashes
    const sidecarContent = `---
title: Auth Spec
type: sidecar-spec
description: JWT Spec
tags: []
status: spec
version: 1
target_code_file: ./auth-spec.ts
status_flag: clean
---
## Implementation
\`\`\`typescript
export function greet(): string {
  return "hello";
}
\`\`\`
`;
    fs.writeFileSync(sidecarFile, sidecarContent, 'utf8');

    const engine = new SandingEngine();
    await engine.syncFile(sidecarFile);

    // 2. Sync again immediately
    const result = await engine.syncFile(sidecarFile);
    expect(result.status).toBe('no_change');
  });

  it('should sync sidecar-to-code if sidecar was updated', async () => {
    // 1. Initial sync
    const sidecarContent = `---
title: Auth Spec
type: sidecar-spec
description: JWT Spec
tags: []
status: spec
version: 1
target_code_file: ./auth-spec.ts
status_flag: clean
---
## Implementation
\`\`\`typescript
export function greet(): string {
  return "v1";
}
\`\`\`
`;
    fs.writeFileSync(sidecarFile, sidecarContent, 'utf8');

    const engine = new SandingEngine();
    await engine.syncFile(sidecarFile);

    // 2. Modify sidecar file
    const updatedSidecar = fs.readFileSync(sidecarFile, 'utf8');
    const modifiedSidecar = updatedSidecar.replace('v1', 'v2');
    fs.writeFileSync(sidecarFile, modifiedSidecar, 'utf8');

    // 3. Sync again — should push sidecar change to code
    const result = await engine.syncFile(sidecarFile);
    expect(result.status).toBe('synced');
    expect(result.direction).toBe('sidecar_to_code');

    const code = fs.readFileSync(codeFile, 'utf8');
    expect(code).toContain('v2');
  });

  it('should sync code-to-sidecar if code was updated', async () => {
    // 1. Initial sync
    const sidecarContent = `---
title: Auth Spec
type: sidecar-spec
description: JWT Spec
tags: []
status: spec
version: 1
target_code_file: ./auth-spec.ts
status_flag: clean
---
## Implementation
\`\`\`typescript
export function greet(): string {
  return "v1";
}
\`\`\`
`;
    fs.writeFileSync(sidecarFile, sidecarContent, 'utf8');

    const engine = new SandingEngine();
    await engine.syncFile(sidecarFile);

    // 2. Modify code file
    const modifiedCode = 'export function greet(): string {\n  return "v2";\n}\n';
    fs.writeFileSync(codeFile, modifiedCode, 'utf8');

    // 3. Sync again — should pull code change to sidecar
    const result = await engine.syncFile(sidecarFile);
    expect(result.status).toBe('synced');
    expect(result.direction).toBe('code_to_sidecar');

    const sidecar = fs.readFileSync(sidecarFile, 'utf8');
    expect(sidecar).toContain('v2');
  });

  it('should resolve non-structural conflict automatically based on modification time', async () => {
    // 1. Initial sync
    const sidecarContent = `---
title: Auth Spec
type: sidecar-spec
description: JWT Spec
tags: []
status: spec
version: 1
target_code_file: ./auth-spec.ts
status_flag: clean
---
## Implementation
\`\`\`typescript
export function greet(): string {
  return "v1";
}
\`\`\`
`;
    fs.writeFileSync(sidecarFile, sidecarContent, 'utf8');

    const engine = new SandingEngine();
    await engine.syncFile(sidecarFile);

    // 2. Modify both files (simulated conflict)
    const modifiedSidecar = fs.readFileSync(sidecarFile, 'utf8').replace('v1', 'sidecar-v2');
    fs.writeFileSync(sidecarFile, modifiedSidecar, 'utf8');

    const modifiedCode = 'export function greet(): string {\n  return "code-v2";\n}\n';
    fs.writeFileSync(codeFile, modifiedCode, 'utf8');

    // 3. Sync — newer file wins (non-structural conflict)
    const result = await engine.syncFile(sidecarFile);
    expect(result.status).toBe('synced');
    expect(result.conflict_resolved).toBe(true);
  });

  it('should flag true structural conflict as needs-human-review-resolution', async () => {
    // 1. Initial sync
    const sidecarContent = `---
title: Auth Spec
type: sidecar-spec
description: JWT Spec
tags: []
status: spec
version: 1
target_code_file: ./auth-spec.ts
status_flag: clean
---
## Implementation
\`\`\`typescript
export function greet(name: string): string {
  return "hello, " + name;
}
\`\`\`
`;
    fs.writeFileSync(sidecarFile, sidecarContent, 'utf8');

    const engine = new SandingEngine();
    await engine.syncFile(sidecarFile);

    // 2. Create a structural conflict: same function, different signatures
    const conflictingSidecar = `---
title: Auth Spec
type: sidecar-spec
description: JWT Spec
tags: []
status: spec
version: 1
target_code_file: ./auth-spec.ts
status_flag: clean
---
## Implementation
\`\`\`typescript
export function greet(name: string): string {
  return "hello, " + name;
}
\`\`\`
`;
    fs.writeFileSync(sidecarFile, conflictingSidecar, 'utf8');

    const modifiedCode = 'export function greet(): string {\n  return "v2";\n}\n';
    fs.writeFileSync(codeFile, modifiedCode, 'utf8');

    // 3. Sync — should detect structural conflict
    const result = await engine.syncFile(sidecarFile);
    expect(result.status).toBe('conflict');
    expect(result.resolution).toBe('needs-human-review-resolution');
  });
});

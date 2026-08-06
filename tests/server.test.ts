import * as fs from 'fs';
import * as path from 'path';
import { GraphEngine } from '../src/graph/engine';
import { PortalServer } from '../src/server/portal';

describe('PortalServer & SSE Event Bridge', () => {
  const dbPath = path.resolve(__dirname, 'temp_test_server.sqlite');
  const specsDir = path.resolve(__dirname, 'temp_specs_dir');
  const port = 3005;
  let graphEngine: GraphEngine;
  let server: PortalServer;

  beforeEach(async () => {
    // Setup clean db & workspace directories
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    if (fs.existsSync(specsDir)) {
      fs.rmSync(specsDir, { recursive: true, force: true });
    }
    fs.mkdirSync(specsDir, { recursive: true });

    graphEngine = new GraphEngine(dbPath);
    await graphEngine.initialize();

    // Write a dummy sidecar specification to actual disk so the indexWorkspace scanner can find it on startup
    const actualFilePath = path.join(specsDir, 'auth.ts.md');
    fs.writeFileSync(
      actualFilePath,
      `---
title: "Auth Handler Spec"
type: "sidecar-spec"
description: "Handles token and authentication details"
tags: ["auth", "security"]
status: "spec"
version: 1
target_code_file: "./auth.ts"
status_flag: "clean"
user_notes:
  - id: "NOTE-99"
    timestamp: "2026-08-05T10:00:00Z"
    text: "Must support RSA keys"
    status: "pending"
---
\`\`\`typescript
export function verify();
\`\`\`
`,
      'utf8',
    );

    // Initialize custom config for test
    const customConfigPath = path.resolve(__dirname, 'temp_config.json');
    const customConfig = {
      project_name: 'test-server-project',
      autonomy_level: 'strict_gate',
      paths: {
        specs_dir: path.relative(process.cwd(), specsDir).replace(/\\/g, '/'),
        templates_dir: '.stubs/templates',
        db_path: path.relative(process.cwd(), dbPath).replace(/\\/g, '/'),
      },
      search: {
        engine: 'sqlite-fts5',
        vector_plugin: null,
      },
      grill: {
        default_depth: 'standard_drill',
      },
    };
    fs.writeFileSync(customConfigPath, JSON.stringify(customConfig, null, 2), 'utf8');

    server = new PortalServer(graphEngine, port, customConfigPath);
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    await graphEngine.close();

    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    if (fs.existsSync(specsDir)) {
      fs.rmSync(specsDir, { recursive: true, force: true });
    }
    const customConfigPath = path.resolve(__dirname, 'temp_config.json');
    if (fs.existsSync(customConfigPath)) {
      fs.unlinkSync(customConfigPath);
    }
  });

  const getUrl = (pathname: string) => `http://localhost:${port}${pathname}`;

  test('GET / should return the HTML dashboard', async () => {
    const res = await fetch(getUrl('/'));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<!DOCTYPE html>');
    expect(text).toContain('stubs Web Portal');
  });

  test('GET /api/graph should return indexed sidecars and project metadata', async () => {
    const res = await fetch(getUrl('/api/graph'));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.projectName).toBe('test-server-project');
    expect(data.sidecars.length).toBe(1);
    expect(data.sidecars[0].filePath).toContain('auth.ts.md');
    expect(data.sidecars[0].frontmatter.title).toBe('Auth Handler Spec');
  });

  test('GET /api/directives should return pending directives', async () => {
    const res = await fetch(getUrl('/api/directives'));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.directives.length).toBe(1);
    expect(data.directives[0].id).toBe('NOTE-99');
    expect(data.directives[0].text).toBe('Must support RSA keys');
  });

  test('GET /api/search should support tag filters and text queries', async () => {
    const res1 = await fetch(getUrl('/api/search?q=verify'));
    expect(res1.status).toBe(200);
    const data1 = (await res1.json()) as any;
    expect(data1.results.length).toBe(1);

    const res2 = await fetch(getUrl('/api/search?tags=security'));
    expect(res2.status).toBe(200);
    const data2 = (await res2.json()) as any;
    expect(data2.results.length).toBe(1);
  });

  test('GET /api/sidecar should return details for valid path, and 404 for missing', async () => {
    const files = await graphEngine.getFilesIndexed();
    const filePath = files[0];

    const res1 = await fetch(getUrl(`/api/sidecar?path=${encodeURIComponent(filePath)}`));
    expect(res1.status).toBe(200);
    const data1 = (await res1.json()) as any;
    expect(data1.sidecar.filePath).toBe(filePath);

    const res2 = await fetch(getUrl('/api/sidecar?path=non_existent_file.ts.md'));
    expect(res2.status).toBe(404);
  });

  test('GET /api/events should establish SSE stream and stream connected message', async () => {
    const controller = new AbortController();
    const res = await fetch(getUrl('/api/events'), { signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');

    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('connected');

    controller.abort();
  });

  test('Filesystem watch updates trigger re-indexing and broadcast update', async () => {
    const controller = new AbortController();
    const res = await fetch(getUrl('/api/events'), { signal: controller.signal });
    const reader = res.body!.getReader();

    // Consume initial 'connected' message
    await reader.read();

    // Modify the file to trigger watch event
    const actualFilePath = path.join(specsDir, 'auth.ts.md');
    fs.writeFileSync(
      actualFilePath,
      `---
title: "updated_title"
type: "sidecar-spec"
description: "Handles token and authentication details"
tags: ["auth", "security"]
status: "spec"
version: 1
target_code_file: "./auth.ts"
status_flag: "clean"
user_notes:
  - id: "NOTE-99"
    timestamp: "2026-08-05T10:00:00Z"
    text: "Must support RSA keys"
    status: "pending"
---
\`\`\`typescript
export function verify();
\`\`\`
`,
      'utf8',
    );

    // Read loop to await update broadcast
    const readPromise = async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = new TextDecoder().decode(value);
        if (text.includes('event: update')) {
          expect(text).toContain('updated_title');
          return;
        }
      }
    };

    await Promise.race([
      readPromise(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout waiting for watch update')), 8000),
      ),
    ]);

    controller.abort();
  }, 10000);

  test('POST /api/v1/directives should add pending note to the sidecar', async () => {
    const files = await graphEngine.getFilesIndexed();
    const filePath = files[0];

    const payload = {
      filePath,
      text: 'New Directive Added',
    };

    const res = await fetch(getUrl('/api/v1/directives'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.note.text).toBe('New Directive Added');
    expect(data.note.status).toBe('pending');

    // Verify it is in the database now as well
    const dirsRes = await fetch(getUrl('/api/v1/directives?status=pending'));
    const dirsData = (await dirsRes.json()) as any;
    const addedNote = dirsData.directives.find((d: any) => d.id === data.note.id);
    expect(addedNote).toBeDefined();
    expect(addedNote.text).toBe('New Directive Added');
  });

  test('POST /api/v1/directives/resolve should resolve a pending note', async () => {
    const files = await graphEngine.getFilesIndexed();
    const filePath = files[0];

    // Verify existing pending note
    const pendingRes = await fetch(getUrl('/api/v1/directives?status=pending'));
    const pendingData = (await pendingRes.json()) as any;
    const noteId = pendingData.directives[0].id;

    // Resolve note
    const res = await fetch(getUrl('/api/v1/directives/resolve'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath, id: noteId }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.note.status).toBe('resolved');

    // Verify status is updated to resolved
    const resolvedRes = await fetch(getUrl('/api/v1/directives?status=resolved'));
    const resolvedData = (await resolvedRes.json()) as any;
    const resolvedNote = resolvedData.directives.find((d: any) => d.id === noteId);
    expect(resolvedNote).toBeDefined();
    expect(resolvedNote.status).toBe('resolved');
  });

  test('GET /api/v1/templates should list registered templates and drafts', async () => {
    const res = await fetch(getUrl('/api/v1/templates'));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.templates.length).toBeGreaterThanOrEqual(1);

    // One of them should be a draft template containing "-provisional"
    const provisional = data.templates.find((t: any) => t.isDraft === true);
    expect(provisional).toBeDefined();
    expect(provisional.name).toContain('provisional');
  });

  test('POST /api/v1/templates/approve should approve/rename or reject/delete a draft template', async () => {
    const templatesRes = await fetch(getUrl('/api/v1/templates'));
    const templatesData = (await templatesRes.json()) as any;
    const provisional = templatesData.templates.find((t: any) => t.isDraft === true);
    expect(provisional).toBeDefined();

    // Approve provisional template
    const res = await fetch(getUrl('/api/v1/templates/approve'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateName: provisional.name, approved: true }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.message).toContain('approved and renamed');

    // Check templates list again, the draft should be renamed (so no drafts or different name)
    const templatesRes2 = await fetch(getUrl('/api/v1/templates'));
    const templatesData2 = (await templatesRes2.json()) as any;
    const provisionalAfter = templatesData2.templates.find((t: any) => t.name === provisional.name);
    expect(provisionalAfter).toBeUndefined();
  });
});

import { promises as fs, existsSync } from 'fs';
import * as path from 'path';
import { parseOkfSpec } from '../parser/okf';
import { GraphEngine } from '../graph/engine';
import { TemplateEngine } from '../templates/engine';
import { AutonomyProtocol } from '../autonomy/protocol';
import { PortalServer } from '../server/portal';
import { loadConfig } from '../config/schema';
import { SandingEngine, SyncResult } from '../sanding/engine';
import { MaterializerEngine } from '../materializer/engine';
import { applyGlobalConsoleMasking } from '../storage/credentials';

export interface CliContext {
  configPath?: string;
  command?: string;
  args: string[];
}

export class CliRouter {
  /**
   * Main entry point to route the CLI command.
   * Pulls all routing and option parsing complexity downward, returning exit code.
   */
  public async route(argv: string[]): Promise<number> {
    try {
      applyGlobalConsoleMasking();
      const context = this.parseArgs(argv);

      // Handle help/version flags early
      if (argv.includes('--help') || argv.includes('-h') || context.command === 'help') {
        this.printHelp();
        return 0;
      }
      if (argv.includes('--version') || argv.includes('-v') || context.command === 'version') {
        await this.printVersion();
        return 0;
      }

      if (!context.command) {
        this.printHelp();
        return 0;
      }

      switch (context.command) {
        case 'init':
          return await this.handleInit(context);
        case 'serve':
          return await this.handleServe(context);
        case 'validate':
          return await this.handleValidate(context);
        case 'template':
          return await this.handleTemplate(context);
        case 'audit':
        case 'reconcile':
          return await this.handleReconcile(context);
        case 'evaluate':
          return await this.handleEvaluate(context);
        case 'grill':
          return await this.handleGrill(context);
        case 'sand':
        case 'sync':
          return await this.handleSync(context);
        case 'map':
          return await this.handleMap(context);
        case 'materialize':
          return await this.handleMaterialize(context);
        case 'auth':
          return await this.handleAuth(context);
        case 'install':
          return await this.handleInstall(context);
        default:
          console.error(`Error: Unknown command "${context.command}". Use --help for usage.`);
          return 1;
      }
    } catch (error: any) {
      console.error(`CLI execution failed: ${error.message || error}`);
      return 1;
    }
  }

  private parseArgs(argv: string[]): CliContext {
    const context: CliContext = { args: [] };
    let i = 0;
    while (i < argv.length) {
      const arg = argv[i];
      if (arg === '-c' || arg === '--config') {
        context.configPath = argv[i + 1];
        i += 2;
      } else if (arg.startsWith('--config=')) {
        context.configPath = arg.split('=')[1];
        i++;
      } else if (!context.command && !arg.startsWith('-')) {
        context.command = arg;
        i++;
      } else {
        context.args.push(arg);
        i++;
      }
    }
    return context;
  }

  private printHelp(): void {
    console.log(`
stubs - AI Agent Sidecar Specification Framework

Usage:
  stubs <command> [options]

Commands:
  init                Initialize workspace configuration (.stubs/config.json).
  auth login          Authenticate via Personal Access Tokens (PATs) and store globally.
  install             Fetch and install stubs skill and assets into the workspace.
  grill <file>       Execute the Interactive Grill Engine on a sidecar specification.
  materialize <file>  Parse, extract, typecheck, and write executable code from sidecar.
  audit <file>        Audit sidecar specifications and run retroactive reconciliation.
  sand [file]         Synchronize sidecars and code files.
  reconcile <file>    Execute the 5-phase retroactive reconciliation engine on a sidecar.
  sync [file]         Synchronize sidecars and code files.
  map [options]       Audit or scaffold architectural context maps (knowledge/architecture/context-map.md).
  template <action>   Manage template molds. Actions: list, render <name> <json_data_or_file>
  evaluate <action>   Evaluate autonomy permission. Actions: draft_template_proposal, scaffold_sidecar, materialize_code
  validate <file>     Parse and validate an OKF specification (*.md) file.
  serve               Start the local Web Portal and Event Bridge background server.
  help                Display this help message.
  version             Display version information.

Options:
  -c, --config <path>  Specify path to stubs configuration file (default: .stubs/config.json)
  --depth <depth>      Specify grill depth (light_probe | standard_drill | deep_interrogation)
  --non-interactive    Run the grill engine in non-interactive (automated) mode
  --scaffold, --init   Scaffold root context-map.md and domains/ directory structure
  --token <pat>        [DEPRECATED] Provide a GitHub Personal Access Token directly (auth login). Prefer STDIN pipe or environment variables.
  --provider <name>    Specify auth provider (default: github) (auth login)
  --repo <owner/repo>  Override default target repo (Defaults to Wiltermoodj/stubs)
  --branch <name>      Specify a git branch or tag (Defaults to main)
  -f, --force          Overwrite existing .agents/skills/stubs/ directory
  -h, --help           Display help message.
  -v, --version        Display version info.
`);
  }

  private async handleInit(ctx: CliContext): Promise<number> {
    const configPath = ctx.configPath || '.stubs/config.json';
    const resolvedPath = path.resolve(configPath);
    const dir = path.dirname(resolvedPath);

    try {
      if (!existsSync(dir)) {
        await fs.mkdir(dir, { recursive: true });
      }

      if (existsSync(resolvedPath)) {
        console.log(`Configuration file already exists at ${resolvedPath}`);
        return 0;
      }

      const defaultConfig = {
        project_name: 'stubs-workspace',
        version: '1.0.0',
        autonomy_level: 'guided_execution',
        paths: {
          specs_dir: 'src',
          templates_dir: '.stubs/templates',
          database_path: '.stubs/graph.sqlite',
        },
      };

      await fs.writeFile(resolvedPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
      console.log(`Initialized stubs configuration at "${configPath}".`);
      return 0;
    } catch (error: any) {
      console.error(`Failed to initialize configuration: ${error.message || error}`);
      return 1;
    }
  }

  private async printVersion(): Promise<void> {
    const candidatePaths = [
      path.resolve(__dirname, '../../package.json'),
      path.resolve(__dirname, '../package.json'),
      path.resolve(__dirname, '../../../package.json'),
      path.resolve(process.cwd(), 'package.json'),
    ];

    for (const pkgPath of candidatePaths) {
      try {
        if (existsSync(pkgPath)) {
          const content = await fs.readFile(pkgPath, 'utf8');
          const pkg = JSON.parse(content);
          if (pkg.name === 'stubs' && pkg.version) {
            console.log(`stubs version ${pkg.version}`);
            return;
          }
        }
      } catch {
        // Continue trying next candidate
      }
    }
    console.log('stubs version 1.0.0');
  }

  private async handleGrill(ctx: CliContext): Promise<number> {
    let targetFile: string | null = null;
    let depth: 'light_probe' | 'standard_drill' | 'deep_interrogation' | undefined = undefined;
    let nonInteractive = false;

    // Parse options for grill command
    let i = 0;
    while (i < ctx.args.length) {
      const arg = ctx.args[i];
      if (arg === '--non-interactive') {
        nonInteractive = true;
        i++;
      } else if (arg === '--depth') {
        const nextArg = ctx.args[i + 1];
        if (
          nextArg === 'light_probe' ||
          nextArg === 'standard_drill' ||
          nextArg === 'deep_interrogation'
        ) {
          depth = nextArg;
          i += 2;
        } else {
          console.error(
            `Error: Invalid depth "${nextArg}". Allowed values are: light_probe, standard_drill, deep_interrogation.`,
          );
          return 1;
        }
      } else if (arg.startsWith('--depth=')) {
        const val = arg.split('=')[1];
        if (val === 'light_probe' || val === 'standard_drill' || val === 'deep_interrogation') {
          depth = val;
          i++;
        } else {
          console.error(
            `Error: Invalid depth "${val}". Allowed values are: light_probe, standard_drill, deep_interrogation.`,
          );
          return 1;
        }
      } else if (arg.startsWith('-')) {
        console.error(`Error: Unknown option "${arg}".`);
        return 1;
      } else {
        if (!targetFile) {
          targetFile = arg;
        } else {
          console.error(`Error: Multiple files specified: "${targetFile}" and "${arg}".`);
          return 1;
        }
        i++;
      }
    }

    if (!targetFile) {
      console.error('Error: "grill" command requires a file path argument.');
      console.error('Usage: stubs grill <file.md> [options]');
      return 1;
    }

    const fullPath = path.resolve(targetFile);
    if (!existsSync(fullPath)) {
      console.error(`Error: File not found at "${fullPath}"`);
      return 1;
    }

    try {
      const { GrillEngine } = await import('../grill/engine');
      const engine = new GrillEngine();
      await engine.grill(fullPath, {
        depth,
        nonInteractive,
        configPath: ctx.configPath,
      });
      return 0;
    } catch (error: any) {
      console.error(`Grill execution failed: ${error.message || error}`);
      return 1;
    }
  }

  private async handleServe(ctx: CliContext): Promise<number> {
    let port = 3000;
    const pIndex = ctx.args.findIndex((arg) => arg === '-p' || arg === '--port');
    if (pIndex !== -1 && pIndex + 1 < ctx.args.length) {
      const portVal = parseInt(ctx.args[pIndex + 1], 10);
      if (!isNaN(portVal)) {
        port = portVal;
      }
    }

    console.log(`Starting stubs Web Portal (serve mode) on port ${port}...`);

    const graphEngine = new GraphEngine();
    const portalServer = new PortalServer(graphEngine, port, ctx.configPath);

    try {
      await portalServer.start();

      const shutdown = async () => {
        console.log('\nShutting down stubs Web Portal server...');
        await portalServer.stop();
        await graphEngine.close();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      if (process.env.NODE_ENV === 'test') {
        await portalServer.stop();
        await graphEngine.close();
        return 0;
      }

      // Return a promise that never resolves normally to keep process alive in CLI
      return new Promise<number>(() => {});
    } catch (err: any) {
      console.error(`Failed to start Web Portal: ${err.message || err}`);
      return 1;
    }
  }

  private async handleMaterialize(ctx: CliContext): Promise<number> {
    if (ctx.args.length === 0) {
      console.error('Error: "materialize" command requires a file path argument.');
      console.error('Usage: stubs materialize <file.md>');
      return 1;
    }
    const targetFile = path.resolve(ctx.args[0]);
    if (!existsSync(targetFile)) {
      console.error(`Error: File not found at "${targetFile}"`);
      return 1;
    }

    try {
      const materializer = new MaterializerEngine();
      const result = await materializer.materialize(targetFile);

      if (!result.success) {
        console.error(`Materialization failed for "${ctx.args[0]}":`);
        if (result.error) {
          console.error(`  Error: ${result.error}`);
        }
        if (result.diagnostics && result.diagnostics.length > 0) {
          console.error('  Diagnostics:');
          for (const diag of result.diagnostics) {
            console.error(`    - ${diag}`);
          }
        }
        return 1;
      }

      console.log(`Materialization succeeded for "${ctx.args[0]}"!`);
      return 0;
    } catch (error: any) {
      console.error(`Error during materialization: ${error.message || error}`);
      return 1;
    }
  }

  private async handleValidate(ctx: CliContext): Promise<number> {
    if (ctx.args.length === 0) {
      console.error('Error: "validate" command requires a file path argument.');
      console.error('Usage: stubs validate <file.md>');
      return 1;
    }
    const targetFile = path.resolve(ctx.args[0]);
    if (!existsSync(targetFile)) {
      console.error(`Error: File not found at "${targetFile}"`);
      return 1;
    }

    try {
      const content = await fs.readFile(targetFile, 'utf8');
      const result = parseOkfSpec(content);

      if (!result.isValid) {
        console.error(`Validation failed for "${ctx.args[0]}":`);
        for (const err of result.errors) {
          console.error(`  - ${err}`);
        }
        return 1;
      }

      console.log(`Validation succeeded for "${ctx.args[0]}":`);
      console.log(`  Title:       ${result.frontmatter?.title}`);
      console.log(`  Type:        ${result.frontmatter?.type}`);
      console.log(`  Status:      ${result.frontmatter?.status}`);
      console.log(`  Status Flag: ${result.frontmatter?.status_flag}`);
      console.log(`  Version:     v${result.frontmatter?.version}`);
      if (result.frontmatter?.target_code_file) {
        console.log(`  Target File: ${result.frontmatter.target_code_file}`);
      }
      return 0;
    } catch (error: any) {
      console.error(`Error reading or validating file: ${error.message || error}`);
      return 1;
    }
  }

  private async handleTemplate(ctx: CliContext): Promise<number> {
    if (ctx.args.length === 0) {
      console.error('Error: "template" command requires an action (list, render).');
      return 1;
    }

    const action = ctx.args[0];
    const config = loadConfig(ctx.configPath);
    const engine = new TemplateEngine(config.paths.templates_dir);

    if (action === 'list') {
      const templates = await engine.listTemplates();
      console.log('Available template molds:');
      for (const t of templates) {
        console.log(`  - ${t}`);
      }
      return 0;
    }

    if (action === 'render') {
      if (ctx.args.length < 3) {
        console.error(
          'Error: "render" action requires template name and context JSON string/file.',
        );
        console.error('Usage: stubs template render <name> <json_string_or_file>');
        return 1;
      }
      const name = ctx.args[1];
      const dataArg = ctx.args[2];

      let data: any;
      try {
        if (existsSync(dataArg)) {
          const raw = await fs.readFile(dataArg, 'utf8');
          data = JSON.parse(raw);
        } else {
          data = JSON.parse(dataArg);
        }
      } catch (err: any) {
        console.error(`Failed to parse context JSON: ${err.message}`);
        return 1;
      }

      try {
        const output = await engine.renderTemplate(name, data);
        console.log(output);
        return 0;
      } catch (err: any) {
        console.error(`Rendering failed: ${err.message}`);
        return 1;
      }
    }

    console.error(`Error: Unknown template action "${action}".`);
    return 1;
  }

  private async handleReconcile(ctx: CliContext): Promise<number> {
    if (ctx.args.length === 0) {
      console.error('Error: "reconcile" command requires a sidecar file path.');
      console.error('Usage: stubs reconcile <sidecar_file.md>');
      return 1;
    }

    const file = ctx.args[0];
    const config = loadConfig(ctx.configPath);
    const protocol = new AutonomyProtocol(config);

    console.log(`Running Retroactive Reconciliation on "${file}"...`);
    const res = await protocol.reconcile(file);

    if (res.success) {
      console.log(`Success (Phase ${res.phase}): ${res.message}`);
      return 0;
    } else {
      console.error(`Failed (Phase ${res.phase}): ${res.message}`);
      if (res.validationErrors && res.validationErrors.length > 0) {
        console.error('Errors:');
        for (const err of res.validationErrors) {
          console.error(`  - ${err}`);
        }
      }
      return 1;
    }
  }

  private async handleEvaluate(ctx: CliContext): Promise<number> {
    if (ctx.args.length === 0) {
      console.error('Error: "evaluate" command requires an action type.');
      console.error(
        'Usage: stubs evaluate <draft_template_proposal|scaffold_sidecar|materialize_code>',
      );
      return 1;
    }

    const action = ctx.args[0] as any;
    const config = loadConfig(ctx.configPath);
    const protocol = new AutonomyProtocol(config);

    const res = protocol.evaluateAction(action);
    console.log(`Autonomy Level: ${config.autonomy_level}`);
    console.log(`Action:         ${action}`);
    console.log(`Allowed:        ${res.allowed}`);
    console.log(`Reason:         ${res.reason}`);

    return res.allowed ? 0 : 1;
  }

  private async handleSync(ctx: CliContext): Promise<number> {
    const config = loadConfig(ctx.configPath);
    const specsDir = config.paths?.specs_dir || 'src';
    const engine = new SandingEngine();

    if (ctx.args.length > 0) {
      const targetFile = path.resolve(ctx.args[0]);
      if (!existsSync(targetFile)) {
        console.error(`Error: File not found at "${targetFile}"`);
        return 1;
      }
      console.log(`Synchronizing sidecar file: ${ctx.args[0]}...`);
      const result = await engine.syncFile(targetFile);
      this.printSyncResult(result);
      return result.status === 'error' ? 1 : 0;
    } else {
      console.log(`Scanning and synchronizing workspace specifications under "${specsDir}"...`);
      const results = await engine.syncWorkspace(specsDir);
      let hasError = false;
      for (const result of results) {
        this.printSyncResult(result);
        if (result.status === 'error') hasError = true;
      }
      return hasError ? 1 : 0;
    }
  }

  private async handleAuth(ctx: CliContext): Promise<number> {
    if (ctx.args.length === 0) {
      console.error('Error: "auth" command requires a subcommand (login).');
      console.error('Usage: stubs auth login [options]');
      return 1;
    }

    const subCommand = ctx.args[0];
    if (subCommand !== 'login') {
      console.error(
        `Error: Unknown auth subcommand "${subCommand}". Currently only "login" is supported.`,
      );
      return 1;
    }

    let token: string | undefined = undefined;
    let provider = 'github';
    let nonInteractive = false;

    // Parse options for auth login command
    let i = 1;
    while (i < ctx.args.length) {
      const arg = ctx.args[i];
      if (arg === '--non-interactive') {
        nonInteractive = true;
        i++;
      } else if (arg === '--token') {
        token = ctx.args[i + 1];
        i += 2;
      } else if (arg.startsWith('--token=')) {
        token = arg.split('=')[1];
        i++;
      } else if (arg === '--provider') {
        provider = ctx.args[i + 1];
        i += 2;
      } else if (arg.startsWith('--provider=')) {
        provider = arg.split('=')[1];
        i++;
      } else {
        console.error(`Error: Unknown auth option "${arg}".`);
        return 1;
      }
    }

    if (provider !== 'github') {
      console.error(`Error: Provider "${provider}" is not supported. Only "github" is supported.`);
      return 1;
    }

    const { handleLogin } = await import('./auth');
    return await handleLogin({ token, nonInteractive });
  }

  private async handleInstall(ctx: CliContext): Promise<number> {
    let repo = 'Wiltermoodj/stubs';
    let branch = 'main';
    let force = false;

    let i = 0;
    while (i < ctx.args.length) {
      const arg = ctx.args[i];
      if (arg === '--repo') {
        if (i + 1 >= ctx.args.length) {
          console.error('Error: Missing value for option --repo');
          return 1;
        }
        repo = ctx.args[i + 1];
        i += 2;
      } else if (arg.startsWith('--repo=')) {
        repo = arg.split('=')[1];
        i++;
      } else if (arg === '--branch') {
        if (i + 1 >= ctx.args.length) {
          console.error('Error: Missing value for option --branch');
          return 1;
        }
        branch = ctx.args[i + 1];
        i += 2;
      } else if (arg.startsWith('--branch=')) {
        branch = arg.split('=')[1];
        i++;
      } else if (arg === '--force' || arg === '-f') {
        force = true;
        i++;
      } else {
        console.error(`Error: Unknown option "${arg}" for install command.`);
        return 1;
      }
    }

    const targetDir = process.cwd();
    const destDir = path.join(targetDir, '.agents/skills/stubs');

    if (existsSync(destDir) && !force) {
      console.error(
        `Error: Installation directory already exists at "${destDir}". Use --force or -f to overwrite.`,
      );
      return 1;
    }

    console.log(`Installing stubs skill from ${repo} (${branch})...`);

    const SKILL_FILES = [
      '.agents/skills/stubs/SKILL.md',
      '.agents/skills/stubs/sub-skills/auditing/SKILL.md',
      '.agents/skills/stubs/sub-skills/grilling/SKILL.md',
      '.agents/skills/stubs/sub-skills/materialization/SKILL.md',
      '.agents/skills/stubs/sub-skills/sanding/SKILL.md',
      '.agents/skills/stubs/dist/cli.cjs',
      '.agents/skills/stubs/dist/sql-wasm.wasm',
    ];

    try {
      await fs.mkdir(destDir, { recursive: true });

      for (const file of SKILL_FILES) {
        const url = `https://raw.githubusercontent.com/${repo}/${branch}/${file}`;
        console.log(`Downloading ${file} from ${url}...`);

        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(
            `Failed to download ${file}: HTTP status ${res.status} ${res.statusText}`,
          );
        }
        const buffer = Buffer.from(await res.arrayBuffer());

        const localPath = path.join(targetDir, file);
        await fs.mkdir(path.dirname(localPath), { recursive: true });
        await fs.writeFile(localPath, buffer);
      }

      await this.updateGitignore(targetDir);

      console.log('stubs installation completed successfully!');
      return 0;
    } catch (err: any) {
      console.error(`Installation failed: ${err.message || err}`);
      return 1;
    }
  }

  private async updateGitignore(targetDir: string): Promise<void> {
    const gitignorePath = path.join(targetDir, '.gitignore');
    const ignoreLines = ['# stubs framework', '.stubs/graph.sqlite*', '.stubs/*.sqlite'];

    let currentContent = '';
    if (existsSync(gitignorePath)) {
      currentContent = await fs.readFile(gitignorePath, 'utf8');
    }

    const linesToAdd: string[] = [];
    for (const line of ignoreLines) {
      if (!currentContent.includes(line)) {
        linesToAdd.push(line);
      }
    }

    if (linesToAdd.length > 0) {
      const divider = currentContent && !currentContent.endsWith('\n') ? '\n' : '';
      await fs.writeFile(
        gitignorePath,
        currentContent + divider + linesToAdd.join('\n') + '\n',
        'utf8',
      );
      console.log(`Updated .gitignore at ${gitignorePath}`);
    }
  }

  private async handleMap(ctx: CliContext): Promise<number> {
    const isScaffold =
      ctx.args.includes('--scaffold') ||
      ctx.args.includes('--init') ||
      ctx.args.includes('init') ||
      ctx.args.includes('scaffold');

    const architectureDir = path.join(process.cwd(), 'knowledge', 'architecture');
    const domainsDir = path.join(architectureDir, 'domains');
    const rootMapFile = path.join(architectureDir, 'context-map.md');

    if (isScaffold) {
      await fs.mkdir(domainsDir, { recursive: true });
      if (!existsSync(rootMapFile)) {
        const skeletonContent = `---
title: Project Architecture Context Map
type: context-map
description: High-level architectural map of core domains, subsystem responsibilities, and data flows.
tags:
  - architecture
  - context-map
---

# Project Architecture Context Map

## Purpose & Overview
Describe the primary purpose and execution model of the application.

## Domain Index
| Domain | Subsystem / Responsibility | Context Map |
| :--- | :--- | :--- |
| Core | Main entry points and routing | [Core Domain Map](domains/core-domain-map.md) |
`;
        await fs.writeFile(rootMapFile, skeletonContent, 'utf8');
        console.log(`Created skeleton context map at ${rootMapFile}`);
      } else {
        console.log(`Context map already exists at ${rootMapFile}`);
      }
      return 0;
    }

    // Default: Audit / Inspect context map files
    if (!existsSync(rootMapFile)) {
      console.warn(`⚠️ Warning: Root context map not found at ${rootMapFile}. Run 'stubs map --scaffold' to create it.`);
      return 0;
    }

    console.log(`Validating architecture context maps...`);
    const rootContent = await fs.readFile(rootMapFile, 'utf8');
    let domainCount = 0;

    if (existsSync(domainsDir)) {
      const files = await fs.readdir(domainsDir);
      const domainMapFiles = files.filter((f) => f.endsWith('-domain-map.md') || f.endsWith('.md'));
      domainCount = domainMapFiles.length;

      for (const dFile of domainMapFiles) {
        if (!rootContent.includes(dFile)) {
          console.warn(`⚠️ Warning: Domain map "${dFile}" exists in ${domainsDir} but is not linked in context-map.md`);
        }
      }
    }

    console.log(`✓ Architecture map found: ${rootMapFile}`);
    console.log(`✓ Indexed domain maps: ${domainCount} found in ${domainsDir}`);
    return 0;
  }

  private printSyncResult(result: SyncResult): void {
    if (result.status === 'no_change') {
      console.log(`  - ${result.filePath}: Already in sync.`);
    } else if (result.status === 'synced') {
      console.log(`  - ${result.filePath}: Synchronized [Direction: ${result.direction}]`);
    } else if (result.status === 'healed') {
      console.log(
        `  - ${result.filePath}: Corrupted frontmatter was healed and synchronized [Direction: ${result.direction}]`,
      );
    } else if (result.status === 'conflict') {
      console.warn(
        `  - ${result.filePath}: [CONFLICT] Both sidecar and code were modified with AST differences. Marked as needs-human-review-resolution.`,
      );
    } else {
      console.error(`  - ${result.filePath}: Error: ${result.error}`);
    }
  }
}

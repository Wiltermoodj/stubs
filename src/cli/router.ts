import { promises as fs, existsSync } from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { parseOkfSpec } from '../parser/okf';
import { GraphEngine } from '../graph/engine';
import { TemplateEngine } from '../templates/engine';
import { AutonomyProtocol } from '../autonomy/protocol';
import { PortalServer } from '../server/portal';
import { loadConfig } from '../config/schema';
import { SandingEngine, SyncResult } from '../sanding/engine';
import { MaterializerEngine } from '../materializer/engine';
import { ConceptEngine } from '../concept/engine';
import { TreeEngine } from '../concept/tree';
import { PhaseEngine } from '../phase/engine';
import { ContextEngine } from '../context/engine';
import { ImpactEngine } from '../impact/engine';
import { ArchLintEngine } from '../lint/engine';
import { MockEngine, TestFramework } from '../mock/engine';
import { DiagramEngine, DiagramType } from '../diagram/engine';
import { PruneEngine } from '../prune/engine';
import { ChangelogEngine } from '../changelog/engine';
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
        case 'update':
        case 'upgrade':
          return await this.handleUpdate(context);
        case 'concept':
          return await this.handleConcept(context);
        case 'tree':
          return await this.handleTree(context);
        case 'phase':
          return await this.handlePhase(context);
        case 'context':
        case 'slice':
          return await this.handleContext(context);
        case 'impact':
          return await this.handleImpact(context);
        case 'lint-arch':
        case 'lint:arch':
        case 'lint-architecture':
          return await this.handleLintArch(context);
        case 'mock':
        case 'test-scaffold':
          return await this.handleMock(context);
        case 'diagram':
        case 'mermaid':
          return await this.handleDiagram(context);
        case 'prune':
        case 'orphan':
          return await this.handlePrune(context);
        case 'changelog':
        case 'diff-spec':
          return await this.handleChangelog(context);
        case 'blast':
          return await this.handleBlast(context);
        case 'path':
          return await this.handlePath(context);
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
  update, upgrade     Update installed stubs skill bundle or display package update instructions.
  concept <action>    Manage concepts and blueprints. Actions: new <title>, scaffold <doc>, list
  tree [options]      Display visual ASCII/Unicode file tree with planned & status markers.
  context <file>      Generate token-optimized, tiered agent context briefing (--depth, --json, --output).
  impact <target>     Analyze upstream/downstream blast radius, risk scoring, and stale sidecars.
  lint-arch [options] Lint architecture against layer hierarchy, cycle bans, and manifest parity.
  mock <file>         Generate spec-driven test suite & typed mocks (--output, --framework, --dry-run, --force).
  diagram [target]    Generate Mermaid architecture/sequence diagrams (--type, --sync, --output).
  prune [options]     Audit and prune phantom specs, untracked code, zombie exports (--fix, --zombies, --json).
  changelog [options] Generate semantic architectural changelog (--since, --from, --to, --output, --json).
  blast <target>      Query downstream/upstream blast radius with domain boundaries.
  path <src> <dest>   Find shortest call/import dependency chain between files or symbols.
  phase <action>      Manage 5-phase lifecycle. Actions: status [file], check <file>, advance <file> [targetPhase]
  grill <file>       Execute the Interactive Grill Engine on a sidecar specification.
  materialize <file>  Parse, extract, typecheck, and write executable code from sidecar.
  audit [options]     Audit sidecars or inspect hotspots (--hotspots, --cycles, --json).
  sand [file]         Synchronize sidecars and code files (with auto-healing depends_on).
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
  --planned            Include planned blueprint files in visual tree
  --status             Display phase and health status in tree / report
  --graph              Annotate visual file tree with node degree centralities (tree)
  --hotspots           Detect God Nodes and high-coupling hubs (audit)
  --cycles             Detect circular dependency loops (audit)
  --upstream           Traverse upstream dependencies (blast)
  --depth <N>          Specify search depth limit (blast / tree)
  --json               Output structured JSON results
  --no-graph-sync      Disable automatic depends_on frontmatter sync (sand)
  --all                Display all files and directories
  --dry-run            Preview filetree scaffolding without writing to disk
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
    const targetDir = process.cwd();
    const configPath = ctx.configPath || '.stubs/config.json';
    const resolvedPath = path.resolve(targetDir, configPath);
    const dir = path.dirname(resolvedPath);

    const isScaffold =
      ctx.args.includes('--scaffold') ||
      ctx.args.includes('--init') ||
      ctx.args.includes('--full') ||
      ctx.args.includes('init') ||
      ctx.args.includes('scaffold');

    const isClaude = ctx.args.includes('--claude');
    const isCursor = ctx.args.includes('--cursor');
    const isAllAgents = ctx.args.includes('--all-agents') || ctx.args.includes('--all');
    const force = ctx.args.includes('--force') || ctx.args.includes('-f');

    try {
      if (!existsSync(dir)) {
        await fs.mkdir(dir, { recursive: true });
      }

      if (existsSync(resolvedPath)) {
        console.log(`Configuration file already exists at ${resolvedPath}`);
      } else {
        const defaultConfig = {
          project_name: path.basename(targetDir) || 'stubs-workspace',
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
      }

      // 1. Seed standard templates
      await this.seedDefaultTemplates(targetDir, force);

      // 2. Configure .gitignore
      await this.updateGitignore(targetDir);

      // 3. Seed agent skills
      await this.seedAgentSkills(targetDir, {
        force,
        claude: isClaude,
        cursor: isCursor,
        allAgents: isAllAgents,
      });

      // 4. Scaffold architecture context map if requested
      if (isScaffold) {
        await this.handleMap({ ...ctx, args: ['--scaffold'] });
      }

      // 5. Advise on package.json shortcut
      const targetPackageJsonPath = path.join(targetDir, 'package.json');
      if (existsSync(targetPackageJsonPath)) {
        try {
          const pkgContent = await fs.readFile(targetPackageJsonPath, 'utf8');
          const pkg = JSON.parse(pkgContent);
          if (!pkg.scripts?.stubs) {
            console.log(
              `Tip: You can add '"stubs": "stubs"' to scripts in package.json to run with 'npm run stubs -- <command>' or directly 'npx stubs <command>'.`,
            );
          }
        } catch {
          // Ignore parse errors on target package.json
        }
      }

      console.log('stubs workspace initialized successfully.');
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
    const isHotspots = ctx.args.includes('--hotspots');
    const isCycles = ctx.args.includes('--cycles');
    const isSmells = ctx.args.includes('--smells') || isHotspots || isCycles;
    const isJson = ctx.args.includes('--json');

    if (isSmells || (ctx.args.length === 0 && ctx.command === 'audit')) {
      const config = loadConfig(ctx.configPath);
      const graphEngine = new GraphEngine(config.paths.db_path);
      await graphEngine.initialize();

      const existingNodes = await graphEngine.getGraphNodes();
      if (existingNodes.length === 0) {
        await graphEngine.indexCodeWorkspace(config.paths?.specs_dir || 'src');
      }

      const topology = await graphEngine.getTopologyEngine();
      const smells = topology.detectSmells();

      if (isJson) {
        console.log(JSON.stringify(smells, null, 2));
        return 0;
      }

      console.log(`\n🏥 Architectural Health & Graph Hotspot Report`);
      console.log(`=============================================`);
      console.log(`Total Smells Detected: ${smells.totalSmells}\n`);

      if (smells.godNodes.length > 0) {
        console.log(`🔥 Hotspot Nodes (High Coupling & Centrality):`);
        for (const gn of smells.godNodes) {
          console.log(
            `  - ${gn.id} (In: ${gn.inDegree} | Out: ${gn.outDegree} | Total: ${gn.totalDegree})`,
          );
          console.log(`    Reason: ${gn.reason}`);
        }
        console.log('');
      } else {
        console.log(`✅ No God Nodes detected.`);
      }

      if (smells.cycles.length > 0) {
        console.log(`🔄 Circular Dependency Cycles:`);
        for (const c of smells.cycles) {
          console.log(
            `  - Cycle of length ${c.cycleLength}: ${c.nodes.join(' -> ')} -> ${c.nodes[0]}`,
          );
        }
        console.log('');
      } else {
        console.log(`✅ No circular dependency cycles detected.`);
      }

      if (smells.domainLeaks.length > 0) {
        console.log(`⚠️  Domain Boundary Leaks:`);
        for (const leak of smells.domainLeaks) {
          console.log(
            `  - [Domain: ${leak.sourceDomain}] ${leak.sourceId} -> [Domain: ${leak.targetDomain}] ${leak.targetId}`,
          );
          console.log(`    Reason: ${leak.reason}`);
        }
        console.log('');
      } else {
        console.log(`✅ No domain boundary leaks detected.`);
      }

      return 0;
    }

    const nonFlagArgs = ctx.args.filter((a) => !a.startsWith('-'));
    if (nonFlagArgs.length === 0) {
      console.error('Error: "reconcile" command requires a sidecar file path.');
      console.error('Usage: stubs reconcile <sidecar_file.md> or stubs audit --hotspots');
      return 1;
    }

    const file = nonFlagArgs[0];
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
    const noGraphSync = ctx.args.includes('--no-graph-sync') || ctx.args.includes('--no-graph');
    const nonFlagArgs = ctx.args.filter((a) => !a.startsWith('-'));

    if (nonFlagArgs.length > 0) {
      const targetFile = path.resolve(nonFlagArgs[0]);
      if (!existsSync(targetFile)) {
        console.error(`Error: File not found at "${targetFile}"`);
        return 1;
      }
      console.log(`Synchronizing sidecar file: ${nonFlagArgs[0]}...`);
      const result = await engine.syncFile(targetFile, { noGraphSync });
      this.printSyncResult(result);
      return result.status === 'error' ? 1 : 0;
    } else {
      console.log(`Scanning and synchronizing workspace specifications under "${specsDir}"...`);
      const results = await engine.syncWorkspace(specsDir, { noGraphSync });
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
    const targetDir = process.cwd();
    const force = ctx.args.includes('--force') || ctx.args.includes('-f');
    const isClaude = ctx.args.includes('--claude');
    const isCursor = ctx.args.includes('--cursor');
    const isAllAgents = ctx.args.includes('--all-agents');

    let repo = 'Wiltermoodj/stubs';
    let branch = 'main';

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
      } else if (
        arg === '--force' ||
        arg === '-f' ||
        arg === '--claude' ||
        arg === '--cursor' ||
        arg === '--all-agents'
      ) {
        i++;
      } else {
        console.error(`Error: Unknown option "${arg}" for install command.`);
        return 1;
      }
    }

    const destDir = path.join(targetDir, '.agents/skills/stubs');
    if (existsSync(destDir) && !force) {
      console.error(
        `Error: Installation directory already exists at "${destDir}". Use --force or -f to overwrite, or run 'stubs update' to refresh.`,
      );
      return 1;
    }

    console.log(`Installing stubs skills and templates into workspace from ${repo} (${branch})...`);
    try {
      await this.seedDefaultTemplates(targetDir, force);
      await this.seedAgentSkills(targetDir, {
        force: true,
        claude: isClaude,
        cursor: isCursor,
        allAgents: isAllAgents,
        repo,
        branch,
        isInstall: true,
      });
      await this.updateGitignore(targetDir);

      console.log('stubs installation completed successfully!');
      return 0;
    } catch (err: any) {
      console.error(`Installation failed: ${err.message || err}`);
      return 1;
    }
  }

  private async handleUpdate(ctx: CliContext): Promise<number> {
    const targetDir = process.cwd();
    const force = ctx.args.includes('--force') || ctx.args.includes('-f');
    const noPkgUpdate = ctx.args.includes('--no-package-update') || ctx.args.includes('--no-pkg');

    let repo: string | undefined;
    let branch: string | undefined;

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
      } else if (
        arg === '--force' ||
        arg === '-f' ||
        arg === '--no-package-update' ||
        arg === '--no-pkg'
      ) {
        i++;
      } else {
        console.error(`Error: Unknown option "${arg}" for update command.`);
        return 1;
      }
    }

    console.log('Checking stubs components for updates...');

    // 1. Check & update package manager dependency
    const pkgJsonPath = path.join(targetDir, 'package.json');
    let hasNpmDependency = false;
    let isGitDep = false;
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(await fs.readFile(pkgJsonPath, 'utf8'));
        const depVersion = pkg.dependencies?.stubs || pkg.devDependencies?.stubs;
        if (depVersion) {
          hasNpmDependency = true;
          if (
            typeof depVersion === 'string' &&
            (depVersion.includes('github:') ||
              depVersion.includes('git+') ||
              depVersion.includes('git:'))
          ) {
            isGitDep = true;
          }
        }
      } catch {
        // Ignore JSON read errors
      }
    }

    const pm = this.detectPackageManager(targetDir);

    if (hasNpmDependency) {
      console.log('Detected stubs installed as an npm package dependency.');
      console.log('To update to the latest version, run:');
      console.log('  npm update stubs');
      console.log('or reinstall from GitHub:');
      console.log('  npm install --save-dev github:Wiltermoodj/stubs\n');

      if (!noPkgUpdate && process.env.NODE_ENV !== 'test') {
        this.runPackageUpdate(targetDir, pm, isGitDep, repo, branch);
      }
    }

    // 2. Refresh agent skills
    console.log('Updating stubs agent skill in .agents/skills/stubs/...');
    try {
      await this.seedAgentSkills(targetDir, { force: true, repo, branch });
    } catch (err: any) {
      console.error(`Update failed: ${err.message || err}`);
      return 1;
    }

    // 3. Refresh templates non-destructively
    try {
      await this.seedDefaultTemplates(targetDir, force);
    } catch (err: any) {
      console.warn(`Template refresh note: ${err.message || err}`);
    }

    // 4. Update .gitignore
    await this.updateGitignore(targetDir);

    // 5. Run database migrations
    await this.runDatabaseMigrations(targetDir);

    console.log('stubs update completed successfully!');
    return 0;
  }

  public detectPackageManager(targetDir: string): string {
    if (existsSync(path.join(targetDir, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(path.join(targetDir, 'yarn.lock'))) return 'yarn';
    if (
      existsSync(path.join(targetDir, 'bun.lockb')) ||
      existsSync(path.join(targetDir, 'bun.lock'))
    ) {
      return 'bun';
    }
    return 'npm';
  }

  public runPackageUpdate(
    targetDir: string,
    pm: string,
    isGitDep: boolean,
    repo?: string,
    branch?: string,
  ): void {
    const targetRepo = repo || 'Wiltermoodj/stubs';
    const gitTarget = `github:${targetRepo}${branch && branch !== 'main' ? '#' + branch : ''}`;
    let cmd: string;

    switch (pm) {
      case 'pnpm':
        cmd = isGitDep ? `pnpm add -D ${gitTarget}` : 'pnpm add -D stubs@latest';
        break;
      case 'yarn':
        cmd = isGitDep ? `yarn add -D ${gitTarget}` : 'yarn add -D stubs@latest';
        break;
      case 'bun':
        cmd = isGitDep ? `bun add -d ${gitTarget}` : 'bun add -d stubs@latest';
        break;
      case 'npm':
      default:
        cmd = isGitDep
          ? `npm install --save-dev ${gitTarget}`
          : 'npm install --save-dev stubs@latest';
        break;
    }

    try {
      execSync(cmd, { cwd: targetDir, stdio: 'inherit' });
    } catch (err: any) {
      console.warn(
        `Note: Package manager update via '${cmd}' encountered an error (${err.message || err}).`,
      );
    }
  }

  public async runDatabaseMigrations(targetDir: string): Promise<void> {
    const dbPath = path.join(targetDir, '.stubs/graph.sqlite');
    if (existsSync(dbPath)) {
      try {
        const graph = new GraphEngine({ dbPath });
        await graph.initialize();
        await graph.close();
      } catch (err: any) {
        console.warn(`Database migration check note: ${err.message || err}`);
      }
    }
  }

  public async seedDefaultTemplates(targetDir: string, force: boolean = false): Promise<string[]> {
    const templatesDir = path.join(targetDir, '.stubs/templates');
    await fs.mkdir(templatesDir, { recursive: true });

    // Look for candidate bundled mold sources
    const candidateMoldDirs = [
      path.join(__dirname, 'templates'),
      path.join(__dirname, '../templates'),
      path.join(__dirname, '../../.stubs/templates'),
      path.join(__dirname, '../../../.stubs/templates'),
    ];

    const seeded: string[] = [];
    let foundDir: string | undefined;
    for (const dir of candidateMoldDirs) {
      if (dir !== templatesDir && existsSync(dir)) {
        try {
          const files = await fs.readdir(dir);
          const tpls = files.filter((f) => f.endsWith('.tpl'));
          if (tpls.length > 0) {
            foundDir = dir;
            break;
          }
        } catch {
          // Ignore read errors
        }
      }
    }

    if (foundDir) {
      const files = await fs.readdir(foundDir);
      for (const file of files.filter((f) => f.endsWith('.tpl'))) {
        const destFile = path.join(templatesDir, file);
        if (!existsSync(destFile) || force) {
          const content = await fs.readFile(path.join(foundDir, file), 'utf8');
          await fs.writeFile(destFile, content, 'utf8');
          seeded.push(file);
        }
      }
    }

    // Built-in fallback molds
    const fallbackMolds: Record<string, string> = {
      'concept-doc.md.tpl': `---
title: "{{title}}"
type: "concept-doc"
description: "{{description}}"
tags:
  - concept
status: "concept"
version: 1
---

# {{title}}

## Problem Statement & Context
{{description}}

## Architectural Decisions
<!-- Key decisions and rationale -->

## Next Steps
<!-- Actions to advance this concept -->
`,
      'initiative-plan.md.tpl': `---
title: "{{title}}"
type: "initiative-plan"
description: "{{description}}"
tags:
  - initiative
status: "concept"
version: 1
---

# {{title}} — Initiative Plan

## Overview
{{description}}

## Planned File Blueprint
<!-- Blueprint of target files -->

## Phase Roadmap
- [ ] Phase 1: Conceptualize
- [ ] Phase 2: Grill
- [ ] Phase 3: Scaffold & Types
- [ ] Phase 4: Materialize
- [ ] Phase 5: Sand & Audit
`,
      'planning-map.md.tpl': `---
title: "Planning Map"
type: "planning-map"
description: "Master project planning and initiative roadmap"
tags:
  - planning
status: "spec"
version: 1
---

# Master Planning Map

## Active Initiatives
| Initiative | Target Subsystem | Status |
| :--- | :--- | :--- |
| Initial Setup | Core | In Progress |
`,
      'service.ts.md.tpl': `---
title: "{{title}}"
type: "sidecar-spec"
description: "{{description}}"
tags:
  - service
status: "spec"
version: 1
target_code_file: "./{{name}}.ts"
status_flag: "clean"
---

# {{title}}

## Interfaces
\`\`\`typescript
export interface {{pascalName}}Config {
  enabled: boolean;
}
\`\`\`

## Implementation
\`\`\`typescript
export class {{pascalName}} {
  constructor(private config: {{pascalName}}Config) {}
}
\`\`\`
`,
    };

    for (const [name, content] of Object.entries(fallbackMolds)) {
      const destFile = path.join(templatesDir, name);
      if (!existsSync(destFile)) {
        await fs.writeFile(destFile, content, 'utf8');
        if (!seeded.includes(name)) {
          seeded.push(name);
        }
      }
    }

    return seeded;
  }

  public async seedAgentSkills(
    targetDir: string,
    options: {
      force?: boolean;
      claude?: boolean;
      cursor?: boolean;
      allAgents?: boolean;
      repo?: string;
      branch?: string;
      isInstall?: boolean;
    } = {},
  ): Promise<void> {
    const destDir = path.join(targetDir, '.agents/skills/stubs');
    const SUB_SKILL_NAMES = [
      'auditing',
      'changelog',
      'conceptualizing',
      'context',
      'context-mapping',
      'diagram',
      'grilling',
      'lint',
      'materialization',
      'mock',
      'pruning',
      'sanding',
    ];

    const SKILL_FILES = [
      '.agents/skills/stubs/SKILL.md',
      '.agents/skills/stubs/.gitignore',
      ...SUB_SKILL_NAMES.map((name) => `.agents/skills/stubs/sub-skills/${name}/SKILL.md`),
    ];

    const repo = options.repo || 'Wiltermoodj/stubs';
    const branch = options.branch || 'main';
    await fs.mkdir(destDir, { recursive: true });

    for (const file of SKILL_FILES) {
      const url = `https://raw.githubusercontent.com/${repo}/${branch}/${file}`;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        const localPath = path.join(targetDir, file);
        await fs.mkdir(path.dirname(localPath), { recursive: true });
        await fs.writeFile(localPath, buffer);
      } catch (fetchErr: any) {
        if (options.isInstall) {
          throw new Error(
            `Failed to download ${file} from GitHub (https://raw.githubusercontent.com/${repo}/${branch}/${file}): ${fetchErr.message || fetchErr}`,
          );
        }
        // If remote fetch fails during non-install (e.g. update in offline environment), fallback to local bundled assets
        const candidateRoots = [
          path.resolve(__dirname, 'skills'),
          path.resolve(__dirname, '../skills'),
          path.resolve(__dirname, '..'),
          path.resolve(__dirname, '../..'),
        ];
        let fallbackFound = false;
        for (const root of candidateRoots) {
          const srcPath = existsSync(path.join(root, 'SKILL.md'))
            ? path.join(root, file.replace(/^\.agents\/skills\/stubs\//, ''))
            : path.join(root, file);
          if (existsSync(srcPath)) {
            const localPath = path.join(targetDir, file);
            await fs.mkdir(path.dirname(localPath), { recursive: true });
            const content = await fs.readFile(srcPath);
            await fs.writeFile(localPath, content);
            fallbackFound = true;
            break;
          }
        }
        if (!fallbackFound) {
          throw new Error(
            `Failed to download ${file} from GitHub (https://raw.githubusercontent.com/${repo}/${branch}/${file}) and no local fallback was found: ${fetchErr.message || fetchErr}`,
          );
        }
      }
    }

    // Claude Code adapter (.claude/skills/stubs/SKILL.md)
    if (options.claude || options.allAgents) {
      const claudeSkillDir = path.join(targetDir, '.claude/skills/stubs');
      await fs.mkdir(claudeSkillDir, { recursive: true });
      const mainSkillPath = path.join(destDir, 'SKILL.md');
      if (existsSync(mainSkillPath)) {
        const skillContent = await fs.readFile(mainSkillPath, 'utf8');
        await fs.writeFile(path.join(claudeSkillDir, 'SKILL.md'), skillContent, 'utf8');
      }
      console.log(`Configured Claude Code skill adapter at "${claudeSkillDir}".`);
    }

    // Cursor Rules adapter (.cursor/rules/stubs.mdc)
    if (options.cursor || options.allAgents) {
      const cursorRulesDir = path.join(targetDir, '.cursor/rules');
      await fs.mkdir(cursorRulesDir, { recursive: true });
      const cursorRuleContent = `---
description: stubs architecture-as-code specification and sanding rules
globs: **/*.ts, **/*.py, **/*.go, **/*.md
---

# stubs Framework Instructions

This project uses the \`stubs\` architecture-as-code sidecar framework.
- **Specification Layer**: Specification sidecars (*.<ext>.md) define interfaces, types, and ADRs.
- **Code Sanding**: Keep code and specs in sync with \`npx stubs sand\`.
- **Grilling**: Stress-test designs with \`npx stubs grill <file.md>\`.
- **Materialization**: Extract executable code with \`npx stubs materialize <file.md>\`.
`;
      await fs.writeFile(path.join(cursorRulesDir, 'stubs.mdc'), cursorRuleContent, 'utf8');
      console.log(`Configured Cursor rules adapter at "${cursorRulesDir}/stubs.mdc".`);
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
      console.warn(
        `⚠️ Warning: Root context map not found at ${rootMapFile}. Run 'stubs map --scaffold' to create it.`,
      );
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
          console.warn(
            `⚠️ Warning: Domain map "${dFile}" exists in ${domainsDir} but is not linked in context-map.md`,
          );
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

  private async handleConcept(ctx: CliContext): Promise<number> {
    const config = loadConfig(ctx.configPath);
    const graphEngine = new GraphEngine(config.paths.db_path);
    await graphEngine.initialize();
    const conceptEngine = new ConceptEngine({
      graphEngine,
      templatesDir: config.paths.templates_dir,
    });

    const action = ctx.args[0];

    if (action === 'new') {
      const title = ctx.args[1];
      if (!title) {
        console.error(
          'Error: Concept title is required. Usage: stubs concept new <title> [options]',
        );
        return 1;
      }

      let type: 'concept-doc' | 'initiative-plan' | 'planning-map' = 'concept-doc';
      let domain: string | undefined;
      let initiative: string | undefined;
      let targetPath: string | undefined;
      let description: string | undefined;

      for (let i = 2; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '--type' && ctx.args[i + 1]) {
          type = ctx.args[i + 1] as any;
          i++;
        } else if (arg.startsWith('--type=')) {
          type = arg.split('=')[1] as any;
        } else if (arg === '--domain' && ctx.args[i + 1]) {
          domain = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('--domain=')) {
          domain = arg.split('=')[1];
        } else if (arg === '--initiative' && ctx.args[i + 1]) {
          initiative = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('--initiative=')) {
          initiative = arg.split('=')[1];
        } else if (arg === '--target' && ctx.args[i + 1]) {
          targetPath = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('--target=')) {
          targetPath = arg.split('=')[1];
        } else if (arg === '--description' || arg === '--desc') {
          description = ctx.args[i + 1];
          i++;
        }
      }

      const result = await conceptEngine.createConcept({
        title,
        type,
        domain,
        initiative,
        targetPath,
        description,
      });

      console.log(`✓ Created ${type} at "${result.filePath}".`);
      return 0;
    }

    if (action === 'scaffold') {
      const docPath = ctx.args[1];
      if (!docPath) {
        console.error('Error: Document path is required. Usage: stubs concept scaffold <docPath>');
        return 1;
      }

      const dryRun = ctx.args.includes('--dry-run');
      const overwrite = ctx.args.includes('--overwrite') || ctx.args.includes('-f');

      const result = await conceptEngine.scaffoldFileTreeFromDoc(docPath, { dryRun, overwrite });

      if (result.errors.length > 0) {
        console.error(`Scaffold completed with errors:\n${result.errors.join('\n')}`);
      }

      console.log(`Scaffolding blueprint from "${docPath}" ${dryRun ? '[DRY RUN]' : ''}:`);
      console.log(`  ✓ Created: ${result.created.length} file(s)/directory(s)`);
      result.created.forEach((c) => console.log(`    + ${c}`));
      if (result.skipped.length > 0) {
        console.log(`  ↷ Skipped (already exists): ${result.skipped.length} file(s)`);
        result.skipped.forEach((s) => console.log(`    - ${s}`));
      }

      return result.errors.length > 0 ? 1 : 0;
    }

    if (action === 'list') {
      const dir = ctx.args[1] || '.';
      const concepts = await conceptEngine.listConcepts(dir);
      if (concepts.length === 0) {
        console.log('No concept documents or initiative plans found in workspace.');
        return 0;
      }

      console.log(`Found ${concepts.length} conceptual blueprint(s):`);
      console.log(
        '--------------------------------------------------------------------------------',
      );
      console.log(`${'Type'.padEnd(16)} | ${'Phase'.padEnd(14)} | ${'Title'.padEnd(30)} | Path`);
      console.log(
        '--------------------------------------------------------------------------------',
      );
      concepts.forEach((c) => {
        console.log(
          `${c.type.padEnd(16)} | ${c.phase.padEnd(14)} | ${c.title.slice(0, 28).padEnd(30)} | ${c.filePath}`,
        );
      });
      return 0;
    }

    console.log(`
Usage:
  stubs concept <action> [options]

Actions:
  new <title>        Create new concept document, initiative plan, or planning map
  scaffold <doc>     Scaffold file tree blueprint and skeleton sidecars from a doc
  list [dir]         List all concept docs and initiative plans in the workspace

Options:
  --type <type>      Document type (concept-doc | initiative-plan | planning-map)
  --domain <name>    Domain name to co-locate concept in src/<domain>/
  --initiative <key> Initiative identifier
  --dry-run          Preview scaffolding without modifying filesystem
  --overwrite        Overwrite existing files
`);
    return 0;
  }

  private async handleTree(ctx: CliContext): Promise<number> {
    const config = loadConfig(ctx.configPath);
    const graphEngine = new GraphEngine(config.paths.db_path);
    await graphEngine.initialize();
    const treeEngine = new TreeEngine({ graphEngine });

    let rootDir = '.';
    let includePlanned = true;
    let plannedOnly = false;
    let showStatus = true;
    let showGraph = ctx.args.includes('--graph');
    let maxDepth = 8;

    for (let i = 0; i < ctx.args.length; i++) {
      const arg = ctx.args[i];
      if (arg === '--planned') {
        includePlanned = true;
      } else if (arg === '--no-planned') {
        includePlanned = false;
      } else if (arg === '--planned-only') {
        plannedOnly = true;
      } else if (arg === '--status') {
        showStatus = true;
      } else if (arg === '--no-status') {
        showStatus = false;
      } else if (arg === '--graph') {
        showGraph = true;
      } else if (arg === '--dir' && ctx.args[i + 1]) {
        rootDir = ctx.args[i + 1];
        i++;
      } else if (arg.startsWith('--dir=')) {
        rootDir = arg.split('=')[1];
      } else if (arg === '--depth' && ctx.args[i + 1]) {
        maxDepth = parseInt(ctx.args[i + 1], 10) || 8;
        i++;
      } else if (!arg.startsWith('-') && !rootDir) {
        rootDir = arg;
      }
    }

    const treeOutput = await treeEngine.generateVisualTree({
      rootDir,
      includePlanned,
      plannedOnly,
      showStatus,
      showGraph,
      maxDepth,
    });

    console.log(treeOutput);
    return 0;
  }

  private async handleBlast(ctx: CliContext): Promise<number> {
    const nonFlagArgs = ctx.args.filter((a) => !a.startsWith('-'));
    if (nonFlagArgs.length === 0) {
      console.error('Error: "blast" command requires a target file or symbol name.');
      console.error('Usage: stubs blast <target> [--upstream|--downstream] [--depth <N>] [--json]');
      return 1;
    }

    const target = nonFlagArgs[0];
    const isJson = ctx.args.includes('--json');
    const isUpstream = ctx.args.includes('--upstream');
    const isBoth = ctx.args.includes('--both');
    const direction = isBoth ? 'both' : isUpstream ? 'upstream' : 'downstream';

    let depth = 3;
    for (let i = 0; i < ctx.args.length; i++) {
      if (ctx.args[i] === '--depth' && ctx.args[i + 1]) {
        depth = parseInt(ctx.args[i + 1], 10) || 3;
        i++;
      } else if (ctx.args[i].startsWith('--depth=')) {
        depth = parseInt(ctx.args[i].split('=')[1], 10) || 3;
      }
    }

    const config = loadConfig(ctx.configPath);
    const graphEngine = new GraphEngine(config.paths.db_path);
    await graphEngine.initialize();

    const existingNodes = await graphEngine.getGraphNodes();
    if (existingNodes.length === 0) {
      await graphEngine.indexCodeWorkspace(config.paths?.specs_dir || 'src');
    }

    const topology = await graphEngine.getTopologyEngine();
    const result = topology.getBlastRadius(target, { depth, direction });

    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(topology.formatBlastRadiusTree(result));
    }

    return 0;
  }

  private async handlePath(ctx: CliContext): Promise<number> {
    const nonFlagArgs = ctx.args.filter((a) => !a.startsWith('-'));
    if (nonFlagArgs.length < 2) {
      console.error('Error: "path" command requires a <source> and <target>.');
      console.error('Usage: stubs path <source> <target> [--type <relation>] [--json]');
      return 1;
    }

    const source = nonFlagArgs[0];
    const target = nonFlagArgs[1];
    const isJson = ctx.args.includes('--json');

    let relationTypes: string[] | undefined;
    for (let i = 0; i < ctx.args.length; i++) {
      if (ctx.args[i] === '--type' && ctx.args[i + 1]) {
        relationTypes = ctx.args[i + 1].split(',').map((r) => r.trim());
        i++;
      } else if (ctx.args[i].startsWith('--type=')) {
        relationTypes = ctx.args[i]
          .split('=')[1]
          .split(',')
          .map((r) => r.trim());
      }
    }

    const config = loadConfig(ctx.configPath);
    const graphEngine = new GraphEngine(config.paths.db_path);
    await graphEngine.initialize();

    const existingNodes = await graphEngine.getGraphNodes();
    if (existingNodes.length === 0) {
      await graphEngine.indexCodeWorkspace(config.paths?.specs_dir || 'src');
    }

    const topology = await graphEngine.getTopologyEngine();
    const result = topology.findShortestPath(source, target, { relationTypes });

    if (!result) {
      if (isJson) {
        console.log(JSON.stringify({ found: false, source, target }, null, 2));
      } else {
        console.log(`No path found between "${source}" and "${target}".`);
      }
      return 1;
    }

    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(topology.formatShortestPath(result));
    }

    return 0;
  }

  private async handlePhase(ctx: CliContext): Promise<number> {
    const config = loadConfig(ctx.configPath);
    const graphEngine = new GraphEngine(config.paths.db_path);
    await graphEngine.initialize();
    const phaseEngine = new PhaseEngine({ graphEngine });

    const action = ctx.args[0];

    if (action === 'check') {
      const file = ctx.args[1];
      if (!file) {
        console.error('Error: File path is required. Usage: stubs phase check <file>');
        return 1;
      }

      const result = await phaseEngine.checkPhase(file);
      console.log(`\nPhase Verification: ${result.filePath}`);
      console.log(`Current Phase : [${result.currentPhase.toUpperCase()}]`);
      console.log(
        `Next Phase    : ${result.nextPhase ? `[${result.nextPhase.toUpperCase()}]` : 'None (Terminal Phase)'}`,
      );
      console.log(
        `Status        : ${result.canAdvance ? '✓ Ready to Advance' : '✗ Gating Rules Not Met'}\n`,
      );

      console.log('Requirements:');
      result.requirements.forEach((req) => {
        const mark = req.passed ? '✓' : '✗';
        console.log(`  ${mark} ${req.rule}${req.details ? ` (${req.details})` : ''}`);
      });

      if (result.errors.length > 0) {
        console.log('\nBlocking Issues:');
        result.errors.forEach((err) => console.log(`  - ${err}`));
      }

      return result.canAdvance ? 0 : 1;
    }

    if (action === 'advance') {
      const file = ctx.args[1];
      if (!file) {
        console.error(
          'Error: File path is required. Usage: stubs phase advance <file> [targetPhase]',
        );
        return 1;
      }

      const targetPhase = ctx.args[2] && !ctx.args[2].startsWith('-') ? ctx.args[2] : undefined;
      const force = ctx.args.includes('--force') || ctx.args.includes('-f');

      const result = await phaseEngine.advancePhase(file, targetPhase, { force });
      if (result.success) {
        console.log(
          `✓ Advanced phase for "${result.filePath}": ${result.fromPhase.toUpperCase()} ──► ${result.toPhase.toUpperCase()}`,
        );
        return 0;
      } else {
        console.error(`✗ Failed to advance phase for "${result.filePath}":`);
        result.errors.forEach((e) => console.error(`  - ${e}`));
        return 1;
      }
    }

    // Default or 'status'
    const targetFile =
      action === 'status' ? ctx.args[1] : action && !action.startsWith('-') ? action : undefined;
    if (targetFile) {
      const result = await phaseEngine.checkPhase(targetFile);
      console.log(
        `File: ${result.filePath} | Phase: [${result.currentPhase.toUpperCase()}] | Next: ${result.nextPhase ? `[${result.nextPhase.toUpperCase()}]` : 'N/A'}`,
      );
      return 0;
    }

    // Workspace-wide summary
    const matrix = await phaseEngine.getWorkspacePhaseMatrix();
    console.log('\nStubs 5-Phase Lifecycle Matrix');
    console.log('================================================================================');
    console.log(
      `Summary: Conceptualize: ${matrix.summary.conceptualize} | Grill: ${matrix.summary.grill} | Spec: ${matrix.summary.spec} | Materialize: ${matrix.summary.materialize} | Sand: ${matrix.summary.sand} | Total: ${matrix.summary.total}`,
    );
    console.log('--------------------------------------------------------------------------------');
    console.log(
      `${'Phase'.padEnd(15)} | ${'Ready'.padEnd(6)} | ${'Status'.padEnd(12)} | File Path`,
    );
    console.log('--------------------------------------------------------------------------------');
    matrix.sidecars.forEach((s) => {
      console.log(
        `${s.phase.padEnd(15)} | ${(s.canAdvance ? '✓' : '-').padEnd(6)} | ${s.status_flag.padEnd(12)} | ${s.filePath}`,
      );
    });
    console.log(
      '================================================================================\n',
    );
    return 0;
  }

  private async handleContext(ctx: CliContext): Promise<number> {
    const nonFlagArgs = ctx.args.filter((a) => !a.startsWith('-'));
    if (nonFlagArgs.length === 0) {
      console.error(
        'Error: File path is required. Usage: stubs context <file> [--depth <n>] [--json] [--output <file>] [--no-code]',
      );
      return 1;
    }

    const targetFile = nonFlagArgs[0];
    const isJson = ctx.args.includes('--json');
    const noCode = ctx.args.includes('--no-code');

    let depth = 2;
    let outputPath: string | undefined;

    for (let i = 0; i < ctx.args.length; i++) {
      if (ctx.args[i] === '--depth' && ctx.args[i + 1]) {
        depth = parseInt(ctx.args[i + 1], 10) || 2;
        i++;
      } else if (ctx.args[i].startsWith('--depth=')) {
        depth = parseInt(ctx.args[i].split('=')[1], 10) || 2;
      } else if (ctx.args[i] === '--output' && ctx.args[i + 1]) {
        outputPath = ctx.args[i + 1];
        i++;
      } else if (ctx.args[i].startsWith('--output=')) {
        outputPath = ctx.args[i].split('=')[1];
      }
    }

    const config = loadConfig(ctx.configPath);
    const graphEngine = new GraphEngine(config.paths.db_path);
    await graphEngine.initialize();

    const contextEngine = new ContextEngine({ graphEngine });
    const pkg = await contextEngine.generateContextPackage(targetFile, {
      depth,
      includeCode: !noCode,
      configPath: ctx.configPath,
    });

    const output = isJson ? JSON.stringify(pkg, null, 2) : contextEngine.renderMarkdown(pkg);

    if (outputPath) {
      const resolvedOutput = path.resolve(process.cwd(), outputPath);
      await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
      await fs.writeFile(resolvedOutput, output, 'utf8');
      console.log(`✓ Context package saved to "${outputPath}"`);
    } else {
      console.log(output);
    }

    return 0;
  }

  private async handleImpact(ctx: CliContext): Promise<number> {
    const nonFlagArgs = ctx.args.filter((a) => !a.startsWith('-'));
    if (nonFlagArgs.length === 0) {
      console.error(
        'Error: Target file is required. Usage: stubs impact <target> [--depth <n>] [--json] [--transitive] [--upstream]',
      );
      return 1;
    }

    const target = nonFlagArgs[0];
    const isJson = ctx.args.includes('--json');
    const isTransitive = ctx.args.includes('--transitive');
    const isUpstream = ctx.args.includes('--upstream');
    const direction = isUpstream ? 'outbound' : 'inbound';

    let depth: number | undefined;
    for (let i = 0; i < ctx.args.length; i++) {
      if (ctx.args[i] === '--depth' && ctx.args[i + 1]) {
        depth = parseInt(ctx.args[i + 1], 10) || 3;
        i++;
      } else if (ctx.args[i].startsWith('--depth=')) {
        depth = parseInt(ctx.args[i].split('=')[1], 10) || 3;
      }
    }

    const config = loadConfig(ctx.configPath);
    const graphEngine = new GraphEngine(config.paths.db_path);
    await graphEngine.initialize();

    const impactEngine = new ImpactEngine({ graphEngine });
    const result = await impactEngine.analyzeImpact(target, {
      depth,
      direction,
      transitive: isTransitive,
      configPath: ctx.configPath,
    });

    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(impactEngine.renderMarkdown(result));
    }

    return 0;
  }

  private async handleLintArch(ctx: CliContext): Promise<number> {
    const isJson = ctx.args.includes('--json');
    const isStrict = ctx.args.includes('--strict');

    let rules: any = undefined;
    for (let i = 0; i < ctx.args.length; i++) {
      if (ctx.args[i] === '--rule' && ctx.args[i + 1]) {
        rules = ctx.args[i + 1].split(',').map((r) => r.trim());
        i++;
      } else if (ctx.args[i].startsWith('--rule=')) {
        rules = ctx.args[i]
          .split('=')[1]
          .split(',')
          .map((r) => r.trim());
      }
    }

    const config = loadConfig(ctx.configPath);
    const graphEngine = new GraphEngine(config.paths.db_path);
    await graphEngine.initialize();

    const lintEngine = new ArchLintEngine({ graphEngine });
    const result = await lintEngine.lintWorkspace({
      strict: isStrict,
      rules,
      configPath: ctx.configPath,
    });

    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(lintEngine.renderMarkdown(result));
    }

    return result.summary.passed ? 0 : 1;
  }

  private async handleMock(ctx: CliContext): Promise<number> {
    const nonFlagArgs = ctx.args.filter((a) => !a.startsWith('-'));
    if (nonFlagArgs.length === 0) {
      console.error(
        'Error: File path is required. Usage: stubs mock <file> [--output <path>] [--framework <jest|vitest>] [--dry-run] [--force]',
      );
      return 1;
    }

    const targetFile = nonFlagArgs[0];
    const dryRun = ctx.args.includes('--dry-run');
    const force = ctx.args.includes('--force') || ctx.args.includes('-f');

    let outputPath: string | undefined;
    let framework: TestFramework = 'jest';

    for (let i = 0; i < ctx.args.length; i++) {
      if (ctx.args[i] === '--output' && ctx.args[i + 1]) {
        outputPath = ctx.args[i + 1];
        i++;
      } else if (ctx.args[i].startsWith('--output=')) {
        outputPath = ctx.args[i].split('=')[1];
      } else if (ctx.args[i] === '--framework' && ctx.args[i + 1]) {
        framework = ctx.args[i + 1] as TestFramework;
        i++;
      } else if (ctx.args[i].startsWith('--framework=')) {
        framework = ctx.args[i].split('=')[1] as TestFramework;
      }
    }

    const mockEngine = new MockEngine();
    const result = await mockEngine.generateTestScaffold(targetFile, {
      outputPath,
      framework,
      dryRun,
      force,
      configPath: ctx.configPath,
    });

    if (dryRun) {
      console.log(result.generatedCode);
    } else if (result.written) {
      console.log(
        `✓ Scaffolded test suite for "${result.sourceFilePath}" at "${result.targetTestPath}"`,
      );
    } else {
      console.log(
        `ℹ Test file "${result.targetTestPath}" already exists. Use --force to overwrite.`,
      );
    }

    return 0;
  }

  private async handleDiagram(ctx: CliContext): Promise<number> {
    const isJson = ctx.args.includes('--json');
    const nonFlagArgs = ctx.args.filter((a) => !a.startsWith('-'));
    const target = nonFlagArgs.length > 0 ? nonFlagArgs[0] : undefined;

    let type: DiagramType | undefined;
    let groupBy: 'layer' | 'domain' | 'none' | undefined;
    let syncPath: string | undefined;
    let outputPath: string | undefined;
    let depth: number | undefined;

    for (let i = 0; i < ctx.args.length; i++) {
      if (ctx.args[i] === '--type' && ctx.args[i + 1]) {
        type = ctx.args[i + 1] as DiagramType;
        i++;
      } else if (ctx.args[i].startsWith('--type=')) {
        type = ctx.args[i].split('=')[1] as DiagramType;
      } else if (ctx.args[i] === '--group-by' && ctx.args[i + 1]) {
        groupBy = ctx.args[i + 1] as any;
        i++;
      } else if (ctx.args[i].startsWith('--group-by=')) {
        groupBy = ctx.args[i].split('=')[1] as any;
      } else if (ctx.args[i] === '--sync') {
        if (ctx.args[i + 1] && !ctx.args[i + 1].startsWith('-')) {
          syncPath = ctx.args[i + 1];
          i++;
        } else {
          syncPath = 'knowledge/architecture/context-map.md';
        }
      } else if (ctx.args[i].startsWith('--sync=')) {
        syncPath = ctx.args[i].split('=')[1];
      } else if (ctx.args[i] === '--output' && ctx.args[i + 1]) {
        outputPath = ctx.args[i + 1];
        i++;
      } else if (ctx.args[i].startsWith('--output=')) {
        outputPath = ctx.args[i].split('=')[1];
      } else if (ctx.args[i] === '--depth' && ctx.args[i + 1]) {
        depth = parseInt(ctx.args[i + 1], 10) || 3;
        i++;
      } else if (ctx.args[i].startsWith('--depth=')) {
        depth = parseInt(ctx.args[i].split('=')[1], 10) || 3;
      }
    }

    const config = loadConfig(ctx.configPath);
    const graphEngine = new GraphEngine(config.paths.db_path);
    await graphEngine.initialize();

    const diagramEngine = new DiagramEngine({ graphEngine });
    const result = await diagramEngine.generateDiagram(target, {
      type,
      groupBy,
      syncPath,
      outputPath,
      depth,
      configPath: ctx.configPath,
    });

    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.syncedPath) {
      console.log(`✓ Synchronized Mermaid diagram into "${result.syncedPath}"`);
    } else if (result.writtenPath) {
      console.log(`✓ Written Mermaid diagram to "${result.writtenPath}"`);
    } else {
      console.log(result.mermaidCode);
    }

    return 0;
  }

  private async handlePrune(ctx: CliContext): Promise<number> {
    const isJson = ctx.args.includes('--json');
    const isFix = ctx.args.includes('--fix');
    const includeZombies = ctx.args.includes('--zombies') || ctx.args.includes('--zombie');

    let specsDir: string | undefined;
    for (let i = 0; i < ctx.args.length; i++) {
      if (ctx.args[i] === '--dir' && ctx.args[i + 1]) {
        specsDir = ctx.args[i + 1];
        i++;
      } else if (ctx.args[i].startsWith('--dir=')) {
        specsDir = ctx.args[i].split('=')[1];
      }
    }

    const config = loadConfig(ctx.configPath);
    const graphEngine = new GraphEngine(config.paths.db_path);
    await graphEngine.initialize();

    const pruneEngine = new PruneEngine({ graphEngine });
    const auditResult = await pruneEngine.auditWorkspace({
      includeZombies,
      fix: isFix,
      configPath: ctx.configPath,
      specsDir,
    });

    if (isFix) {
      const fixResult = await pruneEngine.fixOrphans(auditResult);
      if (isJson) {
        console.log(JSON.stringify({ auditResult, fixResult }, null, 2));
      } else {
        console.log(pruneEngine.renderMarkdown(auditResult));
        console.log(`\n✓ ${fixResult.message}`);
      }
      return 0;
    }

    if (isJson) {
      console.log(JSON.stringify(auditResult, null, 2));
    } else {
      console.log(pruneEngine.renderMarkdown(auditResult));
    }

    return auditResult.summary.isClean ? 0 : 1;
  }

  private async handleChangelog(ctx: CliContext): Promise<number> {
    const isJson = ctx.args.includes('--json');

    let since: string | undefined;
    let from: string | undefined;
    let to: string | undefined;
    let outputPath: string | undefined;
    let specsDir: string | undefined;

    for (let i = 0; i < ctx.args.length; i++) {
      if (ctx.args[i] === '--since' && ctx.args[i + 1]) {
        since = ctx.args[i + 1];
        i++;
      } else if (ctx.args[i].startsWith('--since=')) {
        since = ctx.args[i].split('=')[1];
      } else if (ctx.args[i] === '--from' && ctx.args[i + 1]) {
        from = ctx.args[i + 1];
        i++;
      } else if (ctx.args[i].startsWith('--from=')) {
        from = ctx.args[i].split('=')[1];
      } else if (ctx.args[i] === '--to' && ctx.args[i + 1]) {
        to = ctx.args[i + 1];
        i++;
      } else if (ctx.args[i].startsWith('--to=')) {
        to = ctx.args[i].split('=')[1];
      } else if (ctx.args[i] === '--output' && ctx.args[i + 1]) {
        outputPath = ctx.args[i + 1];
        i++;
      } else if (ctx.args[i].startsWith('--output=')) {
        outputPath = ctx.args[i].split('=')[1];
      } else if (ctx.args[i] === '--dir' && ctx.args[i + 1]) {
        specsDir = ctx.args[i + 1];
        i++;
      } else if (ctx.args[i].startsWith('--dir=')) {
        specsDir = ctx.args[i].split('=')[1];
      }
    }

    const changelogEngine = new ChangelogEngine();
    const changelog = await changelogEngine.generateChangelog({
      since,
      from,
      to,
      outputPath,
      configPath: ctx.configPath,
      specsDir,
    });

    if (isJson) {
      console.log(JSON.stringify(changelog, null, 2));
    } else if (outputPath) {
      console.log(`✓ Written semantic architectural changelog to "${outputPath}"`);
    } else {
      console.log(changelogEngine.renderMarkdown(changelog));
    }

    return 0;
  }
}

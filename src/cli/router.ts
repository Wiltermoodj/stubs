import { promises as fs, existsSync } from 'fs';
import * as path from 'path';
import { parseOkfSpec } from '../parser/okf';
import { TemplateEngine } from '../templates/engine';
import { AutonomyProtocol } from '../autonomy/protocol';
import { loadConfig } from '../config/schema';

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
        case 'serve':
          return await this.handleServe(context);
        case 'validate':
          return await this.handleValidate(context);
        case 'template':
          return await this.handleTemplate(context);
        case 'reconcile':
          return await this.handleReconcile(context);
        case 'evaluate':
          return await this.handleEvaluate(context);
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
  validate <file>      Parse and validate an OKF sidecar (*.ts.md) file.
  serve                Start the local Web Portal and Event Bridge background server.
  template <action>    Manage template molds. Actions: list, render <name> <json_data_or_file>
  reconcile <file>     Execute the 5-phase retroactive reconciliation engine on a sidecar.
  evaluate <action>    Evaluate autonomy permission. Actions: draft_template_proposal, scaffold_sidecar, materialize_code
  help                 Display this help message.
  version              Display version information.

Options:
  -c, --config <path>  Specify path to stubs configuration file (default: .stubs/config.json)
  -h, --help           Display help message.
  -v, --version        Display version info.
`);
  }

  private async printVersion(): Promise<void> {
    try {
      const packageJsonPath = path.resolve(__dirname, '../../package.json');
      const content = await fs.readFile(packageJsonPath, 'utf8');
      const pkg = JSON.parse(content);
      console.log(`stubs version ${pkg.version || '1.0.0'}`);
    } catch {
      console.log('stubs version 1.0.0');
    }
  }

  private async handleServe(_ctx: CliContext): Promise<number> {
    console.log('Starting stubs Web Portal (serve mode)...');
    return 0;
  }

  private async handleValidate(ctx: CliContext): Promise<number> {
    if (ctx.args.length === 0) {
      console.error('Error: "validate" command requires a file path argument.');
      console.error('Usage: stubs validate <file.ts.md>');
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
      console.error('Usage: stubs reconcile <sidecar_file.ts.md>');
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
}

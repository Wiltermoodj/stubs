import { promises as fs, existsSync } from 'fs';
import * as path from 'path';
import { parseOkfSpec } from '../parser/okf';
import { loadConfig } from '../config/schema';
import { SandingEngine, SyncResult } from '../sanding/engine';
import { MaterializerEngine } from '../materializer/engine';

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
        case 'sync':
          return await this.handleSync(context);
        case 'materialize':
          return await this.handleMaterialize(context);
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
  validate <file>     Parse and validate an OKF sidecar (*.ts.md) file.
  materialize <file>  Parse, extract, typecheck, and write executable code from sidecar.
  sync [file]      Synchronize sidecars and code files.
  serve               Start the local Web Portal and Event Bridge background server.
  help                Display this help message.
  version             Display version information.

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

  private async handleMaterialize(ctx: CliContext): Promise<number> {
    if (ctx.args.length === 0) {
      console.error('Error: "materialize" command requires a file path argument.');
      console.error('Usage: stubs materialize <file.ts.md>');
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

  private async handleSync(ctx: CliContext): Promise<number> {
    const config = loadConfig();
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

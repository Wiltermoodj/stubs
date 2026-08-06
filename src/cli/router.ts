import { promises as fs, existsSync } from 'fs';
import * as path from 'path';
import { parseOkfSpec } from '../parser/okf';
import { GraphEngine } from '../graph/engine';
import { PortalServer } from '../server/portal';

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
  validate <file>  Parse and validate an OKF sidecar (*.ts.md) file.
  serve            Start the local Web Portal and Event Bridge background server.
  help             Display this help message.
  version          Display version information.

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
}

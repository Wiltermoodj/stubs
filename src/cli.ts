import { applyGlobalConsoleMasking } from './storage/credentials';
// Apply global masking on console outputs early
applyGlobalConsoleMasking();

import { CliRouter } from './cli/router';

async function main() {
  const router = new CliRouter();
  const exitCode = await router.route(process.argv.slice(2));
  process.exit(exitCode);
}

main();

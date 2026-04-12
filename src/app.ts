import type { Args } from "./args.js";
import { parseArgs, printHelp } from "./args.js";
import { hasErrorDiagnostics, reportDiagnostics } from "./diagnostics.js";
import { readPipedStdin } from "./files.js";
import { handlePackageCommand } from "./package-commands.js";
import {
  collectExtensionFlags,
  createPizzaRuntime,
  listModelsCommand,
  loadPizzaServices,
  runPizzaWithRuntime,
} from "./runtime.js";
import { validateForkFlags } from "./session-target.js";
import { APP_NAME, VERSION } from "./config.js";

function applyOfflineMode(args: Args): void {
  if (args.offline) {
    process.env.PI_OFFLINE = "1";
    process.env.PI_SKIP_VERSION_CHECK = "1";
  }
}

export async function main(argv: string[]): Promise<void> {
  if (await handlePackageCommand(argv)) {
    return;
  }

  const args = parseArgs(argv);
  reportDiagnostics(args.diagnostics);
  if (hasErrorDiagnostics(args.diagnostics)) {
    process.exitCode = 1;
    return;
  }

  applyOfflineMode(args);

  if (args.version) {
    console.log(`\u{1F355} ${APP_NAME} v${VERSION}`);
    return;
  }

  if (args.help) {
    const { services } = await loadPizzaServices(args, process.cwd());
    printHelp(collectExtensionFlags(services));
    return;
  }

  if (args.listModels !== undefined) {
    const diagnostics = await listModelsCommand(args);
    reportDiagnostics(diagnostics);
    if (hasErrorDiagnostics(diagnostics)) {
      process.exitCode = 1;
    }
    return;
  }

  try {
    validateForkFlags(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
    return;
  }

  let stdinContent: string | undefined;
  if (args.mode !== "rpc") {
    stdinContent = await readPipedStdin();
  }

  try {
    const created = await createPizzaRuntime(args);
    const diagnostics = [
      ...created.startupDiagnostics,
      ...created.runtime.diagnostics,
    ];
    reportDiagnostics(diagnostics);
    if (hasErrorDiagnostics(diagnostics)) {
      process.exitCode = 1;
      return;
    }
    const exitCode = await runPizzaWithRuntime(
      args,
      created.runtime,
      stdinContent,
    );
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  }
}

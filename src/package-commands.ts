import { DefaultPackageManager, SettingsManager } from "@mariozechner/pi-coding-agent";
import {
  APP_NAME,
  PI_PROJECT_CONFIG_DIR,
  getGlobalResourceDirs,
  getPizzaDir,
  getProjectPizzaDir,
  getProjectResourceDirs,
} from "./config.js";
import { collectSettingsDiagnostics, reportDiagnostics } from "./diagnostics.js";

type PackageCommand = "install" | "remove" | "update" | "list";

function getPackageCommandUsage(command: PackageCommand): string {
  switch (command) {
    case "install":
      return `${APP_NAME} install <source> [-l]`;
    case "remove":
      return `${APP_NAME} remove <source> [-l]`;
    case "update":
      return `${APP_NAME} update [source]`;
    case "list":
      return `${APP_NAME} list`;
  }
}

function printPackageCommandHelp(command: PackageCommand): void {
  switch (command) {
    case "install":
      console.log(
        [
          "Usage:",
          `  ${getPackageCommandUsage("install")}`,
          "",
          "Install a package and add it to settings.",
          "",
          "Options:",
          `  -l, --local    Install project-locally (${PI_PROJECT_CONFIG_DIR}/settings.json)`,
        ].join("\n"),
      );
      return;
    case "remove":
      console.log(
        [
          "Usage:",
          `  ${getPackageCommandUsage("remove")}`,
          "",
          "Remove a package and its source from settings.",
          `Alias: ${APP_NAME} uninstall <source> [-l]`,
          "",
          "Options:",
          `  -l, --local    Remove from project settings (${PI_PROJECT_CONFIG_DIR}/settings.json)`,
        ].join("\n"),
      );
      return;
    case "update":
      console.log(
        [
          "Usage:",
          `  ${getPackageCommandUsage("update")}`,
          "",
          "Update installed packages.",
        ].join("\n"),
      );
      return;
    case "list":
      console.log(
        [
          "Usage:",
          `  ${getPackageCommandUsage("list")}`,
          "",
          "List installed packages from user and project settings.",
        ].join("\n"),
      );
  }
}

function parsePackageCommand(args: string[]): {
  command: PackageCommand;
  source?: string;
  local: boolean;
  help: boolean;
  invalidOption?: string;
} | undefined {
  const [rawCommand, ...rest] = args;
  let command: PackageCommand | undefined;

  if (rawCommand === "uninstall") {
    command = "remove";
  } else if (
    rawCommand === "install" ||
    rawCommand === "remove" ||
    rawCommand === "update" ||
    rawCommand === "list"
  ) {
    command = rawCommand;
  }

  if (!command) {
    return undefined;
  }

  let local = false;
  let help = false;
  let invalidOption: string | undefined;
  let source: string | undefined;

  for (const arg of rest) {
    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }
    if (arg === "-l" || arg === "--local") {
      if (command === "install" || command === "remove") {
        local = true;
      } else {
        invalidOption = invalidOption ?? arg;
      }
      continue;
    }
    if (arg.startsWith("-")) {
      invalidOption = invalidOption ?? arg;
      continue;
    }
    if (!source) {
      source = arg;
    }
  }

  return { command, source, local, help, invalidOption };
}

function showConfigOverview(cwd: string): void {
  const agentDir = getPizzaDir();
  const settingsManager = SettingsManager.create(cwd, agentDir);
  reportDiagnostics(collectSettingsDiagnostics(settingsManager, "config command"));
  const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  const configuredPackages = packageManager.listConfiguredPackages();
  const globalDirs = getGlobalResourceDirs(agentDir);
  const projectDirs = getProjectResourceDirs(cwd);

  console.log(
    [
      "Pizza configuration overview",
      "",
      `Global config root:   ${agentDir}`,
      `Global extensions:    ${globalDirs.extensions}`,
      `Global prompts:       ${globalDirs.prompts}`,
      `Global skills:        ${globalDirs.skills}`,
      `Global themes:        ${globalDirs.themes}`,
      "",
      `Project .pizza root:  ${getProjectPizzaDir(cwd)}`,
      `Project extensions:   ${projectDirs.extensions}`,
      `Project prompts:      ${projectDirs.prompts}`,
      `Project skills:       ${projectDirs.skills}`,
      `Project themes:       ${projectDirs.themes}`,
      "",
      `Pi project settings:  ${PI_PROJECT_CONFIG_DIR}/settings.json`,
      "",
      configuredPackages.length > 0
        ? "Configured packages:"
        : "Configured packages: none",
      ...configuredPackages.map(
        (pkg) => `  [${pkg.scope}] ${pkg.source}${pkg.filtered ? " (filtered)" : ""}`,
      ),
    ].join("\n"),
  );
}

export async function handlePackageCommand(args: string[]): Promise<boolean> {
  if (args[0] === "config") {
    showConfigOverview(process.cwd());
    return true;
  }

  const options = parsePackageCommand(args);
  if (!options) {
    return false;
  }

  if (options.help) {
    printPackageCommandHelp(options.command);
    return true;
  }

  if (options.invalidOption) {
    console.error(
      `Unknown option ${options.invalidOption} for "${options.command}".`,
    );
    console.error(`Use "${APP_NAME} --help" or "${getPackageCommandUsage(options.command)}".`);
    process.exitCode = 1;
    return true;
  }

  if (
    (options.command === "install" || options.command === "remove") &&
    !options.source
  ) {
    console.error(`Missing ${options.command} source.`);
    console.error(`Usage: ${getPackageCommandUsage(options.command)}`);
    process.exitCode = 1;
    return true;
  }

  const cwd = process.cwd();
  const agentDir = getPizzaDir();
  const settingsManager = SettingsManager.create(cwd, agentDir);
  reportDiagnostics(collectSettingsDiagnostics(settingsManager, "package command"));
  const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  packageManager.setProgressCallback((event) => {
    if (event.type === "start" && event.message) {
      process.stdout.write(`${event.message}\n`);
    }
  });

  try {
    switch (options.command) {
      case "install":
        await packageManager.installAndPersist(options.source!, {
          local: options.local,
        });
        console.log(`Installed ${options.source}`);
        return true;
      case "remove": {
        const removed = await packageManager.removeAndPersist(options.source!, {
          local: options.local,
        });
        if (!removed) {
          console.error(`No matching package found for ${options.source}`);
          process.exitCode = 1;
          return true;
        }
        console.log(`Removed ${options.source}`);
        return true;
      }
      case "list": {
        const configuredPackages = packageManager.listConfiguredPackages();
        if (configuredPackages.length === 0) {
          console.log("No packages installed.");
          return true;
        }
        for (const pkg of configuredPackages) {
          console.log(`[${pkg.scope}] ${pkg.source}`);
          if (pkg.installedPath) {
            console.log(`  ${pkg.installedPath}`);
          }
        }
        return true;
      }
      case "update":
        await packageManager.update(options.source);
        console.log(options.source ? `Updated ${options.source}` : "Updated packages");
        return true;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
    return true;
  }
}

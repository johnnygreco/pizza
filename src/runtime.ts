import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  AuthStorage,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  InteractiveMode,
  runPrintMode,
  runRpcMode,
  SessionManager,
  SettingsManager,
  initTheme,
  type ExtensionFlag,
} from "@mariozechner/pi-coding-agent";
import type { Args, BuiltInToolName, Mode } from "./args.js";
import { expandHome, getAuthPath, getGlobalResourceDirs, getModelsPath, getPizzaDir, getProjectResourceDirs } from "./config.js";
import {
  collectSettingsDiagnostics,
  type Diagnostic,
} from "./diagnostics.js";
import { prepareInitialMessage } from "./files.js";
import { buildSessionOptions, printModels, resolveModelScope } from "./model-selection.js";
import { createInitialSessionManager } from "./session-target.js";
import pizzaUiExtension from "./extensions/pizza-ui.js";

export type AppMode = "interactive" | "print" | "json" | "rpc";

export function isLocalPath(value: string): boolean {
  return (
    value.startsWith(".") ||
    value.startsWith("/") ||
    value.startsWith("~") ||
    /^[A-Za-z]:[\\/]/.test(value)
  );
}

export function resolveCliPaths(cwd: string, paths: string[] | undefined): string[] {
  return (
    paths?.map((value) => (isLocalPath(value) ? resolve(cwd, expandHome(value)) : value)) ?? []
  );
}

function collectExistingPaths(paths: string[]): string[] {
  return paths.filter((path) => existsSync(path));
}

export function resolveAppMode(parsed: Args, stdinIsTTY: boolean): AppMode {
  if (parsed.mode === "rpc") {
    return "rpc";
  }
  if (parsed.mode === "json") {
    return "json";
  }
  if (parsed.print || !stdinIsTTY) {
    return "print";
  }
  return "interactive";
}

function toPrintOutputMode(appMode: AppMode): Exclude<Mode, "rpc"> {
  return appMode === "json" ? "json" : "text";
}

function resolveResourcePaths(
  cwd: string,
  cliPaths: string[] | undefined,
  discoveryPaths: string[],
  skip: boolean | undefined,
): string[] {
  return [
    ...resolveCliPaths(cwd, cliPaths),
    ...(skip ? [] : collectExistingPaths(discoveryPaths)),
  ];
}

function buildResourceLoaderOptions(cwd: string, args: Args) {
  const global = getGlobalResourceDirs();
  const project = getProjectResourceDirs(cwd);

  return {
    additionalExtensionPaths: resolveResourcePaths(cwd, args.extensions, [global.extensions, project.extensions], args.noExtensions),
    additionalSkillPaths: resolveResourcePaths(cwd, args.skills, [global.skills, project.skills], args.noSkills),
    additionalPromptTemplatePaths: resolveResourcePaths(cwd, args.promptTemplates, [global.prompts, project.prompts], args.noPromptTemplates),
    additionalThemePaths: resolveResourcePaths(cwd, args.themes, [global.themes, project.themes], args.noThemes),
    extensionFactories: [pizzaUiExtension],
    noExtensions: args.noExtensions,
    noSkills: args.noSkills,
    noPromptTemplates: args.noPromptTemplates,
    noThemes: args.noThemes,
    systemPrompt: args.systemPrompt,
    appendSystemPrompt: args.appendSystemPrompt,
  };
}

export async function loadPizzaServices(
  args: Args,
  cwd: string,
  authStorage = AuthStorage.create(getAuthPath()),
  agentDir = getPizzaDir(),
): Promise<{
  services: Awaited<ReturnType<typeof createAgentSessionServices>>;
  diagnostics: Diagnostic[];
}> {
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    authStorage,
    extensionFlagValues: args.unknownFlags,
    resourceLoaderOptions: buildResourceLoaderOptions(cwd, args),
  });

  const diagnostics: Diagnostic[] = [
    ...services.diagnostics,
    ...collectSettingsDiagnostics(services.settingsManager, "runtime creation"),
    ...services.resourceLoader.getExtensions().errors.map(({ path, error }) => ({
      type: "error" as const,
      message: `Failed to load extension "${path}": ${error}`,
    })),
  ];

  const modelRegistryError = services.modelRegistry.getError();
  if (modelRegistryError) {
    diagnostics.push({
      type: "warning",
      message: `models.json: ${modelRegistryError}`,
    });
  }

  return { services, diagnostics };
}

export function collectExtensionFlags(
  services: Awaited<ReturnType<typeof createAgentSessionServices>>,
): ExtensionFlag[] {
  return services
    .resourceLoader
    .getExtensions()
    .extensions
    .flatMap((extension) => Array.from(extension.flags.values()));
}

export async function createPizzaRuntime(args: Args, cwd = process.cwd()): Promise<{
  runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>>;
  startupDiagnostics: Diagnostic[];
}> {
  const agentDir = getPizzaDir();
  const startupSettingsManager = SettingsManager.create(cwd, agentDir);
  const startupDiagnostics = collectSettingsDiagnostics(
    startupSettingsManager,
    "startup session lookup",
  );
  const sessionDir = args.sessionDir ?? startupSettingsManager.getSessionDir();
  const sessionManager = await createInitialSessionManager(
    args,
    cwd,
    sessionDir,
  );
  const authStorage = AuthStorage.create(getAuthPath(agentDir));

  const createRuntime = async (options: {
    cwd: string;
    agentDir: string;
    sessionManager: SessionManager;
    sessionStartEvent?: {
      type: "session_start";
      reason: "startup" | "reload" | "new" | "resume" | "fork";
      previousSessionFile?: string;
    };
  }) => {
    const { services, diagnostics } = await loadPizzaServices(
      args,
      options.cwd,
      authStorage,
      options.agentDir,
    );

    const modelPatterns =
      args.models ?? services.settingsManager.getEnabledModels();
    const scopedModels =
      modelPatterns && modelPatterns.length > 0
        ? resolveModelScope(modelPatterns, services.modelRegistry)
        : [];
    const sessionOptions = buildSessionOptions(
      args,
      scopedModels,
      options.sessionManager.buildSessionContext().messages.length > 0,
      services.modelRegistry,
      services.settingsManager,
    );
    diagnostics.push(...sessionOptions.diagnostics);

    if (args.apiKey) {
      if (!sessionOptions.options.model) {
        diagnostics.push({
          type: "error",
          message:
            "--api-key requires a model to be specified via --model or --provider/--model",
        });
      } else {
        authStorage.setRuntimeApiKey(
          sessionOptions.options.model.provider,
          args.apiKey,
        );
      }
    }

    const created = await createAgentSessionFromServices({
      services,
      sessionManager: options.sessionManager,
      sessionStartEvent: options.sessionStartEvent,
      model: sessionOptions.options.model,
      thinkingLevel: sessionOptions.options.thinkingLevel,
      scopedModels: sessionOptions.options.scopedModels,
      tools: sessionOptions.options.tools,
      customTools: [],
    });

    return {
      ...created,
      services,
      diagnostics,
    };
  };

  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd: sessionManager.getCwd(),
    agentDir,
    sessionManager,
  });

  return { runtime, startupDiagnostics };
}

export async function listModelsCommand(
  args: Args,
  cwd = process.cwd(),
): Promise<Diagnostic[]> {
  const { services, diagnostics } = await loadPizzaServices(args, cwd);
  printModels(
    services.modelRegistry,
    typeof args.listModels === "string" ? args.listModels : undefined,
  );
  return diagnostics;
}

export async function runPizza(args: Args, stdinContent?: string): Promise<number> {
  if (args.mode === "rpc" && args.fileArgs.length > 0) {
    console.error("Error: @file arguments are not supported in RPC mode");
    return 1;
  }

  const { runtime } = await createPizzaRuntime(args);
  return runPizzaWithRuntime(args, runtime, stdinContent);
}

export async function runPizzaWithRuntime(
  args: Args,
  runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>>,
  stdinContent?: string,
): Promise<number> {
  const settingsManager = runtime.services.settingsManager;
  let appMode = resolveAppMode(args, process.stdin.isTTY);
  if (stdinContent !== undefined && appMode === "interactive") {
    appMode = "print";
  }

  initTheme(settingsManager.getTheme(), appMode === "interactive");

  const { initialMessage, initialImages, remainingMessages } =
    await prepareInitialMessage(args, runtime.cwd, stdinContent);

  if (appMode !== "interactive" && !runtime.session.model) {
    console.error("No models available.");
    console.error("");
    console.error("Set an API key environment variable or configure models:");
    console.error(`  ${getModelsPath(runtime.services.agentDir)}`);
    return 1;
  }

  if (
    appMode === "interactive" &&
    runtime.session.scopedModels.length > 0 &&
    (args.verbose || !settingsManager.getQuietStartup())
  ) {
    const modelList = runtime.session.scopedModels
      .map((scopedModel) =>
        scopedModel.thinkingLevel
          ? `${scopedModel.model.id}:${scopedModel.thinkingLevel}`
          : scopedModel.model.id,
      )
      .join(", ");
    console.log(`Model scope: ${modelList} (Ctrl+P to cycle)`);
  }

  if (appMode === "rpc") {
    await runRpcMode(runtime);
    return 0;
  }

  if (appMode === "interactive") {
    const interactiveMode = new InteractiveMode(runtime, {
      modelFallbackMessage: runtime.modelFallbackMessage,
      initialMessage,
      initialImages,
      initialMessages: remainingMessages,
      verbose: args.verbose,
    });
    await interactiveMode.run();
    return 0;
  }

  return runPrintMode(runtime, {
    mode: toPrintOutputMode(appMode),
    initialMessage,
    initialImages,
    messages: remainingMessages,
  });
}

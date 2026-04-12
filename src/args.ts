import type { ExtensionFlag } from "@mariozechner/pi-coding-agent";
import {
  bashTool,
  editTool,
  findTool,
  grepTool,
  lsTool,
  readTool,
  writeTool,
} from "@mariozechner/pi-coding-agent";
import {
  APP_NAME,
  CONFIG_DIR,
  PI_PROJECT_CONFIG_DIR,
  PIZZA_DIR_ENV,
  PROJECT_CONFIG_DIR,
} from "./config.js";
import type { Diagnostic } from "./diagnostics.js";

export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export const BUILT_IN_TOOLS = {
  read: readTool,
  bash: bashTool,
  edit: editTool,
  write: writeTool,
  grep: grepTool,
  find: findTool,
  ls: lsTool,
} as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type Mode = "text" | "json" | "rpc";
export type BuiltInToolName = keyof typeof BUILT_IN_TOOLS;

export type Args = {
  provider?: string;
  model?: string;
  apiKey?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  thinking?: ThinkingLevel;
  continue?: boolean;
  resume?: boolean;
  help?: boolean;
  version?: boolean;
  mode?: Mode;
  noSession?: boolean;
  session?: string;
  fork?: string;
  sessionDir?: string;
  models?: string[];
  tools?: BuiltInToolName[];
  noTools?: boolean;
  extensions?: string[];
  noExtensions?: boolean;
  print?: boolean;
  noSkills?: boolean;
  skills?: string[];
  promptTemplates?: string[];
  noPromptTemplates?: boolean;
  themes?: string[];
  noThemes?: boolean;
  listModels?: string | true;
  offline?: boolean;
  verbose?: boolean;
  messages: string[];
  fileArgs: string[];
  unknownFlags: Map<string, boolean | string>;
  diagnostics: Diagnostic[];
};

export function isValidThinkingLevel(level: string): level is ThinkingLevel {
  return THINKING_LEVELS.includes(level as ThinkingLevel);
}

function formatExtensionFlags(extensionFlags?: ExtensionFlag[]): string {
  if (!extensionFlags || extensionFlags.length === 0) {
    return "";
  }

  const lines = extensionFlags.map((flag) => {
    const value = flag.type === "string" ? " <value>" : "";
    const description =
      flag.description ?? `Registered by ${flag.extensionPath}`;
    return `  --${flag.name}${value}`.padEnd(30) + description;
  });

  return [
    "",
    "Extension CLI Flags:",
    ...lines,
  ].join("\n");
}

export function parseArgs(args: string[]): Args {
  const result: Args = {
    messages: [],
    fileArgs: [],
    unknownFlags: new Map(),
    diagnostics: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--version" || arg === "-v") {
      result.version = true;
    } else if (arg === "--mode" && i + 1 < args.length) {
      const mode = args[++i];
      if (mode === "text" || mode === "json" || mode === "rpc") {
        result.mode = mode;
      } else {
        result.diagnostics.push({
          type: "error",
          message: `Unknown mode "${mode}". Valid modes: text, json, rpc`,
        });
      }
    } else if (arg === "--continue" || arg === "-c") {
      result.continue = true;
    } else if (arg === "--resume" || arg === "-r") {
      result.resume = true;
    } else if (arg === "--provider" && i + 1 < args.length) {
      result.provider = args[++i];
    } else if (arg === "--model" && i + 1 < args.length) {
      result.model = args[++i];
    } else if (arg === "--api-key" && i + 1 < args.length) {
      result.apiKey = args[++i];
    } else if (arg === "--system-prompt" && i + 1 < args.length) {
      result.systemPrompt = args[++i];
    } else if (arg === "--append-system-prompt" && i + 1 < args.length) {
      result.appendSystemPrompt = args[++i];
    } else if (arg === "--no-session") {
      result.noSession = true;
    } else if (arg === "--session" && i + 1 < args.length) {
      result.session = args[++i];
    } else if (arg === "--fork" && i + 1 < args.length) {
      result.fork = args[++i];
    } else if (arg === "--session-dir" && i + 1 < args.length) {
      result.sessionDir = args[++i];
    } else if (arg === "--models" && i + 1 < args.length) {
      result.models = args[++i].split(",").map((value) => value.trim());
    } else if (arg === "--no-tools") {
      result.noTools = true;
    } else if (arg === "--tools" && i + 1 < args.length) {
      const toolNames = args[++i].split(",").map((value) => value.trim());
      const validTools: BuiltInToolName[] = [];

      for (const toolName of toolNames) {
        if (toolName in BUILT_IN_TOOLS) {
          validTools.push(toolName as BuiltInToolName);
        } else {
          result.diagnostics.push({
            type: "warning",
            message: `Unknown tool "${toolName}". Valid tools: ${Object.keys(
              BUILT_IN_TOOLS,
            ).join(", ")}`,
          });
        }
      }

      result.tools = validTools;
    } else if (arg === "--thinking" && i + 1 < args.length) {
      const level = args[++i];
      if (isValidThinkingLevel(level)) {
        result.thinking = level;
      } else {
        result.diagnostics.push({
          type: "warning",
          message: `Invalid thinking level "${level}". Valid values: ${THINKING_LEVELS.join(", ")}`,
        });
      }
    } else if (arg === "--print" || arg === "-p") {
      result.print = true;
    } else if ((arg === "--extension" || arg === "-e") && i + 1 < args.length) {
      result.extensions = result.extensions ?? [];
      result.extensions.push(args[++i]);
    } else if (arg === "--no-extensions" || arg === "-ne") {
      result.noExtensions = true;
    } else if (arg === "--skill" && i + 1 < args.length) {
      result.skills = result.skills ?? [];
      result.skills.push(args[++i]);
    } else if (arg === "--prompt-template" && i + 1 < args.length) {
      result.promptTemplates = result.promptTemplates ?? [];
      result.promptTemplates.push(args[++i]);
    } else if (arg === "--theme" && i + 1 < args.length) {
      result.themes = result.themes ?? [];
      result.themes.push(args[++i]);
    } else if (arg === "--no-skills" || arg === "-ns") {
      result.noSkills = true;
    } else if (arg === "--no-prompt-templates" || arg === "-np") {
      result.noPromptTemplates = true;
    } else if (arg === "--no-themes") {
      result.noThemes = true;
    } else if (arg === "--list-models") {
      if (
        i + 1 < args.length &&
        !args[i + 1].startsWith("-") &&
        !args[i + 1].startsWith("@")
      ) {
        result.listModels = args[++i];
      } else {
        result.listModels = true;
      }
    } else if (arg === "--verbose") {
      result.verbose = true;
    } else if (arg === "--offline") {
      result.offline = true;
    } else if (arg.startsWith("@")) {
      result.fileArgs.push(arg.slice(1));
    } else if (arg.startsWith("--")) {
      const eqIndex = arg.indexOf("=");
      if (eqIndex !== -1) {
        result.unknownFlags.set(
          arg.slice(2, eqIndex),
          arg.slice(eqIndex + 1),
        );
      } else {
        const flagName = arg.slice(2);
        const next = args[i + 1];
        if (
          next !== undefined &&
          !next.startsWith("-") &&
          !next.startsWith("@")
        ) {
          result.unknownFlags.set(flagName, next);
          i++;
        } else {
          result.unknownFlags.set(flagName, true);
        }
      }
    } else if (arg.startsWith("-")) {
      result.diagnostics.push({
        type: "error",
        message: `Unknown option: ${arg}`,
      });
    } else {
      result.messages.push(arg);
    }
  }

  return result;
}

export function printHelp(extensionFlags?: ExtensionFlag[]): void {
  const extensionFlagsText = formatExtensionFlags(extensionFlags);

  console.log(
    [
      `${APP_NAME} - Pi with toppings`,
      "",
      "Usage:",
      `  ${APP_NAME} [options] [@files...] [messages...]`,
      "",
      "Commands:",
      `  ${APP_NAME} install <source> [-l]     Install extension source and add to settings`,
      `  ${APP_NAME} remove <source> [-l]      Remove extension source from settings`,
      `  ${APP_NAME} uninstall <source> [-l]   Alias for remove`,
      `  ${APP_NAME} update [source]           Update installed extensions (skips pinned sources)`,
      `  ${APP_NAME} list                      List installed extensions from settings`,
      `  ${APP_NAME} config                    Show resolved Pizza and Pi resource configuration`,
      `  ${APP_NAME} <command> --help          Show help for install/remove/uninstall/update/list`,
      "",
      "Options:",
      "  --provider <name>              Provider name",
      '  --model <pattern>              Model pattern or ID (supports "provider/id" and optional ":<thinking>")',
      "  --api-key <key>                API key override for the selected provider",
      "  --system-prompt <text>         Replace the default system prompt",
      "  --append-system-prompt <text>  Append text to the system prompt",
      "  --mode <mode>                  Output mode: text, json, or rpc",
      "  --print, -p                    Non-interactive mode: process prompt and exit",
      "  --continue, -c                 Continue previous session",
      "  --resume, -r                   Select a session to resume",
      "  --session <path|id>            Use a specific session file or partial UUID",
      "  --fork <path|id>               Fork a specific session into a new session",
      "  --session-dir <dir>            Directory for session storage and lookup",
      "  --no-session                   Don't save session (ephemeral)",
      "  --models <patterns>            Comma-separated model patterns for model cycling",
      "  --no-tools                     Disable all built-in tools",
      "  --tools <tools>                Comma-separated built-in tools to enable",
      `                                 Available: ${Object.keys(BUILT_IN_TOOLS).join(", ")}`,
      `  --thinking <level>             Set thinking level: ${THINKING_LEVELS.join(", ")}`,
      "  --extension, -e <path>         Load an extension file (can be used multiple times)",
      "  --no-extensions, -ne           Disable extension discovery (explicit -e paths still work)",
      "  --skill <path>                 Load a skill file or directory (can be used multiple times)",
      "  --no-skills, -ns               Disable skill discovery and loading",
      "  --prompt-template <path>       Load a prompt template file or directory",
      "  --no-prompt-templates, -np     Disable prompt template discovery and loading",
      "  --theme <path>                 Load a theme file or directory",
      "  --no-themes                    Disable theme discovery and loading",
      "  --list-models [search]         List available models (with optional search)",
      "  --verbose                      Force verbose startup",
      `  --offline                      Disable startup network operations (same as PI_OFFLINE=1)`,
      "  --help, -h                     Show this help",
      "  --version, -v                  Show version number",
      extensionFlagsText,
      "",
      "Behavior notes:",
      `  Global Pizza config lives under ~/${CONFIG_DIR} (override with ${PIZZA_DIR_ENV})`,
      `  Project-local resources are also loaded from ${PROJECT_CONFIG_DIR}/`,
      `  Pi project-local session/package behavior still uses ${PI_PROJECT_CONFIG_DIR}/`,
      "",
      "Examples:",
      `  ${APP_NAME}`,
      `  ${APP_NAME} "List all .ts files in src/"`,
      `  ${APP_NAME} @prompt.md "Summarize this plan"`,
      `  ${APP_NAME} -p "List all .ts files in src/"`,
      `  ${APP_NAME} --continue "What did we discuss?"`,
      `  ${APP_NAME} --model openai/gpt-4o "Help me refactor this code"`,
      `  ${APP_NAME} --models sonnet:high,haiku:low`,
      `  ${APP_NAME} --tools read,grep,find,ls -p "Review the code in src/"`,
      "",
      "Environment Variables:",
      "  ANTHROPIC_API_KEY              - Anthropic Claude API key",
      "  OPENAI_API_KEY                 - OpenAI GPT API key",
      "  GEMINI_API_KEY                 - Google Gemini API key",
      `  ${PIZZA_DIR_ENV.padEnd(30)} - Pizza config root (default: ~/${CONFIG_DIR})`,
      "  PI_OFFLINE                     - Disable startup network operations when set to 1/true/yes",
    ].join("\n"),
  );
}

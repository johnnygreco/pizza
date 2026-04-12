import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "..", "package.json"), "utf-8"),
);

export const VERSION: string = pkg.version;
export const APP_NAME = "pizza";
export const CONFIG_DIR = ".pizza";
export const PROJECT_CONFIG_DIR = ".pizza";
export const PI_PROJECT_CONFIG_DIR = ".pi";
export const PIZZA_DIR_ENV = "PIZZA_DIR";

export type ResourceDirs = {
  extensions: string;
  prompts: string;
  skills: string;
  themes: string;
};

export function expandHome(path: string): string {
  if (path === "~") {
    return homedir();
  }

  if (path.startsWith("~/")) {
    return resolve(homedir(), path.slice(2));
  }

  return path;
}

export function getPizzaDir(): string {
  return resolve(expandHome(process.env[PIZZA_DIR_ENV] ?? resolve(homedir(), CONFIG_DIR)));
}

export function getAuthPath(agentDir = getPizzaDir()): string {
  return resolve(agentDir, "auth.json");
}

export function getModelsPath(agentDir = getPizzaDir()): string {
  return resolve(agentDir, "models.json");
}

export function getGlobalResourceDirs(agentDir = getPizzaDir()): ResourceDirs {
  return {
    extensions: resolve(agentDir, "extensions"),
    prompts: resolve(agentDir, "prompts"),
    skills: resolve(agentDir, "skills"),
    themes: resolve(agentDir, "themes"),
  };
}

export function getProjectPizzaDir(cwd = process.cwd()): string {
  return resolve(cwd, PROJECT_CONFIG_DIR);
}

export function getProjectResourceDirs(cwd = process.cwd()): ResourceDirs {
  const root = getProjectPizzaDir(cwd);
  return {
    extensions: resolve(root, "extensions"),
    prompts: resolve(root, "prompts"),
    skills: resolve(root, "skills"),
    themes: resolve(root, "themes"),
  };
}

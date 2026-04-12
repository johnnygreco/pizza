import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "..", "package.json"), "utf-8"),
);

/** Derived from package.json — single source of truth. */
export const VERSION: string = pkg.version;
export const APP_NAME = "pizza";
export const CONFIG_DIR = ".pizza";

/**
 * Returns the root directory for pizza's configuration and data.
 * Respects PIZZA_DIR env var with tilde expansion, defaults to ~/.pizza.
 */
export function getPizzaDir(): string {
  const envDir = process.env.PIZZA_DIR;
  if (envDir) {
    if (envDir === "~") {
      return homedir();
    }
    if (envDir.startsWith("~/")) {
      return resolve(homedir(), envDir.slice(2));
    }
    return envDir;
  }
  return resolve(homedir(), CONFIG_DIR);
}

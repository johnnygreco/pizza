import { resolve } from "node:path";
import { homedir } from "node:os";

export const VERSION = "0.1.0";
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

import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getPizzaDir } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Returns absolute paths to pizza's shipped extensions. */
export function getShippedExtensions(): string[] {
  return [resolve(__dirname, "extensions", "status.js")];
}

/** Builds the argv for Pi's main: -e flags for shipped extensions + user args. */
export function buildPiArgs(
  shippedExtensions: string[],
  userArgs: string[],
): string[] {
  const extensionArgs = shippedExtensions.flatMap((ext) => ["-e", ext]);
  return [...extensionArgs, ...userArgs];
}

/**
 * Resolve Pi's main module from our dependency.
 * Uses import.meta.resolve (native Node ESM) to find the package entry,
 * then derives the path to main.js in the same dist directory.
 */
export function resolvePiMain(): string {
  let piEntry: string;
  try {
    piEntry = import.meta.resolve("@mariozechner/pi-coding-agent");
  } catch {
    throw new Error(
      "Could not resolve @mariozechner/pi-coding-agent. " +
        "Is it installed? Run: npm install",
    );
  }

  const piMainPath = resolve(dirname(fileURLToPath(piEntry)), "main.js");
  if (!existsSync(piMainPath)) {
    throw new Error(
      `Pi's main.js not found at ${piMainPath}. ` +
        "The package layout may have changed — check your pi-coding-agent version.",
    );
  }

  return piMainPath;
}

/**
 * Pizza's entry point. Sets up pizza's identity and config directory,
 * then hands off to Pi's runtime with pizza's shipped extensions loaded.
 */
export async function main(argv: string[]) {
  process.env.PI_CODING_AGENT_DIR = getPizzaDir();

  const piMainPath = resolvePiMain();
  const extensions = getShippedExtensions();
  const args = buildPiArgs(extensions, argv);

  const piMain = await import(pathToFileURL(piMainPath).href);
  await piMain.main(args);
}

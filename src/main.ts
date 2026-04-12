import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { VERSION, getPizzaDir } from "./config.js";

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
 *
 * COUPLING NOTE: This resolves Pi's public entry via import.meta.resolve,
 * then assumes main.js is a sibling of index.js in the same dist directory.
 * That path is NOT part of Pi's public exports — it's an internal layout
 * assumption. The existsSync guard below will catch breakage from a Pi
 * update that reorganizes dist/, but this remains the most fragile point
 * in the harness. Pin Pi to a tight semver range (~x.y.z) accordingly.
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
 * Pizza's entry point. Handles pizza-owned flags (--version, --help),
 * then delegates to Pi's runtime with pizza's config and extensions.
 */
export async function main(argv: string[]) {
  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(`\u{1F355} Pizza v${VERSION}`);
    process.exit(0);
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`\u{1F355} Pizza v${VERSION} \u2014 Pi with your personal toppings`);
    console.log();
    console.log(`  Config:     ${getPizzaDir()}`);
    console.log(`  Extensions: ${getPizzaDir()}/extensions/`);
    console.log(`  Override:   PIZZA_DIR=<path>`);
    console.log();
    console.log(
      "Pi's flags and environment variables are listed below. Where Pi",
    );
    console.log(
      "references PI_CODING_AGENT_DIR or ~/.pi/agent, Pizza uses PIZZA_DIR",
    );
    console.log(`and ${getPizzaDir()} instead.`);
    console.log();
    // Fall through to Pi's main for full flag documentation
  }

  process.env.PI_CODING_AGENT_DIR = getPizzaDir();

  const piMainPath = resolvePiMain();
  const extensions = getShippedExtensions();
  const args = buildPiArgs(extensions, argv);

  const piMain = await import(pathToFileURL(piMainPath).href);
  await piMain.main(args);
}

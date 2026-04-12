import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CLI_PATH = resolve("dist", "cli.js");

const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf-8"));

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf-8",
    timeout: 15_000,
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
  };
}

describe("CLI integration", () => {
  it("--version shows pizza's version, not Pi's", () => {
    const { stdout, status } = run("--version");
    expect(status).toBe(0);
    expect(stdout).toContain("Pizza");
    expect(stdout).toContain(pkg.version);
  });

  it("--help shows pizza banner with config paths", () => {
    const { stdout } = run("--help");
    expect(stdout).toContain("Pizza");
    expect(stdout).toContain(pkg.version);
    expect(stdout).toContain("PIZZA_DIR");
    expect(stdout).toContain(".pizza");
  });

  it("--help includes Pi's flag documentation", () => {
    const { stdout, stderr } = run("--help");
    // Pi may write help to stdout or stderr — check both
    const combined = stdout + stderr;
    expect(combined).toContain("--model");
    expect(combined).toContain("--provider");
  });
});

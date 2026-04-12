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
  it("--version shows pizza and version", () => {
    const { stdout, status } = run("--version");
    expect(status).toBe(0);
    expect(stdout).toContain("pizza");
    expect(stdout).toContain(pkg.version);
  });

  it("--help shows Pizza help text", () => {
    const { stdout } = run("--help");
    expect(stdout).toContain("Pi with toppings");
    expect(stdout).toContain("PIZZA_DIR");
    expect(stdout).toContain(".pizza");
    expect(stdout).toContain("pizza install <source> [-l]");
  });

  it("config shows .pizza roots and .pi settings note", () => {
    const { stdout, status } = run("config");
    expect(status).toBe(0);
    expect(stdout).toContain("Pizza configuration overview");
    expect(stdout).toContain(".pizza");
    expect(stdout).toContain(".pi/settings.json");
  });

  it("--list-models can resolve an exact model search", () => {
    const { stdout, status } = run("--list-models", "openai/gpt-4o");
    expect(status).toBe(0);
    expect(stdout).toContain("openai/gpt-4o");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("package manifest", () => {
  it("includes the optional subagents directory when present locally", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

    expect(pkg.pi?.extensions).toContain("subagents");
  });

  it("declares the supported Pi range alongside the Pi dev dependency", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const match = pkg.devDependencies?.["@mariozechner/pi-coding-agent"]?.match(/^(\d+)\.(\d+)\./);

    expect(match).toBeTruthy();
    expect(pkg.pizza?.compatibility?.pi).toBe(`~${match[1]}.${match[2]}.0`);
  });
});

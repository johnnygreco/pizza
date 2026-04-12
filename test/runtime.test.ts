import { describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { isLocalPath, resolveCliPaths, resolveAppMode } from "../src/runtime.js";
import type { Args } from "../src/args.js";

describe("isLocalPath", () => {
  it("recognizes relative paths", () => {
    expect(isLocalPath("./foo")).toBe(true);
    expect(isLocalPath("../bar")).toBe(true);
  });

  it("recognizes absolute paths", () => {
    expect(isLocalPath("/usr/local/ext.js")).toBe(true);
  });

  it("recognizes tilde paths", () => {
    expect(isLocalPath("~/extensions/foo.js")).toBe(true);
    expect(isLocalPath("~")).toBe(true);
  });

  it("treats bare names as non-local (package references)", () => {
    expect(isLocalPath("some-package")).toBe(false);
    expect(isLocalPath("@scope/package")).toBe(false);
  });
});

describe("resolveCliPaths", () => {
  it("expands tilde before resolving against cwd", () => {
    const result = resolveCliPaths("/some/cwd", ["~/my-ext.js"]);
    expect(result).toEqual([resolve(homedir(), "my-ext.js")]);
  });

  it("does not produce cwd/~/... for tilde paths", () => {
    const result = resolveCliPaths("/some/cwd", ["~/foo"]);
    expect(result[0]).not.toContain("/~/");
  });

  it("resolves relative paths against cwd", () => {
    const result = resolveCliPaths("/project", ["./ext.js"]);
    expect(result).toEqual([resolve("/project", "./ext.js")]);
  });

  it("passes non-local paths through unchanged", () => {
    const result = resolveCliPaths("/project", ["some-package"]);
    expect(result).toEqual(["some-package"]);
  });

  it("returns empty array for undefined input", () => {
    expect(resolveCliPaths("/project", undefined)).toEqual([]);
  });
});

describe("resolveAppMode", () => {
  const baseArgs: Args = {
    messages: [],
    fileArgs: [],
    unknownFlags: new Map(),
    diagnostics: [],
  };

  it("returns rpc when mode is rpc", () => {
    expect(resolveAppMode({ ...baseArgs, mode: "rpc" }, true)).toBe("rpc");
  });

  it("returns json when mode is json", () => {
    expect(resolveAppMode({ ...baseArgs, mode: "json" }, true)).toBe("json");
  });

  it("returns print when --print is set", () => {
    expect(resolveAppMode({ ...baseArgs, print: true }, true)).toBe("print");
  });

  it("returns print when stdin is not a TTY", () => {
    expect(resolveAppMode(baseArgs, false)).toBe("print");
  });

  it("returns interactive by default with TTY", () => {
    expect(resolveAppMode(baseArgs, true)).toBe("interactive");
  });
});

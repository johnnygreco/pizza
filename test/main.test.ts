import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getShippedExtensions, buildPiArgs } from "../src/main.js";

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");

describe("getShippedExtensions", () => {
  it("returns an array of absolute paths", () => {
    const exts = getShippedExtensions();
    expect(Array.isArray(exts)).toBe(true);
    expect(exts.length).toBeGreaterThan(0);
    for (const ext of exts) {
      expect(resolve(ext)).toBe(ext); // absolute
    }
  });

  it("includes the status extension", () => {
    const exts = getShippedExtensions();
    expect(exts.some((p) => p.includes("status"))).toBe(true);
  });
});

describe("buildPiArgs", () => {
  it("prepends -e flags for each shipped extension", () => {
    const exts = ["/a/ext1.js", "/b/ext2.js"];
    const args = buildPiArgs(exts, ["--model", "foo"]);
    expect(args).toEqual([
      "-e", "/a/ext1.js",
      "-e", "/b/ext2.js",
      "--model", "foo",
    ]);
  });

  it("passes through user args after extensions", () => {
    const args = buildPiArgs([], ["hello", "world"]);
    expect(args).toEqual(["hello", "world"]);
  });

  it("works with no user args", () => {
    const exts = ["/a/ext.js"];
    const args = buildPiArgs(exts, []);
    expect(args).toEqual(["-e", "/a/ext.js"]);
  });
});

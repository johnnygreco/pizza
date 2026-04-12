import { describe, expect, it } from "vitest";
import {
  formatUsd,
  estimateTokens,
  normalizeReadPath,
  shortenPath,
  extractCostTotal,
} from "../../extensions/context.ts";
import os from "node:os";
import path from "node:path";

describe("formatUsd", () => {
  it("returns $0.00 for zero", () => {
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("returns $0.00 for negative", () => {
    expect(formatUsd(-5)).toBe("$0.00");
  });

  it("returns $0.00 for NaN", () => {
    expect(formatUsd(NaN)).toBe("$0.00");
  });

  it("returns $0.00 for Infinity", () => {
    expect(formatUsd(Infinity)).toBe("$0.00");
  });

  it("formats >= $1 with 2 decimal places", () => {
    expect(formatUsd(1.5)).toBe("$1.50");
    expect(formatUsd(12.345)).toBe("$12.35");
  });

  it("formats $0.10-$0.99 with 3 decimal places", () => {
    expect(formatUsd(0.123)).toBe("$0.123");
    expect(formatUsd(0.5)).toBe("$0.500");
  });

  it("formats < $0.10 with 4 decimal places", () => {
    expect(formatUsd(0.0012)).toBe("$0.0012");
    expect(formatUsd(0.09)).toBe("$0.0900");
  });
});

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates roughly 1 token per 4 characters", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("rounds up partial tokens", () => {
    expect(estimateTokens("ab")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("normalizeReadPath", () => {
  it("resolves relative paths against cwd", () => {
    expect(normalizeReadPath("foo/bar.ts", "/home/user/project")).toBe(
      path.resolve("/home/user/project", "foo/bar.ts"),
    );
  });

  it("passes through absolute paths", () => {
    expect(normalizeReadPath("/absolute/path.ts", "/cwd")).toBe("/absolute/path.ts");
  });

  it("strips leading @ prefix", () => {
    expect(normalizeReadPath("@foo/bar.ts", "/cwd")).toBe(
      path.resolve("/cwd", "foo/bar.ts"),
    );
  });

  it("expands ~ to homedir", () => {
    expect(normalizeReadPath("~", "/cwd")).toBe(os.homedir());
  });

  it("expands ~/ paths", () => {
    expect(normalizeReadPath("~/docs/file.ts", "/cwd")).toBe(
      path.join(os.homedir(), "docs/file.ts"),
    );
  });
});

describe("shortenPath", () => {
  it("returns . for cwd itself", () => {
    expect(shortenPath("/home/user/project", "/home/user/project")).toBe(".");
  });

  it("returns relative path for descendants of cwd", () => {
    expect(shortenPath("/home/user/project/src/foo.ts", "/home/user/project")).toBe(
      "./src/foo.ts",
    );
  });

  it("returns absolute path for non-descendants", () => {
    const result = shortenPath("/other/path/file.ts", "/home/user/project");
    expect(result).toBe("/other/path/file.ts");
  });
});

describe("extractCostTotal", () => {
  it("returns 0 for null/undefined", () => {
    expect(extractCostTotal(null)).toBe(0);
    expect(extractCostTotal(undefined)).toBe(0);
  });

  it("extracts numeric cost", () => {
    expect(extractCostTotal({ cost: 1.5 })).toBe(1.5);
  });

  it("extracts string cost", () => {
    expect(extractCostTotal({ cost: "2.5" })).toBe(2.5);
  });

  it("extracts cost.total", () => {
    expect(extractCostTotal({ cost: { total: 3.0 } })).toBe(3.0);
  });

  it("extracts string cost.total", () => {
    expect(extractCostTotal({ cost: { total: "4.0" } })).toBe(4.0);
  });

  it("returns 0 for non-finite cost", () => {
    expect(extractCostTotal({ cost: NaN })).toBe(0);
    expect(extractCostTotal({ cost: Infinity })).toBe(0);
  });

  it("returns 0 for non-numeric cost", () => {
    expect(extractCostTotal({ cost: "abc" })).toBe(0);
  });
});

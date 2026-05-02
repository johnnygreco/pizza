import { describe, expect, it } from "vitest";
import {
  SUPPORTED_PI_RANGE,
  describePiRange,
  derivePiRangeFromDependency,
  getPiCompatibilitySummary,
  getPiCompatibilityWarning,
  isPiVersionCompatible,
  parseSemver,
} from "../../extensions/shared/pi-compat.ts";

describe("parseSemver", () => {
  it("parses plain versions", () => {
    expect(parseSemver("0.67.0")).toEqual({ major: 0, minor: 67, patch: 0 });
  });

  it("parses version text from command output", () => {
    expect(parseSemver("pi version 0.67.0")).toEqual({ major: 0, minor: 67, patch: 0 });
  });

  it("defaults a missing patch to zero", () => {
    expect(parseSemver("0.67")).toEqual({ major: 0, minor: 67, patch: 0 });
  });
});

describe("derivePiRangeFromDependency", () => {
  it("derives a minimum-compatible range from the Pi dependency version", () => {
    expect(derivePiRangeFromDependency("0.67.0")).toBe(">=0.67.0");
  });
});

describe("describePiRange", () => {
  it("renders a user-facing label for minimum requirements", () => {
    expect(describePiRange(">=0.67.0")).toBe("0.67.0+");
  });

  it("still renders legacy tilde requirements", () => {
    expect(describePiRange("~0.67.0")).toBe("0.67.x");
  });
});

describe("isPiVersionCompatible", () => {
  it("accepts newer Pi releases above the supported minimum", () => {
    expect(isPiVersionCompatible("0.72.1", ">=0.67.0")).toBe(true);
  });

  it("still accepts versions within a legacy tilde range", () => {
    expect(isPiVersionCompatible("0.67.1", "~0.67.0")).toBe(true);
  });

  it("rejects Pi releases below the supported minimum", () => {
    expect(isPiVersionCompatible("0.66.5", ">=0.67.0")).toBe(false);
  });

  it("uses the package-declared support range by default", () => {
    expect(isPiVersionCompatible("0.72.1", SUPPORTED_PI_RANGE)).toBe(true);
  });
});

describe("compatibility messaging", () => {
  it("summarizes compatible Pi versions", () => {
    expect(getPiCompatibilitySummary("0.72.1")).toBe("v0.72.1 (compatible with 0.72.0+)");
  });

  it("summarizes incompatible Pi versions", () => {
    expect(getPiCompatibilitySummary("0.66.5")).toBe("v0.66.5 (requires 0.72.0+)");
  });

  it("returns no warning for compatible Pi versions", () => {
    expect(getPiCompatibilityWarning("0.72.1")).toBeNull();
  });

  it("returns a warning for incompatible Pi versions", () => {
    expect(getPiCompatibilityWarning("0.66.5")).toContain("requires Pi 0.72.0+");
    expect(getPiCompatibilityWarning("0.66.5")).toContain("current Pi is v0.66.5");
  });
});

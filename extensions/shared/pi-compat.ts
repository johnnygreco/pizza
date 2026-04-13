import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Semver = {
  major: number;
  minor: number;
  patch: number;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "..", "..", "package.json"), "utf-8"),
);

export const PIZZA_VERSION: string = pkg.version;

export function parseSemver(input: string): Semver | null {
  const match = input.match(/(?:^|[^0-9])v?(\d+)\.(\d+)(?:\.(\d+))?(?!\d)/);
  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? "0"),
  };
}

export function formatSemver(version: Semver): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

export function derivePiRangeFromDependency(spec: string | undefined): string | null {
  if (!spec) return null;
  const version = parseSemver(spec);
  if (!version) return null;
  return `~${version.major}.${version.minor}.0`;
}

function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

export const SUPPORTED_PI_RANGE: string =
  pkg.pizza?.compatibility?.pi ??
  derivePiRangeFromDependency(
    pkg.devDependencies?.["@mariozechner/pi-coding-agent"] ??
      pkg.dependencies?.["@mariozechner/pi-coding-agent"],
  ) ??
  "~0.67.0";

export function describePiRange(range: string): string {
  const tilde = range.trim().match(/^~\s*v?(\d+)\.(\d+)\.(\d+)$/);
  if (tilde) return `${tilde[1]}.${tilde[2]}.x`;
  return range.trim();
}

export function isPiVersionCompatible(
  currentVersion: string,
  supportedRange = SUPPORTED_PI_RANGE,
): boolean {
  const current = parseSemver(currentVersion);
  if (!current) return false;

  const tilde = supportedRange.trim().match(/^~\s*v?(\d+)\.(\d+)\.(\d+)$/);
  if (tilde) {
    const minimum = {
      major: Number(tilde[1]),
      minor: Number(tilde[2]),
      patch: Number(tilde[3]),
    };
    return (
      current.major === minimum.major &&
      current.minor === minimum.minor &&
      compareSemver(current, minimum) >= 0
    );
  }

  const exact = parseSemver(supportedRange);
  if (!exact) return false;
  return compareSemver(current, exact) === 0;
}

export function getPiCompatibilitySummary(currentVersion: string): string {
  const current = parseSemver(currentVersion);
  const currentLabel = current ? `v${formatSemver(current)}` : currentVersion;
  const supportedLabel = describePiRange(SUPPORTED_PI_RANGE);

  if (isPiVersionCompatible(currentVersion)) {
    return `${currentLabel} (compatible with ${supportedLabel})`;
  }

  return `${currentLabel} (expected ${supportedLabel})`;
}

export function getPiCompatibilityWarning(currentVersion: string): string | null {
  if (isPiVersionCompatible(currentVersion)) return null;

  const current = parseSemver(currentVersion);
  const currentLabel = current ? `v${formatSemver(current)}` : currentVersion;
  const supportedLabel = describePiRange(SUPPORTED_PI_RANGE);

  return [
    `Pizza v${PIZZA_VERSION} expects Pi ${supportedLabel}, but current Pi is ${currentLabel}.`,
    "Some Pizza extensions may fail to load or behave correctly.",
    "Update Pizza or switch Pi to a compatible version.",
  ].join("\n");
}

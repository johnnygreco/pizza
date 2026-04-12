import { describe, expect, it } from "vitest";
import { validateForkFlags } from "../src/session-target.js";
import type { Args } from "../src/args.js";

const baseArgs: Args = {
  messages: [],
  fileArgs: [],
  unknownFlags: new Map(),
  diagnostics: [],
};

describe("validateForkFlags", () => {
  it("does nothing when --fork is not set", () => {
    expect(() => validateForkFlags(baseArgs)).not.toThrow();
  });

  it("passes when --fork is used alone", () => {
    expect(() => validateForkFlags({ ...baseArgs, fork: "abc123" })).not.toThrow();
  });

  it("throws when --fork is combined with --session", () => {
    expect(() =>
      validateForkFlags({ ...baseArgs, fork: "abc", session: "def" }),
    ).toThrow("--fork cannot be combined with --session");
  });

  it("throws when --fork is combined with --continue", () => {
    expect(() =>
      validateForkFlags({ ...baseArgs, fork: "abc", continue: true }),
    ).toThrow("--fork cannot be combined with --continue");
  });

  it("throws when --fork is combined with --resume", () => {
    expect(() =>
      validateForkFlags({ ...baseArgs, fork: "abc", resume: true }),
    ).toThrow("--fork cannot be combined with --resume");
  });

  it("throws when --fork is combined with --no-session", () => {
    expect(() =>
      validateForkFlags({ ...baseArgs, fork: "abc", noSession: true }),
    ).toThrow("--fork cannot be combined with --no-session");
  });

  it("lists all conflicting flags in error message", () => {
    expect(() =>
      validateForkFlags({
        ...baseArgs,
        fork: "abc",
        session: "def",
        continue: true,
      }),
    ).toThrow("--session, --continue");
  });
});

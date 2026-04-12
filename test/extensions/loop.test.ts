import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  summarizeCondition,
  getConditionText,
  getCompactionInstructions,
} from "../../extensions/loop.ts";

describe("buildPrompt", () => {
  it("returns test-running prompt for tests mode", () => {
    const prompt = buildPrompt("tests");
    expect(prompt).toContain("Run all tests");
    expect(prompt).toContain("signal_loop_success");
  });

  it("returns self-driven prompt for self mode", () => {
    const prompt = buildPrompt("self");
    expect(prompt).toContain("Continue until you are done");
    expect(prompt).toContain("signal_loop_success");
  });

  it("includes custom condition for custom mode", () => {
    const prompt = buildPrompt("custom", "all linting errors are fixed");
    expect(prompt).toContain("all linting errors are fixed");
    expect(prompt).toContain("signal_loop_success");
  });

  it("uses fallback for custom mode with empty condition", () => {
    const prompt = buildPrompt("custom", "  ");
    expect(prompt).toContain("the custom condition is satisfied");
  });

  it("uses fallback for custom mode with no condition", () => {
    const prompt = buildPrompt("custom");
    expect(prompt).toContain("the custom condition is satisfied");
  });
});

describe("summarizeCondition", () => {
  it("returns 'tests pass' for tests mode", () => {
    expect(summarizeCondition("tests")).toBe("tests pass");
  });

  it("returns 'done' for self mode", () => {
    expect(summarizeCondition("self")).toBe("done");
  });

  it("returns the condition for custom mode", () => {
    expect(summarizeCondition("custom", "fix the bug")).toBe("fix the bug");
  });

  it("truncates long custom conditions", () => {
    const long = "a".repeat(60);
    const result = summarizeCondition("custom", long);
    expect(result.length).toBeLessThanOrEqual(48);
    expect(result).toContain("...");
  });

  it("returns fallback for custom mode with empty condition", () => {
    expect(summarizeCondition("custom", "")).toBe("custom condition");
  });
});

describe("getConditionText", () => {
  it("returns 'tests pass' for tests mode", () => {
    expect(getConditionText("tests")).toBe("tests pass");
  });

  it("returns 'you are done' for self mode", () => {
    expect(getConditionText("self")).toBe("you are done");
  });

  it("returns the condition for custom mode", () => {
    expect(getConditionText("custom", "deploy succeeds")).toBe("deploy succeeds");
  });

  it("returns fallback for custom mode with no condition", () => {
    expect(getConditionText("custom")).toBe("custom condition");
  });
});

describe("getCompactionInstructions", () => {
  it("includes breakout condition for tests mode", () => {
    const instructions = getCompactionInstructions("tests");
    expect(instructions).toContain("Loop active");
    expect(instructions).toContain("tests pass");
  });

  it("includes custom condition", () => {
    const instructions = getCompactionInstructions("custom", "fix the tests");
    expect(instructions).toContain("fix the tests");
  });

  it("includes self condition", () => {
    const instructions = getCompactionInstructions("self");
    expect(instructions).toContain("you are done");
  });
});

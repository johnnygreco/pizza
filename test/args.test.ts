import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args.js";

describe("parseArgs", () => {
  it("parses core flags", () => {
    const parsed = parseArgs([
      "--provider",
      "openai",
      "--model",
      "gpt-4o",
      "--thinking",
      "high",
      "--tools",
      "read,write",
      "--mode",
      "json",
      "hello",
    ]);

    expect(parsed.provider).toBe("openai");
    expect(parsed.model).toBe("gpt-4o");
    expect(parsed.thinking).toBe("high");
    expect(parsed.tools).toEqual(["read", "write"]);
    expect(parsed.mode).toBe("json");
    expect(parsed.messages).toEqual(["hello"]);
  });

  it("collects extension flags separately from built-in flags", () => {
    const parsed = parseArgs([
      "--plan",
      "--project",
      "pizza",
      "--custom=value",
    ]);

    expect(parsed.unknownFlags.get("plan")).toBe(true);
    expect(parsed.unknownFlags.get("project")).toBe("pizza");
    expect(parsed.unknownFlags.get("custom")).toBe("value");
  });

  it("captures file arguments separately from messages", () => {
    const parsed = parseArgs(["@prompt.md", "review this"]);

    expect(parsed.fileArgs).toEqual(["prompt.md"]);
    expect(parsed.messages).toEqual(["review this"]);
  });
});

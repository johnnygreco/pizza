import { describe, expect, it } from "vitest";
import {
  getSubagentAutocompletePrefix,
  isSubagentListInvocation,
  parseSubagentInvocation,
} from "../../extensions/pizza-subagents/syntax.ts";

describe("subagent invocation syntax", () => {
  it("parses :agent prompt", () => {
    expect(parseSubagentInvocation(":reviewer review this diff")).toEqual({
      agent: "reviewer",
      prompt: "review this diff",
    });
  });

  it("supports an empty prompt", () => {
    expect(parseSubagentInvocation(":reviewer")).toEqual({ agent: "reviewer", prompt: "" });
  });

  it("does not support legacy suffix or double-colon forms", () => {
    expect(parseSubagentInvocation("reviewer:: review this diff")).toBeUndefined();
    expect(parseSubagentInvocation("::reviewer review this diff")).toBeUndefined();
  });

  it("ignores normal messages", () => {
    expect(parseSubagentInvocation("please ask :reviewer maybe")).toBeUndefined();
  });

  it("recognizes list shortcuts", () => {
    expect(isSubagentListInvocation(parseSubagentInvocation(":subagents")!)).toBe(true);
    expect(isSubagentListInvocation(parseSubagentInvocation(":agents list")!)).toBe(true);
    expect(isSubagentListInvocation(parseSubagentInvocation(":reviewer list")!)).toBe(false);
  });

  it("extracts autocomplete prefixes", () => {
    expect(getSubagentAutocompletePrefix(":rev")).toEqual({ prefix: ":rev", query: "rev" });
    expect(getSubagentAutocompletePrefix("  :")).toEqual({ prefix: ":", query: "" });
    expect(getSubagentAutocompletePrefix("hello :rev")).toBeUndefined();
  });
});

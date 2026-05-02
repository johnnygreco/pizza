import { describe, expect, it } from "vitest";
import { validateDraft } from "../../extensions/pizza-subagents/draft-generator.ts";

describe("draft validation", () => {
  it("sanitizes invalid generated fields", () => {
    const draft = validateDraft({
      name: "Bad Name!",
      description: "Review accessibility",
      tools: ["read", "bash", "subagent", "../bad"],
      contextPolicy: "wat",
      deliveryPolicy: "review",
      defaultRunMode: "background",
      systemPrompt: "Review carefully.",
      rationale: ["because"],
    }, "review accessibility");

    expect(draft.name).toBe("bad-name");
    expect(draft.tools).toEqual(["read", "bash"]);
    expect(draft.contextPolicy).toBe("project");
    expect(draft.deliveryPolicy).toBe("review");
    expect(draft.rationale).toEqual(["because"]);
    expect(draft.warnings?.length).toBeGreaterThan(0);
  });
});

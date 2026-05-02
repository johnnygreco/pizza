import { describe, expect, it } from "vitest";
import { parseAgentMarkdown, sanitizeAgentName, serializeAgentDefinition } from "../../extensions/pizza-subagents/agent-serializer.ts";

const markdown = `---
name: My Reviewer!
description: Reviews code
tools: read,bash,subagent,../bad
context: project
delivery: review
run_in_background: true
created_by: pizza
---

Prompt body.
`;

describe("subagent serializer", () => {
  it("sanitizes agent names", () => {
    expect(sanitizeAgentName("A11y Reviewer!!")).toBe("a11y-reviewer");
  });

  it("parses markdown definitions", () => {
    const def = parseAgentMarkdown(markdown, "user", "/tmp/my-reviewer.md");
    expect(def?.name).toBe("my-reviewer");
    expect(def?.tools).toEqual(["read", "bash"]);
    expect(def?.contextPolicy).toBe("project");
    expect(def?.defaultRunMode).toBe("background");
    expect(def?.systemPrompt).toBe("Prompt body.");
  });

  it("serializes markdown definitions", () => {
    const serialized = serializeAgentDefinition({
      name: "scout",
      description: "Finds things",
      systemPrompt: "Look around.",
      tools: ["read", "grep"],
      contextPolicy: "project",
      deliveryPolicy: "review",
      defaultRunMode: "background",
      source: "user",
      createdBy: "pizza",
      createdAt: "2026-05-02T00:00:00.000Z",
    });
    expect(serialized).toContain("name: scout");
    expect(serialized).toContain("tools: read,grep");
    expect(serialized).toContain("Look around.");
  });
});

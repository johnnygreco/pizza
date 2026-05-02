import { describe, expect, it } from "vitest";
import { buildCapsule } from "../../extensions/pizza-subagents/capsule.ts";

describe("capsule builder", () => {
  it("wraps result with provenance", () => {
    const capsule = buildCapsule({
      id: "sa_123",
      agentName: "reviewer",
      description: "reviews",
      task: "Review diff",
      status: "completed",
      runMode: "background",
      contextPolicy: "project",
      deliveryPolicy: "review",
      startedAt: 1,
      completedAt: 2,
      toolUses: 0,
      turns: 1,
      artifactDir: "/tmp/run",
      contextPath: "/tmp/run/context.md",
      promptPath: "/tmp/run/prompt.md",
      transcriptPath: "/tmp/run/transcript.jsonl",
      resultPath: "/tmp/run/result.md",
      capsulePath: "/tmp/run/capsule.md",
      metadataPath: "/tmp/run/metadata.json",
    }, {
      name: "reviewer",
      description: "reviews",
      systemPrompt: "review",
      contextPolicy: "project",
      deliveryPolicy: "review",
      source: "builtin",
    }, "Looks good.");

    expect(capsule).toContain('<subagent-result id="sa_123" agent="reviewer">');
    expect(capsule).toContain("Task: Review diff");
    expect(capsule).toContain("- context: /tmp/run/context.md");
    expect(capsule).toContain("Looks good.");
  });
});

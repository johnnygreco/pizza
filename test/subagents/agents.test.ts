import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { discoverAgentDefinitions } from "../../extensions/pizza-subagents/agents.ts";

describe("subagent discovery", () => {
  it("loads builtins and lets project override user/builtin precedence", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pizza-subagents-"));
    mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "agents", "scout.md"), `---\nname: scout\ndescription: project scout\n---\n\nProject prompt\n`);
    const result = discoverAgentDefinitions(cwd);
    expect(result.byName.get("scout")?.source).toBe("project");
    expect(result.byName.get("scout")?.description).toBe("project scout");
    expect(result.byName.get("planner")?.source).toBe("builtin");
  });

  it("includes session agents at highest normal precedence", () => {
    const result = discoverAgentDefinitions(process.cwd(), {
      sessionDefinitions: [{
        name: "scout",
        description: "session scout",
        systemPrompt: "session",
        contextPolicy: "fresh",
        deliveryPolicy: "notify",
        source: "session",
      }],
    });
    expect(result.byName.get("scout")?.source).toBe("session");
    expect(result.byName.get("scout")?.description).toBe("session scout");
  });
});

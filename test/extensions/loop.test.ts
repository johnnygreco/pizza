import { describe, expect, it, vi } from "vitest";
import loopExtension, {
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

// --- Command handler tests ---

function createMockApi() {
  const registeredEvents = new Map<string, Function[]>();
  const registeredCommands = new Map<string, any>();
  const registeredTools = new Map<string, any>();

  const api = {
    on: vi.fn((event: string, handler: Function) => {
      if (!registeredEvents.has(event)) registeredEvents.set(event, []);
      registeredEvents.get(event)!.push(handler);
    }),
    registerCommand: vi.fn((name: string, options: any) => {
      registeredCommands.set(name, options);
    }),
    registerTool: vi.fn((options: any) => {
      registeredTools.set(options.name, options);
    }),
    appendEntry: vi.fn(),
    sendMessage: vi.fn(),
  };

  return { api, registeredEvents, registeredCommands, registeredTools };
}

function createMockContext(hasUI = true) {
  return {
    hasUI,
    model: { id: "claude-sonnet-4-20250514", name: "sonnet", provider: "anthropic" },
    modelRegistry: {
      find: vi.fn(),
      getApiKeyAndHeaders: vi.fn(() => ({ ok: false })),
    },
    sessionManager: { getEntries: vi.fn(() => []) },
    hasPendingMessages: vi.fn(() => false),
    ui: {
      notify: vi.fn(),
      confirm: vi.fn(),
      select: vi.fn(),
      custom: vi.fn(),
      editor: vi.fn(),
      setStatus: vi.fn(),
      setWidget: vi.fn(),
      setTitle: vi.fn(),
      theme: { fg: (_style: string, text: string) => text },
    },
  };
}

describe("/loop command handler", () => {
  it("starts a loop when given valid args (tests)", async () => {
    const { api, registeredCommands } = createMockApi();
    loopExtension(api as any);

    const ctx = createMockContext();
    await registeredCommands.get("loop").handler("tests", ctx);

    expect(api.appendEntry).toHaveBeenCalled();
    expect(api.sendMessage).toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith("Loop active", "info");
  });

  it("starts a loop with custom condition", async () => {
    const { api, registeredCommands } = createMockApi();
    loopExtension(api as any);

    const ctx = createMockContext();
    await registeredCommands.get("loop").handler("custom all linting errors fixed", ctx);

    expect(api.appendEntry).toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith("Loop active", "info");
  });

  it("starts a loop in self mode", async () => {
    const { api, registeredCommands } = createMockApi();
    loopExtension(api as any);

    const ctx = createMockContext();
    await registeredCommands.get("loop").handler("self", ctx);

    expect(api.appendEntry).toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith("Loop active", "info");
  });

  it("shows usage and returns when no args and no UI", async () => {
    const { api, registeredCommands } = createMockApi();
    loopExtension(api as any);

    const ctx = createMockContext(false);
    await registeredCommands.get("loop").handler("", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Usage:"),
      "warning",
    );
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("opens selector when no args and has UI", async () => {
    const { api, registeredCommands } = createMockApi();
    loopExtension(api as any);

    const ctx = createMockContext(true);
    // Selector returns null (user cancelled)
    ctx.ui.custom.mockResolvedValue(null);
    await registeredCommands.get("loop").handler("", ctx);

    expect(ctx.ui.custom).toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith("Loop cancelled", "info");
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("returns null for unrecognized mode", async () => {
    const { api, registeredCommands } = createMockApi();
    loopExtension(api as any);

    const ctx = createMockContext(false);
    await registeredCommands.get("loop").handler("invalid", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Usage:"),
      "warning",
    );
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("prompts to replace when a loop is already active", async () => {
    const { api, registeredCommands } = createMockApi();
    loopExtension(api as any);

    const ctx = createMockContext(true);
    // Start first loop
    await registeredCommands.get("loop").handler("tests", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Loop active", "info");

    // Try to start second loop, confirm replacement
    ctx.ui.confirm.mockResolvedValue(true);
    await registeredCommands.get("loop").handler("self", ctx);

    expect(ctx.ui.confirm).toHaveBeenCalledWith(
      "Replace active loop?",
      expect.any(String),
    );
    // Should still activate
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Loop active", "info");
  });

  it("keeps existing loop when replacement is declined", async () => {
    const { api, registeredCommands } = createMockApi();
    loopExtension(api as any);

    const ctx = createMockContext(true);
    await registeredCommands.get("loop").handler("tests", ctx);

    ctx.ui.confirm.mockResolvedValue(false);
    await registeredCommands.get("loop").handler("self", ctx);

    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Loop unchanged", "info");
  });

  it("auto-confirms replacement when no UI", async () => {
    const { api, registeredCommands } = createMockApi();
    loopExtension(api as any);

    const ctx = createMockContext(false);
    await registeredCommands.get("loop").handler("tests", ctx);
    await registeredCommands.get("loop").handler("self", ctx);

    // Should not have called confirm (auto-replaces)
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Loop active", "info");
  });
});

describe("signal_loop_success tool", () => {
  it("clears active loop", async () => {
    const { api, registeredCommands, registeredTools } = createMockApi();
    loopExtension(api as any);

    const ctx = createMockContext();
    await registeredCommands.get("loop").handler("tests", ctx);

    const result = await registeredTools.get("signal_loop_success").execute("id", {}, null, vi.fn(), ctx);
    expect(result.content[0].text).toBe("Loop ended.");
    expect(result.details.active).toBe(false);
  });

  it("returns message when no active loop", async () => {
    const { api, registeredTools } = createMockApi();
    loopExtension(api as any);

    const ctx = createMockContext();
    const result = await registeredTools.get("signal_loop_success").execute("id", {}, null, vi.fn(), ctx);
    expect(result.content[0].text).toBe("No active loop is running.");
  });
});

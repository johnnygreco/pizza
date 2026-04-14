import { describe, expect, it, vi } from "vitest";
import pizzaStatusExtension from "../../extensions/pizza-status.ts";

function createMockApi() {
  const registeredEvents = new Map<string, Function[]>();

  const api = {
    on: vi.fn((event: string, handler: Function) => {
      if (!registeredEvents.has(event)) {
        registeredEvents.set(event, []);
      }
      registeredEvents.get(event)!.push(handler);
    }),
  };

  return { api, registeredEvents };
}

function createMockContext(
  hasUI = true,
  options: {
    cwd?: string;
    model?: { id: string; name?: string; provider?: string; contextWindow?: number };
    percent?: number | null;
    contextWindow?: number;
    sessionName?: string;
    entries?: any[];
    usingSubscription?: boolean;
  } = {},
) {
  return {
    hasUI,
    cwd: options.cwd ?? "/tmp/my-project",
    model: options.model ?? {
      id: "gpt-5.4",
      name: "sonnet",
      provider: "openrouter",
      contextWindow: 200000,
    },
    getContextUsage: vi.fn(() =>
      options.percent !== undefined
        ? {
            tokens: 1000,
            contextWindow: options.contextWindow ?? 200000,
            percent: options.percent,
          }
        : undefined,
    ),
    sessionManager: {
      getEntries: vi.fn(() => options.entries ?? []),
      getSessionName: vi.fn(() => options.sessionName),
    },
    modelRegistry: {
      isUsingOAuth: vi.fn(() => options.usingSubscription ?? false),
    },
    ui: {
      setStatus: vi.fn(),
      setFooter: vi.fn(),
    },
  };
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function renderFooter(
  ctx: ReturnType<typeof createMockContext>,
  options: {
    branch?: string | null;
    extensionStatuses?: Map<string, string>;
    providerCount?: number;
  } = {},
  width = 120,
): string {
  const factory = ctx.ui.setFooter.mock.calls[0][0] as Function;
  const footerData = {
    getGitBranch: vi.fn(() => options.branch ?? null),
    getExtensionStatuses: vi.fn(() => options.extensionStatuses ?? new Map()),
    getAvailableProviderCount: vi.fn(() => options.providerCount ?? 1),
    onBranchChange: vi.fn(() => () => {}),
  };
  const theme = {
    fg: vi.fn((_color: string, text: string) => text),
  };
  const component = factory({ requestRender: vi.fn() }, theme, footerData);
  return component.render(width).join("\n");
}

describe("pizza-status extension", () => {
  it("registers footer refresh handlers", () => {
    const { api, registeredEvents } = createMockApi();
    pizzaStatusExtension(api as any);

    expect(registeredEvents.has("session_start")).toBe(true);
    expect(registeredEvents.has("turn_start")).toBe(true);
    expect(registeredEvents.has("turn_end")).toBe(true);
    expect(registeredEvents.has("model_select")).toBe(true);
  });

  it("renders a themed arcade meter with context and model text", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaStatusExtension(api as any);

    const ctx = createMockContext(true, {
      model: { id: "gpt-5.4", name: "sonnet" },
      percent: 50,
    });
    await registeredEvents.get("session_start")![0]({}, ctx);

    const [, raw] = ctx.ui.setStatus.mock.calls[0];
    const output = stripAnsi(raw);

    expect(output).toContain("🍕 ▕██████░░░░░░▏");
    expect(output).toContain("▕██████░░░░░░▏");
    expect(output).toContain("50.0%/200k (auto)");
    expect(output).toContain("sonnet");
    expect(output).not.toContain("lunch rush");
  });

  it("keeps the meter details at high usage without flavor text", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaStatusExtension(api as any);

    const ctx = createMockContext(true, { percent: 96 });
    await registeredEvents.get("turn_end")![0]({}, ctx);

    const [, raw] = ctx.ui.setStatus.mock.calls[0];
    const output = stripAnsi(raw);

    expect(output).toContain("▕███████████░▏");
    expect(output).toContain("96.0%/200k (auto)");
    expect(output).not.toContain("last slice");
  });

  it("replaces Pi's default footer line with session stats and keeps the pizza status line below", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaStatusExtension(api as any);

    const entries = [
      {
        type: "message",
        message: {
          role: "assistant",
          usage: {
            input: 1500,
            output: 2200,
            cacheRead: 300,
            cacheWrite: 0,
            cost: { total: 0.025 },
          },
        },
      },
    ];
    const ctx = createMockContext(true, {
      cwd: "/tmp/pizza-shop",
      sessionName: "late-night",
      entries,
      percent: 50,
      model: {
        id: "qwen/qwen3-coder:free",
        name: "Qwen3 Coder",
        provider: "openrouter",
        contextWindow: 262000,
      },
      contextWindow: 262000,
    });

    await registeredEvents.get("session_start")![0]({}, ctx);

    const statusText = ctx.ui.setStatus.mock.calls[0][1] as string;
    const footer = stripAnsi(
      renderFooter(
        ctx,
        {
          branch: "main",
          extensionStatuses: new Map([["pizza.status", statusText]]),
        },
        140,
      ),
    );
    const footerLines = footer.split("\n");

    expect(ctx.ui.setFooter).toHaveBeenCalledWith(expect.any(Function));
    expect(footerLines[0]).toContain("/tmp/pizza-shop (main) • late-night");
    expect(footerLines[1]).toBe("");
    expect(footer).toContain("↑1.5k");
    expect(footer).toContain("↓2.2k");
    expect(footer).toContain("R300");
    expect(footer).toContain("$0.0250");
    expect(footer).not.toContain("qwen/qwen3-coder:free");
    expect(footerLines[1]).not.toContain("50.0%/262k (auto)");
    expect(footer).toContain("🍕");
    expect(footer).toContain("50.0%/262k (auto)");
    expect(footer).toContain("Qwen3 Coder");
  });

  it("omits the upper stats line until usage or cost exists", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaStatusExtension(api as any);

    const ctx = createMockContext(true, {
      cwd: "/tmp/pizza-shop",
      percent: 0,
      model: {
        id: "qwen/qwen3-coder:free",
        name: "Qwen3 Coder",
        provider: "openrouter",
        contextWindow: 262000,
      },
      contextWindow: 262000,
    });

    await registeredEvents.get("session_start")![0]({}, ctx);

    const statusText = ctx.ui.setStatus.mock.calls[0][1] as string;
    const footer = stripAnsi(
      renderFooter(
        ctx,
        {
          branch: null,
          extensionStatuses: new Map([["pizza.status", statusText]]),
        },
        140,
      ),
    );
    const footerLines = footer.split("\n");

    expect(footerLines).toHaveLength(3);
    expect(footerLines[0]).toContain("/tmp/pizza-shop");
    expect(footerLines[1]).toBe("");
    expect(footer).not.toContain("qwen/qwen3-coder:free");
    expect(footer).toContain("Qwen3 Coder");
  });

  it("skips status updates when no UI is available", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaStatusExtension(api as any);

    const ctx = createMockContext(false, { percent: 30 });
    await registeredEvents.get("session_start")![0]({}, ctx);

    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
    expect(ctx.ui.setFooter).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pizzaStatusExtension from "../../extensions/pizza-status.ts";
import {
  DEFAULT_PIZZA_THEME,
  setActivePizzaTheme,
} from "../../extensions/shared/pizza-palette.ts";

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
    model?: {
      id: string;
      name?: string;
      provider?: string;
      contextWindow?: number;
      cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
    };
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
      cost: {
        input: 1.25,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
      },
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
      model: { id: "gpt-5.4", name: "sonnet", provider: "anthropic" },
      percent: 50,
    });
    await registeredEvents.get("session_start")![0]({}, ctx);

    const [, raw] = ctx.ui.setStatus.mock.calls[0];
    const output = stripAnsi(raw);

    expect(output).toContain("🍕 ██████████░░░░░░░░░░");
    expect(output).toContain("50.0%/200k (auto)");
    expect(output).toContain("Anthropic: sonnet");
    expect(output).not.toContain("lunch rush");
  });

  it("keeps the meter details at high usage without flavor text", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaStatusExtension(api as any);

    const ctx = createMockContext(true, { percent: 96 });
    await registeredEvents.get("turn_end")![0]({}, ctx);

    const [, raw] = ctx.ui.setStatus.mock.calls[0];
    const output = stripAnsi(raw);

    expect(output).toContain("███████████████████░");
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
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
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
    expect(footerLines[0]).toContain("↑1.5k");
    expect(footerLines[0]).toContain("↓2.2k");
    expect(footerLines[0]).toContain("R300");
    expect(footerLines[0]).toContain("$0.0250");
    expect(footerLines[1]).toBe("");
    expect(footer).not.toContain("qwen/qwen3-coder:free");
    expect(footerLines[1]).not.toContain("50.0%/262k (auto)");
    expect(footer).toContain("🍕");
    expect(footer).toContain("50.0%/262k (auto)");
    expect(footer).toContain("OpenRouter: Qwen3 Coder");
  });

  it("shows a zero-cost upper stats line even before usage exists", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaStatusExtension(api as any);

    const ctx = createMockContext(true, {
      cwd: "/tmp/pizza-shop",
      percent: 0,
      model: {
        id: "anthropic/claude-opus-4.6",
        name: "Anthropic: Claude Opus 4.6",
        provider: "openrouter",
        contextWindow: 1000000,
        cost: {
          input: 15,
          output: 75,
          cacheRead: 1.5,
          cacheWrite: 18.75,
        },
      },
      contextWindow: 1000000,
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
    expect(footerLines[0]).toContain("$0.00");
    expect(footerLines[0]).toContain("↑$15/1M");
    expect(footerLines[0]).toContain("↓$75/1M");
    expect(footerLines[1]).toBe("");
    expect(footer).not.toContain("anthropic/claude-opus-4.6");
    expect(footer).toContain("OpenRouter: Claude Opus 4.6");
  });

  it("skips status updates when no UI is available", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaStatusExtension(api as any);

    const ctx = createMockContext(false, { percent: 30 });
    await registeredEvents.get("session_start")![0]({}, ctx);

    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
    expect(ctx.ui.setFooter).not.toHaveBeenCalled();
  });

  describe("theme-change refresh", () => {
    beforeEach(() => {
      setActivePizzaTheme(DEFAULT_PIZZA_THEME);
    });

    afterEach(() => {
      setActivePizzaTheme(DEFAULT_PIZZA_THEME);
    });

    it("refreshes the cached status line when the active theme changes", async () => {
      const { api, registeredEvents } = createMockApi();
      pizzaStatusExtension(api as any);

      const ctx = createMockContext(true, { percent: 50 });
      await registeredEvents.get("session_start")![0]({}, ctx);

      expect(ctx.ui.setStatus).toHaveBeenCalledTimes(1);
      const firstRaw = ctx.ui.setStatus.mock.calls[0][1] as string;

      setActivePizzaTheme("dracula");

      expect(ctx.ui.setStatus).toHaveBeenCalledTimes(2);
      const secondRaw = ctx.ui.setStatus.mock.calls[1][1] as string;
      // Same visible content, but ANSI escapes (theme colors) should differ.
      expect(stripAnsi(secondRaw)).toBe(stripAnsi(firstRaw));
      expect(secondRaw).not.toBe(firstRaw);
    });

    it("does not re-push the status line when the theme name is unchanged", async () => {
      const { api, registeredEvents } = createMockApi();
      pizzaStatusExtension(api as any);

      const ctx = createMockContext(true, { percent: 50 });
      await registeredEvents.get("session_start")![0]({}, ctx);
      expect(ctx.ui.setStatus).toHaveBeenCalledTimes(1);

      setActivePizzaTheme(DEFAULT_PIZZA_THEME);
      expect(ctx.ui.setStatus).toHaveBeenCalledTimes(1);
    });
  });

  it("prefers the real provider label over vendor-prefixed model names", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaStatusExtension(api as any);

    const ctx = createMockContext(true, {
      model: {
        id: "anthropic/claude-opus-4.1",
        name: "Anthropic: Claude Opus 4.1",
        provider: "openrouter",
        contextWindow: 1000000,
      },
      percent: 0,
      contextWindow: 1000000,
    });

    await registeredEvents.get("session_start")![0]({}, ctx);

    const [, raw] = ctx.ui.setStatus.mock.calls[0];
    const output = stripAnsi(raw);

    expect(output).toContain("0.0%/1.0M (auto)");
    expect(output).toContain("OpenRouter: Claude Opus 4.1");
    expect(output).not.toContain("Anthropic: Claude Opus 4.1");
  });
});

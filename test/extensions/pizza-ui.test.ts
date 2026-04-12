import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import pizzaUiExtension from "../../extensions/pizza-ui.ts";

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "..", "..", "package.json"), "utf-8"),
);
const VERSION: string = pkg.version;

function createMockApi() {
  const registeredEvents = new Map<string, Function[]>();
  const registeredCommands = new Map<string, any>();

  const api = {
    on: vi.fn((event: string, handler: Function) => {
      if (!registeredEvents.has(event)) {
        registeredEvents.set(event, []);
      }
      registeredEvents.get(event)!.push(handler);
    }),
    registerCommand: vi.fn((name: string, options: any) => {
      registeredCommands.set(name, options);
    }),
  };

  return { api, registeredEvents, registeredCommands };
}

function createMockContext(
  hasUI = true,
  options: { cwd?: string; model?: { id: string; name: string }; percent?: number | null } = {},
) {
  return {
    hasUI,
    cwd: options.cwd ?? "/tmp/my-project",
    model: options.model ?? { id: "claude-sonnet-4-20250514", name: "sonnet" },
    getContextUsage: vi.fn(() =>
      options.percent !== undefined
        ? { tokens: 1000, contextWindow: 200000, percent: options.percent }
        : undefined,
    ),
    ui: {
      setTitle: vi.fn(),
      setStatus: vi.fn(),
      setWidget: vi.fn(),
      notify: vi.fn(),
    },
  };
}

describe("pizza-ui extension", () => {
  it("registers session_start, turn_start, model_select, turn_end, and /pizza", () => {
    const { api, registeredEvents, registeredCommands } = createMockApi();
    pizzaUiExtension(api as any);

    expect(registeredEvents.has("session_start")).toBe(true);
    expect(registeredEvents.has("turn_start")).toBe(true);
    expect(registeredEvents.has("model_select")).toBe(true);
    expect(registeredEvents.has("turn_end")).toBe(true);
    expect(registeredCommands.has("pizza")).toBe(true);
  });

  it("sets title with repo name on session_start", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true, { cwd: "/home/user/my-repo" });
    await registeredEvents.get("session_start")![0]({}, ctx);

    expect(ctx.ui.setTitle).toHaveBeenCalledWith("pizza \u00B7 my-repo");
    expect(ctx.ui.setStatus).toHaveBeenCalledWith(
      "pizza",
      expect.stringContaining(VERSION),
    );
    expect(ctx.ui.setWidget).toHaveBeenCalled();
  });

  it("skips UI setup when no UI", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(false);
    await registeredEvents.get("session_start")![0]({}, ctx);

    expect(ctx.ui.setTitle).not.toHaveBeenCalled();
  });

  it("turn_start skips when no UI", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(false);
    await registeredEvents.get("turn_start")![0]({}, ctx);

    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
  });

  it("shows model and ellipsis on turn_start", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true, {
      model: { id: "claude-sonnet-4-20250514", name: "sonnet" },
    });
    await registeredEvents.get("turn_start")![0]({}, ctx);

    const statusCall = ctx.ui.setStatus.mock.calls[0];
    expect(statusCall[1]).toContain("sonnet");
    expect(statusCall[1]).toContain("...");
  });

  it("model_select skips when no UI", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(false);
    await registeredEvents.get("model_select")![0]({ model: { id: "x", name: "x" } }, ctx);

    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
  });

  it("updates status on model_select", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true);
    const event = { model: { id: "claude-haiku-4-5-20251001", name: "haiku" } };
    await registeredEvents.get("model_select")![0](event, ctx);

    const statusCall = ctx.ui.setStatus.mock.calls[0];
    expect(statusCall[1]).toContain("haiku");
  });

  it("updates status with model and context on turn_end", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true, {
      model: { id: "claude-sonnet-4-20250514", name: "sonnet" },
      percent: 42,
    });
    await registeredEvents.get("turn_end")![0]({}, ctx);

    const statusCall = ctx.ui.setStatus.mock.calls[0];
    expect(statusCall[0]).toBe("pizza");
    expect(statusCall[1]).toContain("sonnet");
    expect(statusCall[1]).toContain("ctx 42%");
  });

  it("turn_end skips when no UI", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(false);
    await registeredEvents.get("turn_end")![0]({}, ctx);

    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
  });

  it("/pizza shows version, model, cwd, and context", async () => {
    const { api, registeredCommands } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true, {
      cwd: "/home/user/project",
      model: { id: "claude-sonnet-4-20250514", name: "sonnet" },
      percent: 15,
    });
    await registeredCommands.get("pizza").handler("", ctx);

    const msg = ctx.ui.notify.mock.calls[0][0] as string;
    expect(msg).toContain(VERSION);
    expect(msg).toContain("sonnet");
    expect(msg).toContain("/home/user/project");
    expect(msg).toContain("15%");
  });

  it("/pizza skips when no UI", async () => {
    const { api, registeredCommands } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(false);
    await registeredCommands.get("pizza").handler("", ctx);

    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });
});

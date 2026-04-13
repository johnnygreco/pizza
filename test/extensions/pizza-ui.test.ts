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
  it("registers session_start and /pizza", () => {
    const { api, registeredEvents, registeredCommands } = createMockApi();
    pizzaUiExtension(api as any);

    expect(registeredEvents.has("session_start")).toBe(true);
    expect(registeredCommands.has("pizza")).toBe(true);
  });

  it("sets title and banner widget on session_start", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true, { cwd: "/home/user/my-repo" });
    await registeredEvents.get("session_start")![0]({}, ctx);

    expect(ctx.ui.setTitle).toHaveBeenCalledWith("pizza \u00B7 my-repo");
    expect(ctx.ui.setWidget).toHaveBeenCalledWith(
      "pizza.banner",
      expect.any(Array),
      { placement: "aboveEditor" },
    );
    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
  });

  it("banner contains colored Pi and zza block text", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true);
    await registeredEvents.get("session_start")![0]({}, ctx);

    const banner = ctx.ui.setWidget.mock.calls[0][1] as string[];
    const joined = banner.join("\n");
    // Pi block letter pattern (top line)
    expect(joined).toContain("██████  ██");
    // zza block letter pattern (bottom line)
    expect(joined).toContain("███████ ███████ ██   ██");
    // tagline
    expect(joined).toContain("Pi ");
    expect(joined).toContain("with toppings");
  });

  it("banner contains pizza art with toppings and cheese drips", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true);
    await registeredEvents.get("session_start")![0]({}, ctx);

    const banner = ctx.ui.setWidget.mock.calls[0][1] as string[];
    const joined = banner.join("\n");
    // pepperoni
    expect(joined).toContain("●");
    // green peppers
    expect(joined).toContain("▬");
    // sauce-cheese body
    expect(joined).toContain("░");
    // crust
    expect(joined).toContain("████████████");
    // cheese drips
    expect(joined).toContain("╽");
  });

  it("banner fits within the 10-line widget limit", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true);
    await registeredEvents.get("session_start")![0]({}, ctx);

    const banner = ctx.ui.setWidget.mock.calls[0][1] as string[];
    expect(banner.length).toBeLessThanOrEqual(10);
  });

  it("skips UI setup when no UI", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(false);
    await registeredEvents.get("session_start")![0]({}, ctx);

    expect(ctx.ui.setTitle).not.toHaveBeenCalled();
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
